# @smoothcut/native-win — desktop integration notes

How the Electron main process should wire the win32 branches, mirroring the
existing `@smoothcut/native-mac` usage. File references are to
`apps/desktop/src/main/**` as of Stage 7.

## Package surface (mirror of native-mac)

```ts
import {
  listShareableContent,      // async () => { displays: WinDisplay[]; windows: WinWindow[] }
  checkScreenPermission,     // async () => 'granted'  (always, on win32)
  requestScreenPermission,   // async () => true       (always, on win32)
  startWinRecorder,          // async (opts, callbacks) => WinRecorderHandle
  addonPath,                 // resolved .node path (respects SMOOTHCUT_WIN_ADDON)
} from '@smoothcut/native-win';
```

- `WinDisplay` / `WinWindow` are field-for-field identical to `MacDisplay` /
  `MacWindow`.
- `WinRecorderOptions`, `WinRecorderCallbacks`, and `WinRecorderHandle` are
  structurally identical to the mac types (`displayId`, `windowId?`,
  `cropRectPx?`, `fps`, `outputPath`, `cursorsDir`; `onFirstFrame` /
  `onCursorShape` / `onStats` / `onError`; `stop(): Promise<{ durationMs }>` /
  `kill(): void`). Session code can share one structural `RecorderHandle`
  interface for both platforms (the existing `MacRecorderHandle` already
  matches).
- Every export throws `Error('windows-only')` on non-win32, so the module is
  safe to import unconditionally; still prefer the lazy-accessor pattern below.
- Timestamps handed to callbacks are already mapped onto the main-process
  monotonic clock (`performance.timeOrigin + performance.now()`), exactly like
  the mac wrapper: the addon stamps events with QueryPerformanceCounter ms
  ("nativeMs") and the wrapper fixes the offset at the `ready` handshake.
- Event protocol parity: `ready` / `firstFrame` / `cursorShape` / `stats`
  (every 2 s) / `stopped` / `error`, one JSON object per callback invocation.
  `stopped` exists for parity only — the `durationMs` resolved by
  `handle.stop()` is authoritative (last frame PTS − first frame PTS, same
  semantics as mac).

## Addon binary

`pnpm --filter @smoothcut/native-win build:native` (Windows only) runs
`napi build --platform --release --features napi` and drops
`smoothcut-native-win.win32-<arch>-msvc.node` at the package root. The wrapper
loads it lazily via `createRequire`, looking at:

1. `process.env.SMOOTHCUT_WIN_ADDON` (absolute path override), else
2. `<package root>/smoothcut-native-win.win32-<process.arch>-msvc.node`.

## 1) `native.ts` — add a `nativeWin()` accessor

Mirror `nativeMac()` exactly (dynamic import keeps win32-only code off the
darwin path and defeats static export checking):

```ts
import type * as NativeWin from '@smoothcut/native-win';

let cachedWin: Promise<typeof NativeWin> | undefined;

export function nativeWin(): Promise<typeof NativeWin> {
  if (!process.env.SMOOTHCUT_WIN_ADDON) {
    const nodeFile = `smoothcut-native-win.win32-${process.arch}-msvc.node`;
    if (app.isPackaged) {
      process.env.SMOOTHCUT_WIN_ADDON = join(process.resourcesPath, 'bin', nodeFile);
    } else {
      // Dev: resolve through node's resolver to the workspace package (src/index.ts → ..).
      const require = createRequire(import.meta.url);
      const pkgEntry = require.resolve('@smoothcut/native-win');
      process.env.SMOOTHCUT_WIN_ADDON = join(dirname(pkgEntry), '..', nodeFile);
    }
  }
  cachedWin ??= import('@smoothcut/native-win');
  return cachedWin;
}
```

Packaging: ship the `.node` as an extraResource into `resources/bin/`
(the same approach as the mac Swift binary). Because the wrapper `require()`s
an absolute path from `SMOOTHCUT_WIN_ADDON`, no asar-unpack gymnastics are
needed as long as the file lives outside the asar.

## 2) `sources.ts` — replace the win32 Electron fallback

