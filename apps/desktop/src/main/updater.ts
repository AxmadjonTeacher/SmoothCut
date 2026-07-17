/**
 * Auto-update wiring (config-level only for now). Deliberately inert unless
 * BOTH hold:
 *   - the app is packaged (electron-updater refuses dev builds anyway), and
 *   - SMOOTHCUT_UPDATE_URL points at a generic update server.
 *
 * A real update server plus code signing (macOS REQUIRES a signed app for
 * updates to install) are needed before this does anything useful — see the
 * README "Auto-update" section. Never throws: updates are best-effort.
 */
import { app } from 'electron';
import type { AppUpdater } from 'electron-updater';

/**
 * electron-updater is CJS and defines `autoUpdater` via a getter, which
 * cjs-module-lexer can't always surface as an ESM named export — probe the
 * namespace first, then the CJS default.
 */
function resolveAutoUpdater(mod: unknown): AppUpdater | undefined {
  const ns = mod as { autoUpdater?: AppUpdater; default?: { autoUpdater?: AppUpdater } };
  return ns.autoUpdater ?? ns.default?.autoUpdater;
}

export function initUpdater(): void {
  const url = process.env.SMOOTHCUT_UPDATE_URL;
  if (!app.isPackaged || !url) return;
  void (async () => {
    try {
      const autoUpdater = resolveAutoUpdater(await import('electron-updater'));
      if (!autoUpdater) return;
      autoUpdater.setFeedURL({ provider: 'generic', url });
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('error', () => {
        // Unreachable server / unsigned build — never surface at startup.
      });
      await autoUpdater.checkForUpdatesAndNotify();
    } catch {
      // Missing module or misconfigured feed must never break the app.
    }
  })();
}
