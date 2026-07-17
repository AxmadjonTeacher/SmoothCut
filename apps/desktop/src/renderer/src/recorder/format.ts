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

/** Electron accelerator ("CommandOrControl+Shift+2") → per-key glyphs (["⌘","⇧","2"]). */
export function hotkeyParts(accelerator: string, platform: 'darwin' | 'win32'): string[] {
  return accelerator.split('+').map((part) => {
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
        return platform === 'darwin' ? '⇧' : 'Shift';
      case 'Super':
        return platform === 'darwin' ? '⌘' : 'Win';
      default:
        return part;
    }
  });
}

/** Render an Electron accelerator ("CommandOrControl+Shift+2") as compact glyphs. */
export function formatHotkey(accelerator: string, platform: 'darwin' | 'win32'): string {
  return hotkeyParts(accelerator, platform).join(platform === 'darwin' ? '' : '+');
}

/** The subset of KeyboardEvent the accelerator conversion needs (testable shape). */
export interface HotkeyKeyEvent {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** KeyboardEvent.code → Electron accelerator key, for the keys we allow. */
const CODE_KEY_MAP: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

function acceleratorKeyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) return letter;
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) return digit;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_KEY_MAP[code] ?? null;
}

/**
 * A keydown → Electron accelerator ("CommandOrControl+Shift+2"), or null when
 * it isn't a valid global hotkey: no modifier held, or the key itself is a
 * modifier / not in the allowed set (letters, digits, F-keys, a few
 * navigation keys). Uses `code` (physical key) so ⌥-combos on macOS don't
 * turn into dead/`™`-style characters.
 */
export function keyboardEventToAccelerator(
  e: HotkeyKeyEvent,
  platform: 'darwin' | 'win32',
): string | null {
  const mods: string[] = [];
  if (platform === 'darwin' ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (platform === 'darwin' && e.ctrlKey) mods.push('Control');
  if (platform === 'win32' && e.metaKey) mods.push('Super');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (mods.length === 0) return null;
  const key = acceleratorKeyFromCode(e.code);
  if (key === null) return null;
  return [...mods, key].join('+');
}

/** Strip Electron's "Error invoking remote method 'x': Error: " wrapper from IPC rejections. */
export function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
}
