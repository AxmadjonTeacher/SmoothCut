# Architecture

## The core pattern

Record raw streams plus an input-event log; derive every effect deterministically
in post. This is what Screen Studio, ScreenCharm, and Cap all do — it keeps the
recorder dumb and crash-safe and makes the editor instant and non-destructive.

```
┌─ Electron main ──────────────────────────────────────────────────┐
│ RecordingSession (state machine: idle → permissions → countdown  │
│  → starting → recording → stopping → finalized|failed)           │
│ ├─ native capture:  macOS  Swift SCK binary (JSON-lines stdio)   │
│ │                   win32  napi-rs addon (windows-capture v2)    │
│ │   cursor HIDDEN, HW H.264 → recording/screen.mp4               │
│ │   overlay windows excluded via excludeWindowIds (bubble, pill) │
│ ├─ InputLogger: uiohook-napi → events.jsonl (unit coords ≥60Hz,  │
│ │   clicks, wheel, keydown) + cursorShape events from the native │
│ │   poller (PNG + hotspot per distinct cursor)                   │
│ ├─ hidden capture window: webcam VP9 / mic Opus / system-audio   │
│ │   loopback (setDisplayMediaRequestHandler audio:'loopback')    │
│ │   → chunks over IPC → recording/*.webm                         │
│ └─ clock anchoring: every stream's first-sample time on ONE      │
│    monotonic clock → meta.json clocks{}                          │
└──────────────────────────────────────────────────────────────────┘
Bundle: ~/Movies/SmoothCut/<uuid>.smoothcut/
        project.json · meta.json · recording/{screen.mp4, camera.webm,
        mic.webm, system.webm, events.jsonl, cursors/<sha1>.png}

┌─ Editor (renderer) ──────────────────────────────────────────────┐
│ events.jsonl → prepareEvents(meta) → VideoEvents (video-time)    │
│ CursorTrack.bake  240Hz spring (tension ~530, drag ~1000,        │
│                   pre-click stiffening, lands exactly on clicks) │
│ ZoomTrack.bake    click clusters → segments → critically-damped  │
│                   spring, cursor-follow center, edge clamping    │
│ SceneRenderer     pixi v8: background → zoomGroup(shadow →       │
│                   masked screen video → ripples → cursor sprite) │
│                   → webcamGroup (drag/custom/split layouts)      │
│ Timeline          pure math (output↔source), immer-patch undo    │
└──────────────────────────────────────────────────────────────────┘

┌─ Export (Web Worker) ────────────────────────────────────────────┐
│ mediabunny demux → per-output-frame compose through the SAME     │
│ SceneRenderer → VideoFrame(canvas) → WebCodecs H.264 (backpress- │
│ ure on encodeQueueSize) → + AAC audio mix (offsets from clocks,  │
│ RNNoise on mic) → mediabunny MP4 mux → positioned writes over    │
│ IPC to a main-process file sink (.part → rename)                 │
└──────────────────────────────────────────────────────────────────┘
```

## Clock domains

Three clocks exist; everything is normalized to **main-process monotonic ms**:

- Swift/QPC native clock → mapped at the `ready` handshake (offset captured once).
- Renderer (capture window) clock → mapped via `clock:now` IPC round trip.
- `events.jsonl` `t` = ms since `clocks.eventsEpoch`.

Video timeline zero is `clocks.screenFirstFrame`. The only place event time is
converted to video time is `packages/engine/src/time.ts::prepareEvents`.

## IPC

Every channel is declared in `packages/shared/src/ipc-contract.ts`
(`IpcInvokeMap` / `IpcEventMap`) and registered through the typed `handle` helper
in `apps/desktop/src/main/ipc/register.ts`. No ad-hoc channels. Media never
crosses IPC — the editor streams it from the Range-capable `smoothcut://`
protocol (`main/project/protocol.ts`).

## Project schema evolution

`project.json` lives on user disks. `packages/shared/src/project.ts` (zod) must
stay backward compatible: new fields are `.optional()`, enums only grow. The
editor treats missing optionals as defaults (`mirror` undefined = false, etc).

## Windows status

`packages/native-win` mirrors the mac wrapper surface (same JSON-line event
protocol, QPC clock). It type-checks against real `windows`/`windows-capture`
crates for both MSVC targets and builds in CI, and the main process dispatches
to it on win32 — but it has **never run on real Windows**. See
`packages/native-win/INTEGRATION.md` for the wiring contract and known caveats
(even-dim flooring, HMONITOR id space, Win10 yellow border, no window exclusion
in WGC display capture).

## Packaging

`apps/desktop/electron-builder.yml`. The Swift recorder ships as an
extraResource at `Contents/Resources/bin/smoothcut-recorder`; `.node` addons are
asar-unpacked. Builds are unsigned until a Developer ID exists (see README
checklist). `main/updater.ts` (electron-updater, generic provider) is inert
until `SMOOTHCUT_UPDATE_URL` is set on a packaged build.
