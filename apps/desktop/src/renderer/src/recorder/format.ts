/** Pure formatting helpers for the recorder panel. */

/** mm:ss from milliseconds (floors negative to 0). */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Compact relative date: "just now", "5m ago", "3h ago", "yesterday", "4d ago", then "Mar 2". */
export function formatRelativeDate(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Render an Electron accelerator ("CommandOrControl+Shift+2") as compact glyphs. */
export function formatHotkey(accelerator: string, platform: 'darwin' | 'win32'): string {
  return accelerator
    .split('+')
    .map((part) => {
      switch (part) {
        case 'CommandOrControl':
        case 'CmdOrCtrl':
          return platform === 'darwin' ? '⌘' : 'Ctrl';
        case 'Command':
        case 'Cmd':
          return '⌘';
        case 'Control':
        case 'Ctrl':
          return platform === 'darwin' ? '⌃' : 'Ctrl';
        case 'Alt':
        case 'Option':
          return platform === 'darwin' ? '⌥' : 'Alt';
        case 'Shift':
          return '⇧';
        default:
          return part;
      }
    })
    .join(platform === 'darwin' ? '' : '+');
}

/** Strip Electron's "Error invoking remote method 'x': Error: " wrapper from IPC rejections. */
export function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
}
