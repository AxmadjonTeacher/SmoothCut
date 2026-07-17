/**
 * The single typed IPC surface between main and renderer processes.
 * Main registers every key of `IpcInvokeMap` with `ipcMain.handle`; the
 * preload exposes a typed `invoke`/`on` pair over `contextBridge`. No ad-hoc
 * channels anywhere else.
 *
 * Media files are NEVER shipped over IPC — the editor streams them from the
 * custom `smoothcut://` protocol (Range-capable), via `BundleUrls`.
 */
import type {
  DisplayInfo,
  PermissionKind,
  PermissionsStatus,
  ProjectSummary,
  RecordingConfig,
  RecordingMeta,
  RecordingStatus,
  Rect,
  WindowInfo,
} from './recording.js';
import type { ProjectFile } from './project.js';

export interface BundleUrls {
  screen: string;
  camera?: string;
  mic?: string;
  system?: string;
  /** Raw text of events.jsonl is small enough to load eagerly. */
  eventsJsonl: string;
  /** Base url for cursors/<shapeId>.png lookups. */
  cursorsBase: string;
}

export interface LoadedProject {
  id: string;
  project: ProjectFile;
  meta: RecordingMeta;
  urls: BundleUrls;
}

export interface ExportSettings {
  width: number;
  height: number;
  fps: 30 | 60;
  /** Target bitrate in megabits/second. */
  bitrateMbps: number;
  destination: string;
}

export interface IpcInvokeMap {
  'app:version': () => string;
  /**
   * Restart the app process. Used after granting Screen Recording on macOS,
   * which only applies the grant to a freshly launched process.
   */
  'app:relaunch': () => void;
  'permissions:status': () => PermissionsStatus;
  'permissions:request': (kind: PermissionKind) => boolean;
  'permissions:openSettings': (kind: PermissionKind) => void;
  'sources:list': () => { displays: DisplayInfo[]; windows: WindowInfo[] };
  /**
   * Recorder panel → main: open the drag-select overlay on a display. Resolves
   * with the picked rect in PHYSICAL px relative to that display (dimensions
   * rounded to even for H.264), persisted into `AppSettings.rememberedAreas`;
   * null when the user cancelled.
   */
  'sources:pickArea': (displayId: string) => Rect | null;
  /**
   * Area-picker overlay window → main: the drag result in LOGICAL points
   * relative to the picker's display (CSS px of the fullscreen overlay);
   * null = cancelled (Esc).
   */
  'area:picked': (rect: Rect | null) => void;
  'recording:start': (config: RecordingConfig) => { projectId: string };
  'recording:stop': () => { projectId: string };
  'recording:cancel': () => void;
  'recording:status': () => RecordingStatus;
  'project:list': () => ProjectSummary[];
  'project:load': (id: string) => LoadedProject;
  'project:save': (id: string, project: ProjectFile) => void;
  'project:delete': (id: string) => void;
  'project:eventsText': (id: string) => string;
  'project:openEditor': (id: string) => void;
  'export:pickDestination': (defaultName: string) => string | null;
  'export:begin': (projectId: string, settings: ExportSettings) => { exportId: string };
  /** `position` is a byte offset (MP4 finalization rewrites the header); null = append. */
  'export:writeChunk': (exportId: string, chunk: ArrayBuffer, position: number | null) => void;
  /** Closes the .part file and renames it into place; reports the final size. */
  'export:finalize': (exportId: string) => { sizeBytes: number };
  'export:abort': (exportId: string) => void;
  'shell:showItemInFolder': (path: string) => void;
  'settings:get': () => AppSettings;
  'settings:set': (patch: Partial<AppSettings>) => AppSettings;
  /** Capture window → main: appended verbatim to recording/<stream>.webm. */
  'capture:chunk': (stream: CaptureStreamKind, chunk: ArrayBuffer) => void;
  /** Capture window → main: recorder onstart time mapped onto the MAIN clock. */
  'capture:streamStarted': (stream: CaptureStreamKind, mainMonotonicMs: number) => void;
  /** Capture window → main: every recorder stopped and all chunks were sent. */
  'capture:allStopped': () => void;
  /** Capture window → main: mounted and listening for 'capture:command'. */
  'capture:ready': () => void;
  /** Capture window → main: a stream failed to start or died mid-recording. */
  'capture:error': (message: string) => void;
  /** Main-process monotonic clock (performance.timeOrigin + performance.now()). */
  'clock:now': () => number;
}

/** Streams recorded by the hidden capture window. */
export type CaptureStreamKind = 'camera' | 'mic' | 'system';

/** Push events, main → renderer. */
export interface IpcEventMap {
  'recording:status': RecordingStatus;
  'capture:command': CaptureCommand;
  'hotkey:toggleRecording': void;
  'project:opened': { projectId: string };
}

/** Commands sent to the hidden capture window (webcam/mic/system audio). */
export type CaptureCommand =
  | { kind: 'start'; config: RecordingConfig; bundleDir: string }
  | { kind: 'stop' }
  | { kind: 'abort' };

export interface AppSettings {
  lastRecordingConfig?: RecordingConfig;
  /** Remembered area per display id. */
  rememberedAreas: Record<string, { x: number; y: number; width: number; height: number }>;
  hotkeyToggleRecording: string;
  exportDefaults: { fps: 30 | 60; bitrateMbps: number };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  rememberedAreas: {},
  hotkeyToggleRecording: 'CommandOrControl+Shift+2',
  exportDefaults: { fps: 60, bitrateMbps: 12 },
};

export type IpcInvokeChannel = keyof IpcInvokeMap;
export type IpcEventChannel = keyof IpcEventMap;

/** Shape of the API the preload exposes as `window.smoothcut`. */
export interface SmoothcutApi {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    ...args: Parameters<IpcInvokeMap[C]>
  ): Promise<ReturnType<IpcInvokeMap[C]>>;
  on<C extends IpcEventChannel>(
    channel: C,
    listener: (payload: IpcEventMap[C]) => void,
  ): () => void;
  platform: 'darwin' | 'win32';
}
