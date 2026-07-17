/**
 * Auto-update: checks GitHub Releases for a newer version. The feed (owner/
 * repo) is baked into app-update.yml at build time from electron-builder.yml's
 * `publish` block — no server of our own to run.
 *
 * Best-effort and silent: an unsigned build can check for and download an
 * update, but Squirrel.Mac requires a consistently signed app to actually
 * install it, so this stays a harmless no-op on failure until the app is
 * code-signed (see README "Auto-update").
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
  if (!app.isPackaged) return;
  void (async () => {
    try {
      const autoUpdater = resolveAutoUpdater(await import('electron-updater'));
      if (!autoUpdater) return;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('error', () => {
        // Unreachable feed / unsigned build — never surface at startup.
      });
      await autoUpdater.checkForUpdatesAndNotify();
    } catch {
      // Missing module or misconfigured feed must never break the app.
    }
  })();
}
