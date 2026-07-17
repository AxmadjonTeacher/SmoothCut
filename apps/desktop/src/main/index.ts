import { app, desktopCapturer, globalShortcut, screen, session as electronSession, BrowserWindow, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import type { RecordingStatus } from '@smoothcut/shared';
import { devHarnessActive, maybeStartDevHarness } from './devHarness.js';
import { registerSmoothcutProtocol, registerSmoothcutSchemeAsPrivileged } from './project/protocol.js';
import { ProjectStore } from './project/store.js';
import { RecordingSession } from './recording/session.js';
import { ExportFileSink } from './export/fileSink.js';
import { SettingsStore } from './settings.js';
import { broadcast, registerIpc } from './ipc/register.js';
import { initUpdater } from './updater.js';
import { AppTray } from './tray.js';
import { createEditorWindow, createRecorderWindow } from './windows/factory.js';

// Must run before app ready.
registerSmoothcutSchemeAsPrivileged();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const projects = new ProjectStore();
  const settings = new SettingsStore();
  const exportSink = new ExportFileSink();

  let recorderWindow: BrowserWindow | undefined;
  let tray: AppTray | undefined;
  let prevRecordingState: RecordingStatus['state'] = 'idle';
  let recorderHiddenForRecording = false;

  const showRecorderWindow = (): void => {
    if (!recorderWindow || recorderWindow.isDestroyed()) {
      recorderWindow = createRecorderWindow();
    } else {
      if (recorderWindow.isMinimized()) recorderWindow.restore();
      recorderWindow.show();
      recorderWindow.focus();
    }
  };

  /** Recorder panel gets out of the shot while recording, comes back on stop. */
  const onRecordingStatus = (status: RecordingStatus): void => {
    tray?.onStatus(status);
    if (status.state === prevRecordingState) return;
    const prev = prevRecordingState;
    prevRecordingState = status.state;
    if (status.state === 'recording') {
      if (recorderWindow && !recorderWindow.isDestroyed() && recorderWindow.isVisible()) {
        recorderWindow.hide();
        recorderHiddenForRecording = true;
      }
    } else if (prev === 'recording' && recorderHiddenForRecording) {
      recorderHiddenForRecording = false;
      if (recorderWindow && !recorderWindow.isDestroyed()) recorderWindow.show();
    }
    if (status.state === 'finalized') tray?.refresh();
  };

  const session = new RecordingSession({
    store: projects,
    broadcastStatus: (status) => {
      onRecordingStatus(status);
      broadcast('recording:status', status);
    },
    onFinalized: (projectId) => {
      if (!devHarnessActive()) createEditorWindow(projectId);
      broadcast('project:opened', { projectId });
    },
  });

  /**
   * Tray start/stop goes through the same path as the global hotkey: the
   * recorder panel (possibly hidden) owns the toggle and uses its current —
   * i.e. last-used — config. With no panel alive there is nothing to toggle,
   * so open one instead.
   */
  const toggleRecording = (): void => {
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      broadcast('hotkey:toggleRecording', undefined);
    } else {
      showRecorderWindow();
    }
  };

  let registeredHotkey: string | undefined;
  const registerHotkey = (accelerator: string): void => {
    if (registeredHotkey === accelerator) return;
    if (registeredHotkey !== undefined) globalShortcut.unregister(registeredHotkey);
    registeredHotkey = undefined;
    try {
      const ok = globalShortcut.register(accelerator, () =>
        broadcast('hotkey:toggleRecording', undefined),
      );
      if (ok) registeredHotkey = accelerator;
    } catch {
      // A malformed accelerator in settings must not crash startup.
    }
  };

  app.on('second-instance', showRecorderWindow);

  void app.whenReady().then(() => {
    registerSmoothcutProtocol(projects);

    // System-audio loopback: the hidden capture window calls getDisplayMedia
    // ({video:true, audio:true}), which lands here. We hand back the primary
    // screen's video source (immediately discarded by the caller) plus the
    // OS loopback audio device.
    electronSession.defaultSession.setDisplayMediaRequestHandler(
      (_request, callback) => {
        void desktopCapturer
          .getSources({ types: ['screen'] })
          .then((sources) => {
            const primaryId = String(screen.getPrimaryDisplay().id);
            const source = sources.find((s) => s.display_id === primaryId) ?? sources[0];
            if (source) callback({ video: source, audio: 'loopback' });
            else callback({});
          })
          .catch(() => callback({}));
      },
      { useSystemPicker: false },
    );
    registerIpc({
      session,
      projects,
      exports: exportSink,
      settings,
      openEditor: (projectId) => {
        createEditorWindow(projectId);
      },
      onSettingsChanged: (next) => registerHotkey(next.hotkeyToggleRecording),
    });
    registerHotkey(settings.get().hotkeyToggleRecording);
    initUpdater();

    // Standard menu so Cmd/Ctrl+C/V/X/A work in text inputs.
    const menuTemplate: MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

    if (devHarnessActive()) {
      maybeStartDevHarness(session, (id) => projects.bundleDir(id));
    } else {
      tray = new AppTray({
        projects,
        toggleRecording,
        openRecorder: showRecorderWindow,
        openEditor: (projectId) => createEditorWindow(projectId),
      });
      tray.create();
      showRecorderWindow();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showRecorderWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
