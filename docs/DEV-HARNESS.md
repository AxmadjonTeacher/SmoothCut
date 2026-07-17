# Dev harness — driving the app without a human

The app has no CLI, so an env-gated harness (`apps/desktop/src/main/devHarness.ts`
plus `editor/DevAutoExport.tsx`) drives record → edit → export headlessly. This is
the required way to runtime-verify changes.

Always rebuild first, then run from `apps/desktop`:

```sh
pnpm --filter @smoothcut/desktop build
cd apps/desktop && SMOOTHCUT_DEV_RECORD_SEC=8 npx electron out/main/index.js
```

## Record mode (`SMOOTHCUT_DEV_RECORD_SEC=<n>`)

Records the primary display for n seconds, prints
`[devharness] finalized <projectId> <bundleDir>`, quits.

| Env | Effect |
| --- | --- |
| `SMOOTHCUT_DEV_AUDIO=1` | capture system audio (play sound via `afplay` during the run to get signal) |
| `SMOOTHCUT_DEV_MIC=1` / `SMOOTHCUT_DEV_WEBCAM=1` | capture default mic / camera |
| `SMOOTHCUT_DEV_AREA="x,y,w,h"` | area capture (physical px on the primary display) |
| `SMOOTHCUT_DEV_COUNTDOWN=3\|5\|10` | run the countdown overlay first |
| `SMOOTHCUT_DEV_AUTOZOOM=0\|1` | set the auto-zoom flag stamped into project.json |
| `SMOOTHCUT_DEV_NO_INPUT=1` | skip the uiohook global hook (no Accessibility needed) |
| `SMOOTHCUT_DEV_RECORDER=1` | open the toolbar window first (for hide/restore flow tests) |
| `SMOOTHCUT_DEV_CANCEL=1` | cancel instead of stopping (tests the cancel path) |
| `SMOOTHCUT_DEV_EDITOR_ON_FINALIZE=1` | open the editor after finalize (normally suppressed in harness) |
| `SMOOTHCUT_DEV_SHOT=<png>` | mid-recording screenshots (other windows land at `-w<n>.png`) |

## Editor mode (`SMOOTHCUT_DEV_OPEN=<projectId>`)

Opens the editor for an existing bundle in `~/Movies/SmoothCut`.

| Env | Effect |
| --- | --- |
| `SMOOTHCUT_DEV_EXPORT=<path.mp4>` | auto-export, print `export-done` / `export-error`, quit |
| `SMOOTHCUT_DEV_EXPORT_SIZE=WxH@fps` | export size override (default 1920x1080@30) |
| `SMOOTHCUT_DEV_SHOT=<png>` | screenshot the editor (after export, or after settle in shot-only mode) |
| `SMOOTHCUT_DEV_EVAL='<js>'` | evaluate JS in the editor page before the shot; result printed as `[devharness] eval …`. `window.__scene` is the live SceneRenderer |
| `SMOOTHCUT_DEV_SETTLE_MS=<n>` | extra settle time before the shot |
| `SMOOTHCUT_DEV_VERBOSE=1` | echo every page console line as `[console] …` |

## Panel mode (`SMOOTHCUT_DEV_PANEL_SHOT=<png>`)

Screenshots the recorder toolbar (combine with `SMOOTHCUT_DEV_EVAL` to open the
gear/popovers first). `SMOOTHCUT_DEV_WIN_INFO=1` logs window bounds + renderer
inner size/dpr (used to verify overlay coverage). `SMOOTHCUT_DEV_HOTKEY_PROBE=1`
logs global-shortcut registration state. `SMOOTHCUT_DEV_FAKE_PICK_DIR=<dir>`
stubs the export-directory dialog.

## Verifying media

Binaries (root devDependencies, no PATH install needed):

```sh
FFPROBE=$(node -e "console.log(require('ffprobe-static').path)")
FFMPEG=$(node -e "console.log(require('ffmpeg-static'))")
"$FFPROBE" -v error -show_entries stream=width,height,codec_name,avg_frame_rate -of json out.mp4
"$FFMPEG" -v error -ss 2.0 -i out.mp4 -frames:v 1 frame.png   # then LOOK at the frame
```

Typical proof chain for a feature: record (or reuse a bundle) → open editor →
screenshot state → export → ffprobe + extract frames → read the pixels.
Synthetic mouse telemetry can be injected by rewriting `recording/events.jsonl`
(unit coords; remember `tVideo = (eventsEpoch + t − screenFirstFrame)/1000`) and
clearing `project.json` zoom segments so the editor regenerates.

## Safety

Never `rm -rf` under `~/Movies/SmoothCut` — user recordings live there. Remove
only bundles you created, ideally via the app's `project:delete` IPC (trash-safe).