```ts
export function mapWinDisplay(d: WinDisplay): DisplayInfo { /* identical body to mapMacDisplay */ }
export function mapWinWindow(w: WinWindow): WindowInfo { /* identical body to mapMacWindow */ }

export async function listSources(): Promise<{ displays: DisplayInfo[]; windows: WindowInfo[] }> {
  if (process.platform === 'darwin') { /* unchanged */ }
  if (process.platform === 'win32') {
    const native = await nativeWin();
    const { displays, windows } = await native.listShareableContent();
    return { displays: displays.map(mapWinDisplay), windows: windows.map(mapWinWindow) };
  }
  throw new Error('unsupported-platform');
}
```

**Id semantics (important):** win32 display ids are HMONITOR values and window
ids are HWND values (decimal strings). They are stable for a desktop session
but are **not** the same id space as Electron's `screen.getAllDisplays()[].id`.
Once `listSources()` returns native data, everything downstream
(`RecordingConfig.source.displayId`, `resolveCaptureGeometry`, the recorder
panel) is consistent automatically — just never compare these ids against
Electron `screen` ids on win32 (the current code doesn't).

**Coordinate semantics:** the addon reports monitor size/origin and window
rects in "points" = physical px ÷ that monitor's effective DPI scale
(`GetDpiForMonitor` / 96), with `scaleFactor` alongside. Multiplying by
`scaleFactor` recovers the exact physical virtual-desktop px (see §4). On
mixed-DPI multi-monitor setups this per-monitor division does **not**
necessarily match Chromium/Electron's global DIP layout — another reason to
keep all win32 session math inside the native listing's own coordinate space
and never mix in Electron `screen` values.

## 3) `recording/session.ts` — platform dispatch

- Delete the `if (process.platform !== 'darwin') throw new Error('windows-capture-not-yet-implemented')`
  guard.
- Permissions block, win32 branch:
  - screen: always granted — either skip the check or call
    `(await nativeWin()).checkScreenPermission()` (constant `'granted'`).
  - accessibility: **skip `systemPreferences.isTrustedAccessibilityClient`
    entirely** (macOS-only API). The Windows global input hook (uiohook WH_*
    hooks) needs no permission.
- Recorder start (options object is identical to the mac one, so only the
  entry point differs):

```ts
this.recorder = process.platform === 'darwin'
  ? await (await nativeMac()).startMacRecorder(recorderOpts, callbacks)
  : await (await nativeWin()).startWinRecorder(recorderOpts, callbacks);
```

  `callbacks` are byte-for-byte the same shape (`onFirstFrame` mainMonotonicMs,
  `onCursorShape` → `logger.appendCursorShapeEvent`, `onStats`, `onError` →
  `fail`). Type the field as a structural `RecorderHandle`
  (`{ stop(): Promise<{ durationMs: number }>; kill(): void }`) instead of
  `MacRecorderHandle`.
- `meta.platform`: write `process.platform === 'win32' ? 'win32' : 'darwin'`
  (the `RecordingMeta` contract already allows both).
- `kill()` on win32 performs a graceful stop under the hood (fire-and-forget);
  it is still correct for the cancel/fail paths because those delete the
  bundle anyway.

## 4) Input logger + geometry — the one real difference

On darwin, uiohook reports **global logical points**; `resolveCaptureGeometry`
returns `captureRectPt` in that same space and `InputLogger` normalizes to
unit coords against it.

On win32, **uiohook reports PHYSICAL PIXELS in virtual-desktop coordinates**
(origin at the primary monitor's top-left; negative values exist on monitors
placed left/above). So the logger's rect must be a physical-px rect on win32.

Because the addon's point values are exact divisions of physical px, the
physical rect round-trips precisely from the listing:

```ts
// DisplayInfo from listSources() on win32:
const pxRect = {
  x: d.bounds.x * d.scaleFactor,
  y: d.bounds.y * d.scaleFactor,
  width: d.bounds.width * d.scaleFactor,
  height: d.bounds.height * d.scaleFactor,
};
```

Recommended change (keeps `InputLogger`/`toUnitCoords` untouched): extend
`CaptureGeometry` with the rect expressed in *the input hook's coordinate
space* — call it `captureRectInput` — and have `resolveCaptureGeometry`
compute it per platform:

| source kind | darwin (`= captureRectPt`, points) | win32 (physical px, virtual desktop) |
|---|---|---|
| display | display bounds | `{ b.x*s, b.y*s, b.width*s, b.height*s }` |
| area | display bounds + rect/s | `{ b.x*s + r.x, b.y*s + r.y, r.width, r.height }` (`r` is already physical px per contract) |
| window | window bounds | `{ wb.x*s, wb.y*s, wb.width*s, wb.height*s }` (`s` = the window's display scale) |

Then `new InputLogger({ captureRectPt: geometry.captureRectInput, ... })` on
both platforms (rename the option if you like; it is just "the rect uiohook
coordinates are normalized against").

Also in `input/logger.ts`:

- Remove the `throw new Error('windows-capture-not-yet-implemented')` branch —
  on win32 just skip the accessibility check and start the hook.
- Buttons, wheel deltas, and keycodes need no changes: libuiohook normalizes
  button numbering and keycodes across platforms, and `mapWheelDelta` is
  platform-agnostic.

`widthPx`/`heightPx` in `resolveCaptureGeometry` stay as they are (they are
already physical px by contract) — with one caveat below.

## 5) Caveats / gotchas

- **Even dimensions:** H.264 wants even dims, so the addon floors odd encoder
  dimensions (and odd `cropRectPx` sizes) down to the nearest even value. For
  odd-sized area/window captures the actual video can be 1 px smaller than
  `meta.capture.widthPx/heightPx` computed by `geometry.ts`. If the win32
  recorder panel can snap area selections to even physical sizes, do it.
- **Window capture rects:** `GetWindowRect` (what both the listing and the
  logger mapping use) includes the invisible resize borders, while the
  Graphics Capture item may be trimmed slightly differently; the encoder
  letterboxes any mismatch. Expect cursor-overlay alignment on *window*
  recordings to be within a few px, same class of imprecision as mac window
  capture.
- **Capture border/cursor:** the addon requests
  `CursorCaptureSettings::WithoutCursor` (cursor is never composited — the
  engine draws its own, same as mac) and `DrawBorderSettings::WithoutBorder`.
  On older Windows 10 builds the OS ignores the border setting and may still
  draw the yellow capture border; requires Win10 1903+ for capture at all,
  and 21H2+/Win11 for border removal.
- **DPI awareness:** monitor origins come from `GetMonitorInfoW` in the
  calling process's awareness context. Electron main is per-monitor-v2 aware,
  so these are true physical virtual-desktop coordinates — correct. Don't call
  the addon from a DPI-unaware helper process.
- **Lifetime:** an active recording holds a napi threadsafe function, which
  keeps the event loop referenced. Always `stop()` or `kill()` before app
  quit (the session teardown paths already guarantee this).
- **`stats`** arrive every 2 s from the cursor-poller thread; `dropped`
  counts encoder-submit failures (an `error` event follows and capture ends),
  not transient frame drops.
- **cursorShape** hotspot and `sizePx` are in PNG pixel coords, files are
  written as `<sha1>.png` into `cursorsDir` — identical to mac, no consumer
  changes.
- **First `ready`/`cursorShape` ordering** is guaranteed (ready is emitted
  before the poller starts), so the initial cursor shape is never dropped by
  the wrapper's offset guard.

## 6) Dev harness / CI

- The dev harness (`SMOOTHCUT_DEV_RECORD_SEC=…`) works on a Windows machine
  once §3/§4 land; `SMOOTHCUT_DEV_NO_INPUT` is unnecessary there (no
  accessibility permission exists to bypass).
- CI: the windows job installs stable Rust (dtolnay/rust-toolchain) and runs
  `pnpm --filter @smoothcut/native-win build:native`, producing the
  `win32-x64-msvc` addon before `pnpm typecheck && pnpm test`.
- Cross-platform type-checking of the Rust crate without a Windows box:
  `cargo check --target x86_64-pc-windows-msvc --features napi` from
  `packages/native-win` (rustup target `x86_64-pc-windows-msvc` required).
