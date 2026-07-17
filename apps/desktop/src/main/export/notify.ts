import { basename } from 'node:path';
import { BrowserWindow, Notification, shell } from 'electron';
import type { ExportNotifyResult } from '@smoothcut/shared';

/**
 * Native completion notification for an export that finished while its
 * dialog was closed/backgrounded. Clicking it brings the window forward and
 * either reveals the file (success) or re-invokes `onClickReopen` (failure)
 * to bring the dialog's error state back into view.
 */
export function showExportNotification(
  win: BrowserWindow,
  result: ExportNotifyResult,
  onClickReopen: () => void,
): void {
  if (!Notification.isSupported()) return;
  const notification = result.ok
    ? new Notification({ title: 'Export complete', body: basename(result.destination) })
    : new Notification({ title: 'Export failed', body: result.message });
  notification.on('click', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
    if (result.ok) shell.showItemInFolder(result.destination);
    else onClickReopen();
  });
  notification.show();
}
