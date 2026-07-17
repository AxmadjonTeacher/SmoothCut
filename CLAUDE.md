# SmoothCut — agent guide

Cross-platform (macOS + Windows) Screen-Studio-style screen recorder: native capture
with the OS cursor hidden + a mouse-telemetry log → **all effects are deterministic
post-processing** (auto-zoom on clicks, spring-smoothed synthetic cursor, styled
backgrounds) → PixiJS editor → WebCodecs MP4 export.

Read `docs/ARCHITECTURE.md` before touching capture, engine, or export code.
Read `docs/DEV-HARNESS.md` before claiming anything "works" — runtime verification
is expected here, not just typecheck.

## Commands

```sh
pnpm install                                     # workspace install (pnpm 10)
pnpm typecheck && pnpm test                      # turbo across all packages
pnpm --filter @smoothcut/desktop build           # electron-vite production build
pnpm dev                                         # launch the app (HMR)
pnpm --filter @smoothcut/native-mac build:native # rebuild the Swift recorder (required after Swift edits)
pnpm --filter @smoothcut/desktop package         # electron-builder → apps/desktop/release/
```

Always run typecheck + test + build after an edit batch; all three must be green
before you report done.

## Hard invariants (do not break)

1. **Effects are pure functions** of (raw streams + `events.jsonl` + `project.json`).
   Recorded media is never mutated.
2. **Preview and export render through the same `SceneRenderer`** (`packages/engine`).
   Never fork the render path.
3. **One timebase**: all stream clocks are main-process monotonic ms
   (`performance.timeOrigin + performance.now()`), anchored in `meta.json`.
   Event→video mapping: `tVideoSec = (clocks.eventsEpoch + e.t − clocks.screenFirstFrame) / 1000`.
4. **Coordinates in `events.jsonl` are unit coords (0..1)** of the capture rect,
   DPI-normalized at write time (macOS logical points × scale; Windows physical px).
5. **Native modules do capture + encode only.** Creative logic lives in TypeScript.
6. `packages/engine` and `packages/media` are **pure browser-API TS** — no Electron
   or Node imports (they run in the editor window and the export Worker).
7. `packages/shared` is the contract layer (project schema, event log, typed IPC).
   Changes must be additive/backward-compatible: old `project.json` files on user
   disks must keep parsing (use zod `.optional()`).

## Repo map

| Path | What | Notes |
| --- | --- | --- |
| `apps/desktop/src/main` | Electron main: recording session state machine, typed IPC, `smoothcut://` protocol, windows, tray, dev harness | one `RecordingSession` at a time |
| `apps/desktop/src/renderer/src` | React UI: `recorder/` (floating toolbar), `editor/` (preview, timeline, sidebar), `capture/` (hidden capture + bubble), `export/` (worker) | |
| `packages/shared` | Frozen contracts + zod schemas + `ipc-contract.ts` | every IPC channel is typed here |
| `packages/engine` | 240 Hz spring cursor bake, click-cluster zoom generator, timeline math, PixiJS v8 scene | pixi imports only under `src/scene/` |
| `packages/media` | mediabunny demux/mux + WebCodecs encode, audio mixdown, RNNoise | |
| `packages/native-mac` | Swift ScreenCaptureKit binary (`bin/smoothcut-recorder`) + TS wrapper (JSON-lines stdio) | `showsCursor=false`, window exclusion |
| `packages/native-win` | napi-rs addon over windows-capture v2 | compiles in CI; **never runtime-tested on real Windows yet** |
| `apps/website` | Marketing site (Next.js, deploys to Vercel as smoothcut.app) | download buttons link `github.com/AxmadjonTeacher/SmoothCut/releases/latest/download/...` — filenames must stay `${version}`-free in `electron-builder.yml` or the links break on every release |

Recording bundles: `~/Movies/SmoothCut/<uuid>.smoothcut/` —
`project.json`, `meta.json`, `recording/{screen.mp4, camera.webm, mic.webm,
system.webm, events.jsonl, cursors/<sha1>.png}`.

## Known gotchas (each cost a debugging session — check here first)

- **Pixi + CSP**: `packages/engine/src/scene/bootstrap.ts` loads `pixi.js/unsafe-eval`
  and the `WebWorkerAdapter`. It must be imported before any renderer creation.
- **Pixi baked textures**: never destroy a mask/shadow `TextureSource` that a pooled
  `AlphaMaskEffect` may still reference — update in place via
  `scene/bakedTexture.ts` (`BakedTexture`). Destroying poisons pixi's global pool
  and aborts frames mid-render.
- **Video-element GL upload**: `FrameTexture.update()` returns null until the
  `<video>` has `videoWidth > 0 && readyState >= 2`. Uploading earlier bricks the
  texture (GL storage never defined; every later `texSubImage2D` fails).
- **`smoothcut://` protocol**: answers CORS preflight (`OPTIONS`) and exposes
  `Content-Range`; media elements need `crossOrigin="anonymous"`.
- **mediabunny**: never feed `samplesAtTimestamps` from an on-demand async channel
  (deadlock). `packages/media/src/demux.ts` uses the forward `samples()` iterator.
- **Bundled `import.meta.url` breaks**: main sets `SMOOTHCUT_RECORDER_BIN` /
  `SMOOTHCUT_WIN_ADDON` in `main/native.ts` (dev resolver vs `process.resourcesPath`).
- **ScreenCaptureKit**: frames arrive only on screen change (low fps on static
  screens is normal); zero displays = screen locked; window exclusion
  (`excludeWindowIds`) only sees windows that are **on screen** — a hidden Electron
  window is silently not excluded (show it at `opacity: 0` first).
- **uiohook**: never call `uIOhook.start()` on macOS without
  `isTrustedAccessibilityClient` — it hard-crashes the process.

## Safety rules

- **NEVER `rm -rf` anything under `~/Movies/SmoothCut`** — those are user
  recordings. Delete only bundle ids you created yourself, via the app's
  `project:delete` IPC (uses `shell.trashItem`) or `trash`-safe commands.
  A PreToolUse hook in `.claude/settings.json` enforces this.
- Don't edit `pnpm-lock.yaml` by hand; don't add npm deps without flagging it.
- TCC: screen/camera/mic permissions are per-principal. Packaged apps are a new
  principal; dev runs inherit the terminal's grants.

## Style

TS 5.9 strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` (use
`import type`), ESM everywhere, 2-space indent, single quotes, semicolons,
React function components. Comments only for constraints the code can't express
(coordinate spaces, clock domains, codec quirks).
