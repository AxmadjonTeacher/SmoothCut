/**
 * Recording-time contracts: capture sources, session config, and the
 * metadata bundle written alongside every recording.
 *
 * Coordinate conventions (load-bearing, do not change casually):
 * - `Rect` in `CaptureSource` is in PHYSICAL pixels, relative to the display it
 *   belongs to (origin = display top-left).
 * - `DisplayInfo.bounds` is in LOGICAL points in the OS global space (what
 *   Electron's `screen.getAllDisplays()` reports), with `scaleFactor` to map
 *   to physical pixels.
 * - Everything downstream of recording (events.jsonl, project.json) uses UNIT
 *   coordinates (0..1) relative to the capture rect — normalized at write time.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CaptureSource =
  | { kind: 'display'; displayId: string }
  | { kind: 'window'; windowId: string; displayId: string }
  | { kind: 'area'; displayId: string; rect: Rect };

export interface DisplayInfo {
  id: string;
  label: string;
  bounds: Rect;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface WindowInfo {
  id: string;
  title: string;
  appName: string;
  displayId: string;
  /** Logical points, global space. */
  bounds: Rect;
}

export interface RecordingConfig {
  source: CaptureSource;
  fps: 30 | 60;
  webcam?: { deviceId: string };
  mic?: { deviceId: string; noiseSuppression: boolean };
  systemAudio: boolean;
  countdownSec: 0 | 3 | 5 | 10;
  /** Editor auto-generates zoom segments from clicks (default true). */
  autoZoom?: boolean;
}

/**
 * First-sample times of every stream on the shared monotonic clock
 * (main-process `performance.timeOrigin + performance.now()`, in ms).
 * Screen video PTS 0 corresponds to `screenFirstFrame`; all other streams are
 * aligned against it at edit/export time.
 */
export interface StreamClocks {
  screenFirstFrame: number;
  eventsEpoch: number;
  cameraStart?: number;
  micStart?: number;
  systemAudioStart?: number;
}

export interface RecordingMeta {
  schemaVersion: 1;
  platform: 'darwin' | 'win32';
  createdAt: string;
  capture: {
    widthPx: number;
    heightPx: number;
    fps: number;
    scaleFactor: number;
    source: CaptureSource;
  };
  displays: DisplayInfo[];
  clocks: StreamClocks;
  durationMs: number;
}

export type RecordingState =
  | 'idle'
  | 'checking-permissions'
  | 'countdown'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'finalized'
  | 'failed';

export interface RecordingStatus {
  state: RecordingState;
  projectId?: string;
  elapsedMs: number;
  countdownRemaining?: number;
  freeDiskBytes?: number;
  error?: string;
}

export type PermissionState = 'granted' | 'denied' | 'not-determined';

export interface PermissionsStatus {
  /** macOS TCC screen recording; always 'granted' on Windows. */
  screen: PermissionState;
  /** macOS Accessibility (required by the global input hook); always true on Windows. */
  accessibility: boolean;
  microphone: PermissionState;
  camera: PermissionState;
}

export type PermissionKind = 'screen' | 'accessibility' | 'microphone' | 'camera';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  durationMs: number;
  thumbnailUrl?: string;
}
