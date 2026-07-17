import { app, desktopCapturer, globalShortcut, screen, session as electronSession, BrowserWindow, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { DEFAULT_APP_SETTINGS } from '@smoothcut/shared';
import type { RecordingStatus } from '@smoothcut/shared';
import { devEditorOnFinalize, devHarnessActive, maybeStartDevHarness } from './devHarness.js';
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

  /**
   * Recorder panel gets out of the shot while recording. It only comes BACK
   * on cancel or failure (the user is mid-flow and needs the toolbar); a
   * finalized recording hands off to the editor, so the toolbar stays hidden
   * — still reachable via tray, hotkey, or dock click. 'stopping' keeps it
   * hidden until the outcome is known.
   */
  const onRecordingStatus = (status: RecordingStatus): void => {
    tray?.onStatus(status);
    if (status.state === prevRecordingState) return;
    prevRecordingState = status.state;
    if (status.state === 'recording') {
      if (recorderWindow && !recorderWindow.isDestroyed() && recorderWindow.isVisible()) {
        recorderWindow.hide();
        recorderHiddenForRecording = true;
      }
    } else if (recorderHiddenForRecording) {
      if (status.state === 'finalized') {
        recorderHiddenForRecording = false;
      } else if (status.state === 'idle' || status.state === 'failed') {
        recorderHiddenForRecording = false;
        if (recorderWindow && !recorderWindow.isDestroyed()) recorderWindow.show();
      }
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
      if (!devHarnessActive() || devEditorOnFinalize()) createEditorWindow(projectId, {}, exportSink);
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
  /** (Re-)register the global start/stop shortcut. True iff it is now active. */
  const registerHotkey = (accelerator: string): boolean => {
    if (registeredHotkey !== accelerator) {
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
    }
    const active = registeredHotkey === accelerator;
    if (process.env.SMOOTHCUT_DEV_HOTKEY_PROBE === '1') {
      let system = false;
      try {
        system = globalShortcut.isRegistered(accelerator);
      } catch {
        // isRegistered throws on malformed accelerators — report false.
      }
      process.stdout.write(
        `[devharness] hotkey ${accelerator} active=${String(active)} isRegistered=${String(system)}\n`,
      );
    }
    return active;
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
        createEditorWindow(projectId, {}, exportSink);
      },
      onSettingsChanged: (next) => {
        const prev = registeredHotkey;
        if (registerHotkey(next.hotkeyToggleRecording)) return undefined;
        // Registration failed (invalid, or taken by another app): re-register
        // the last working shortcut and REVERT the stored setting, so the
        // returned settings tell the renderer the new hotkey didn't stick.
        const fallback = prev ?? DEFAULT_APP_SETTINGS.hotkeyToggleRecording;
        if (next.hotkeyToggleRecording === fallback) return undefined;
        registerHotkey(fallback);
        return settings.set({ hotkeyToggleRecording: fallback });
      },
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
      maybeStartDevHarness(session, (id) => projects.bundleDir(id), {
        openRecorder: showRecorderWindow,
      });
    } else {
      tray = new AppTray({
        projects,
        toggleRecording,
        openRecorder: showRecorderWindow,
        openEditor: (projectId) => createEditorWindow(projectId, {}, exportSink),
      });
      tray.create();
      showRecorderWindow();
    }

    app.on('activate', () => {
      // Dock click: reopen the toolbar when nothing is on screen. The recorder
      // window may still EXIST hidden (kept out of the way after a finished
      // recording), so count only visible windows.
      const anyVisible = BrowserWindow.getAllWindows().some(
        (w) => !w.isDestroyed() && w.isVisible(),
      );
      if (!anyVisible) showRecorderWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
