---
name: run
description: Launch SmoothCut locally — interactive dev app, headless harness modes, or the packaged build.
---

# Running SmoothCut

- **Interactive (HMR)**: `pnpm dev` from the repo root. The floating
  "What to record?" toolbar appears; the editor opens per-recording.
- **Headless / scripted**: use the dev harness —
  `pnpm --filter @smoothcut/desktop build`, then from `apps/desktop`:
  `SMOOTHCUT_DEV_RECORD_SEC=6 npx electron out/main/index.js` (or
  `SMOOTHCUT_DEV_OPEN=<projectId> …`). Full reference: `docs/DEV-HARNESS.md`.
- **Packaged**: `pnpm --filter @smoothcut/desktop package`, then run
  `apps/desktop/release/mac-arm64/SmoothCut.app/Contents/MacOS/SmoothCut`
  directly (running the inner binary avoids Gatekeeper on unsigned builds).
  The packaged app is its own TCC principal — it needs its own Screen
  Recording/Accessibility grants.

If the Swift recorder is missing (`ENOENT bin/smoothcut-recorder`), build it:
`pnpm --filter @smoothcut/native-mac build:native`.
