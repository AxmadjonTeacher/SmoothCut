# SmoothCut

Cross-platform (macOS + Windows) screen recorder in the Screen Studio / ScreenCharm mold:
record the screen → automatic zoom-on-click, spring-smoothed synthetic cursor, styled
backgrounds → timeline editor → MP4 export up to 4K60.

## How it works

Raw streams (native-capture screen video with the OS cursor **hidden**, webcam, mic,
system audio) are recorded alongside a mouse/keyboard event log (`events.jsonl`). All
effects are deterministic post-processing over those inputs; preview and export render
through the same PixiJS scene.

## Layout

| Path | What |
| --- | --- |
| `apps/desktop` | Electron app (main process, preload, React renderer) |
| `packages/shared` | Frozen contracts: project format, event log, typed IPC |
| `packages/engine` | Cursor spring, auto-zoom generator, timeline math, PixiJS scene |
| `packages/media` | WebCodecs + Mediabunny export pipeline |
| `packages/native-mac` | Swift ScreenCaptureKit recorder (+ TS wrapper) |
| `packages/native-win` | napi-rs addon over Windows.Graphics.Capture |

## Usage

1. **Record** — the recorder panel opens on launch (also reachable from the tray icon).
   Pick a source: a whole **Screen**, a single **Window**, or a drag-selected **Area**
   (remembered per display). Optionally add a webcam (shown as a floating draggable
   bubble while recording), a microphone, and system audio; choose 30/60 fps and a
   0/3/5/10 s countdown, then hit the record button or the global hotkey
   (default `⌘⇧2` / `Ctrl+Shift+2`). The panel hides while recording; stop from the
   tray, the hotkey, or the panel.
2. **Edit** — the editor opens automatically when a recording finalizes (recent
   recordings are also listed in the panel). Auto-zoom segments are generated from your
   clicks; adjust or add zooms on the timeline, tune the spring-smoothed cursor size,
   background padding/style, and trim the clip. Everything is non-destructive — the raw
   `.smoothcut` bundle is never modified.
3. **Export** — pick resolution (up to 4K where the encoder allows it; the dialog probes
   and gates unsupported combos), 30/60 fps, and bitrate. Export runs through WebCodecs
   (H.264 + AAC) in a worker and writes a standard `.mp4`.

First run on macOS needs **Screen Recording** and **Accessibility** permissions; the
panel walks you through both. macOS only applies the Screen Recording grant to a fresh
process — the panel shows a **Relaunch SmoothCut** button when that's needed.
Recordings live in `~/Movies/SmoothCut/<id>.smoothcut` (a directory bundle: raw
`screen.mp4`, sidecar streams, `events.jsonl`, `project.json`).

## Docs

- [CLAUDE.md](CLAUDE.md) — agent guide: commands, invariants, gotchas, safety rules
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map, clock domains, IPC, data formats
- [docs/DEV-HARNESS.md](docs/DEV-HARNESS.md) — headless record/edit/export automation
- `.claude/` — project skills (`verify`, `run`), the `e2e-verifier` agent, the `smoke` workflow, and a recordings-safety hook

## Development

```sh
pnpm install
pnpm --filter @smoothcut/native-mac build:native   # macOS: build the Swift recorder
pnpm dev                                           # launch the Electron app
pnpm typecheck && pnpm test
```

macOS needs Screen Recording and Accessibility permissions (System Settings → Privacy)
granted to the app (in dev: to your terminal). Windows needs Windows 10 2004+.

A headless dev harness exists for end-to-end verification (record/export/screenshot via
`SMOOTHCUT_DEV_*` env vars) — see `apps/desktop/src/main/devHarness.ts`.

## Packaging (macOS)

```sh
pnpm install
pnpm --filter @smoothcut/native-mac build:native   # the Swift recorder ships as an extraResource
pnpm --filter @smoothcut/desktop package           # electron-vite build && electron-builder
```

Artifacts land in `apps/desktop/release/`: `SmoothCut-<version>-arm64.dmg`,
`SmoothCut-<version>-arm64-mac.zip`, and the raw `mac-arm64/SmoothCut.app`. The Swift
recorder binary is placed at `Contents/Resources/bin/smoothcut-recorder` (where
`main/native.ts` expects it when packaged); native `.node` addons are asar-unpacked.

