import { app, ipcMain, shell, BrowserWindow } from 'electron';
import type {
  AppSettings,
  IpcEventChannel,
  IpcEventMap,
  IpcInvokeChannel,
  IpcInvokeMap,
} from '@smoothcut/shared';
import { getPermissionsStatus, openPermissionSettings, requestPermission } from '../permissions.js';
import { listSources } from '../sources.js';
import { pickArea, resolveAreaPick } from '../windows/areaPicker.js';
import { nowMonotonicMs } from '../recording/clock.js';
import type { RecordingSession } from '../recording/session.js';
import type { ProjectStore } from '../project/store.js';
import type { ExportFileSink } from '../export/fileSink.js';
import type { SettingsStore } from '../settings.js';

type MaybePromise<T> = T | Promise<T>;

/** Typed ipcMain.handle: channel and handler signature come from IpcInvokeMap. */
function handle<C extends IpcInvokeChannel>(
  channel: C,
  handler: (...args: Parameters<IpcInvokeMap[C]>) => MaybePromise<ReturnType<IpcInvokeMap[C]>>,
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as Parameters<IpcInvokeMap[C]>)));
}

/** Typed push, main → one renderer window. */
export function send<C extends IpcEventChannel>(
  win: BrowserWindow,
  channel: C,
  payload: IpcEventMap[C],
): void {
  if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Typed push to every open window. */
export function broadcast<C extends IpcEventChannel>(channel: C, payload: IpcEventMap[C]): void {
  for (const win of BrowserWindow.getAllWindows()) send(win, channel, payload);
}

export interface IpcDeps {
  session: RecordingSession;
  projects: ProjectStore;
  exports: ExportFileSink;
  settings: SettingsStore;
  openEditor: (projectId: string) => void;
  onSettingsChanged?: (settings: AppSettings) => void;
}

export function registerIpc(deps: IpcDeps): void {
  handle('app:version', () => app.getVersion());
  handle('app:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });

  handle('permissions:status', () => getPermissionsStatus());
  handle('permissions:request', (kind) => requestPermission(kind));
  handle('permissions:openSettings', (kind) => openPermissionSettings(kind));

  handle('sources:list', () => listSources());
  handle('sources:pickArea', async (displayId) => {
    const rect = await pickArea(displayId);
    if (rect) {
      // Persist per display so the recorder panel can offer the last area.
      const current = deps.settings.get();
      deps.settings.set({ rememberedAreas: { ...current.rememberedAreas, [displayId]: rect } });
    }
    return rect;
  });
  // Area-picker overlay window → main (resolves the pending pickArea()).
  handle('area:picked', (rect) => {
    resolveAreaPick(rect);
  });

  handle('recording:start', (config) => deps.session.start(config));
  handle('recording:stop', () => deps.session.stop());
  handle('recording:cancel', () => deps.session.cancel());
  handle('recording:status', () => deps.session.status());

  handle('project:list', () => deps.projects.list());
  handle('project:load', (id) => deps.projects.load(id));
  handle('project:save', (id, project) => deps.projects.save(id, project));
  handle('project:delete', (id) => deps.projects.delete(id));
  handle('project:eventsText', (id) => deps.projects.eventsText(id));
  handle('project:openEditor', (id) => {
    deps.openEditor(id);
  });

  handle('export:pickDestination', (defaultName) => deps.exports.pickDestination(defaultName));
  handle('export:begin', (projectId, settings) => deps.exports.begin(projectId, settings));
  handle('export:writeChunk', (exportId, chunk, position) =>
    deps.exports.writeChunk(exportId, chunk, position),
  );
  handle('export:finalize', (exportId) => deps.exports.finalize(exportId));
  handle('export:abort', (exportId) => deps.exports.abort(exportId));

  handle('shell:showItemInFolder', (path) => {
    shell.showItemInFolder(path);
  });

  handle('settings:get', () => deps.settings.get());
  handle('settings:set', (patch) => {
    const next = deps.settings.set(patch);
    deps.onSettingsChanged?.(next);
    return next;
  });

  // Hidden capture window (webcam/mic/system audio) → session.
  handle('capture:ready', () => deps.session.onCaptureReady());
  handle('capture:streamStarted', (stream, mainMonotonicMs) =>
    deps.session.onCaptureStreamStarted(stream, mainMonotonicMs),
  );
  handle('capture:chunk', (stream, chunk) => deps.session.onCaptureChunk(stream, chunk));
  handle('capture:allStopped', () => deps.session.onCaptureAllStopped());
  handle('capture:error', (message) => deps.session.onCaptureError(message));
  handle('clock:now', () => nowMonotonicMs());
}
