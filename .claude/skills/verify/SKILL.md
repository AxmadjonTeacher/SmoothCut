---
name: verify
description: Verify a SmoothCut change end-to-end by driving the real app through the dev harness (record → edit → export) and inspecting the produced media, not just running tests.
---

# Verifying SmoothCut changes

Static gates first — all three must pass:

```sh
pnpm typecheck && pnpm test && pnpm --filter @smoothcut/desktop build
```

Then drive the affected flow through the real app. Full env-var reference:
`docs/DEV-HARNESS.md`. All commands run from `apps/desktop` after the build.

## Recipes by change area

- **Capture / session / native-mac** (rebuild Swift first if it changed:
  `pnpm --filter @smoothcut/native-mac build:native`):
  `SMOOTHCUT_DEV_RECORD_SEC=6 npx electron out/main/index.js`
  → ffprobe `recording/screen.mp4` (resolution, fps, codec), check `meta.json`
  clocks and `events.jsonl` density. Add `SMOOTHCUT_DEV_WEBCAM=1` /
  `SMOOTHCUT_DEV_MIC=1` / `SMOOTHCUT_DEV_AUDIO=1` (play sound via `afplay`) for
  aux streams.
- **Engine / editor UI**: open an existing bundle —
  `SMOOTHCUT_DEV_OPEN=<id> SMOOTHCUT_DEV_SHOT=/tmp/shot.png` (+`SMOOTHCUT_DEV_EVAL`
  to click/drag/inspect; `window.__scene` is the live SceneRenderer) — and READ
  the screenshot. A test recording with camera usually exists in
  `~/Movies/SmoothCut`; otherwise record one.
- **Export / media**: `SMOOTHCUT_DEV_OPEN=<id> SMOOTHCUT_DEV_EXPORT=/tmp/out.mp4`
  (+`SMOOTHCUT_DEV_EXPORT_SIZE=3840x2160@30` for 4K) → ffprobe the result AND
  extract frames with ffmpeg and look at them. Frame extraction is the only
  proof that compositing is right.
- **Recorder toolbar**: `SMOOTHCUT_DEV_PANEL_SHOT=/tmp/panel.png` (+eval to open
  the gear panel) and read the screenshot.

## Rules

- A change is "verified" only when the produced artifact (screenshot / frame /
  probe output) was actually inspected. Say what was runtime-verified vs
  typechecked-only.
- Clean up recordings you created via the app's `project:delete` IPC or trash —
  NEVER `rm -rf` under `~/Movies/SmoothCut`.
- Permissions on a fresh machine: screen/camera/mic TCC grants go to the
  terminal in dev. If capture fails with `permission:screen`, the human must
  grant it — do not loop retrying.