App icons are generated (no design tooling needed) by
`pnpm --filter @smoothcut/desktop icons`, which renders
`apps/desktop/resources/{icon.png,icon.ico,icon.icns}` analytically with zero
dependencies (`.icns` via the macOS `iconutil`).

Notes:

- Builds are currently **unsigned** (`mac.identity: null` in
  `apps/desktop/electron-builder.yml`). Locally-built apps run fine; a downloaded copy
  will be blocked by Gatekeeper until signed + notarized (see checklist below), or
  bypassed for testing with `xattr -dr com.apple.quarantine SmoothCut.app`.
- The packaged app is its **own TCC principal**: grant Screen Recording and
  Accessibility to `SmoothCut.app` on first run even if your terminal already has them.
- `.smoothcut` file association: projects are **directory bundles**, registered with
  `LSTypeIsPackage` so Finder treats them as opaque documents. On Windows, NSIS
  associations only apply to plain files, so double-open of a project folder is
  effectively macOS-only — and the app does not yet implement an `open-file` handler,
  so the association currently provides icon/typing, not deep-open (TODO).
- The asar contains some renderer-only libraries (pixi.js, react, …) that are already
  bundled into `out/renderer`; they're collected because they are production deps of
  the workspace packages. Harmless bloat (~40 MB compressed), trimmable later with
  more `files` exclusions.

### Windows build (not buildable on this machine)

`electron-builder.yml` carries the `win` config (NSIS x64, `.node` addon shipped to
`Resources/bin/` when present). Producing the installer needs a Windows machine or CI:

1. Windows 10 2004+ with Node 22, pnpm, and a Rust toolchain (`x86_64-pc-windows-msvc`).
2. `pnpm install && pnpm --filter @smoothcut/native-win build:native` — emits
   `smoothcut-native-win.win32-x64-msvc.node`.
3. `pnpm --filter @smoothcut/desktop package` — the `win.extraResources` filter picks
   the addon up automatically.

The Windows capture path is type-checked and unit-tested but has not been
runtime-verified yet; treat the first Windows package as experimental.

### Signing & notarization

Builds are signed with a **Developer ID Application** certificate
(`mac.identity` in `electron-builder.yml`, must be present in the signing
machine's login keychain — `security find-identity -v -p codesigning`) and
notarized (`mac.notarize: true`, electron-builder staples the ticket
automatically on success).

Notarization needs three env vars, read from `apps/desktop/.env.local`
(gitignored — never commit it):
```
APPLE_ID=<your Apple ID email>
APPLE_APP_SPECIFIC_PASSWORD=<generated at appleid.apple.com>
APPLE_TEAM_ID=<from developer.apple.com/account>
```
Load them before packaging: `set -a; source apps/desktop/.env.local; set +a`.

Notarization is a real round-trip to Apple's notary service (usually a few
minutes, occasionally longer) — `electron-builder --publish always` blocks
until it completes or fails.

### Auto-update

`main/updater.ts` wires `electron-updater` with the **github** provider — the feed
(owner/repo, from `electron-builder.yml`'s `publish` block) is baked into
`app-update.yml` at build time, so there is no server of our own to run. It activates
whenever the app is packaged (`app.isPackaged`); no env var needed.

Publishing a release: `GH_TOKEN=$(gh auth token) pnpm --filter @smoothcut/desktop package -- --publish always`
(or set `GH_TOKEN`/`GITHUB_TOKEN` and add `--publish always`) creates/updates the
GitHub Release for the current `package.json` version and uploads the installers plus
`latest-mac.yml`/`latest.yml` and `.blockmap` files that `electron-updater` needs to
detect and diff-download new versions.

- [ ] Sign the app (macOS hard requirement — Squirrel.Mac refuses to install updates
      into an unsigned/invalidly-signed app; Windows strongly recommended for
      SmartScreen). Until then, `checkForUpdatesAndNotify()` can still detect and
      download a new version, it just can't self-install it.
