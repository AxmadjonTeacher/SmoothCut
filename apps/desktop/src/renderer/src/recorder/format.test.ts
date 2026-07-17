import { describe, expect, it } from 'vitest';
import { formatHotkey, hotkeyParts, keyboardEventToAccelerator } from './format';
import type { HotkeyKeyEvent } from './format';

describe('hotkeyParts / formatHotkey', () => {
  it('renders macOS glyphs per key', () => {
    expect(hotkeyParts('CommandOrControl+Shift+2', 'darwin')).toEqual(['⌘', '⇧', '2']);
    expect(hotkeyParts('Control+Alt+F5', 'darwin')).toEqual(['⌃', '⌥', 'F5']);
    expect(formatHotkey('CommandOrControl+Shift+2', 'darwin')).toBe('⌘⇧2');
  });

  it('renders Windows labels joined with +', () => {
    expect(hotkeyParts('CommandOrControl+Shift+2', 'win32')).toEqual(['Ctrl', 'Shift', '2']);
    expect(formatHotkey('CommandOrControl+Alt+R', 'win32')).toBe('Ctrl+Alt+R');
  });
});

function keyEvent(partial: Partial<HotkeyKeyEvent> & { code: string }): HotkeyKeyEvent {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...partial };
}

describe('keyboardEventToAccelerator', () => {
  it('maps meta on darwin (and ctrl on win32) to CommandOrControl', () => {
    expect(keyboardEventToAccelerator(keyEvent({ code: 'Digit2', metaKey: true, shiftKey: true }), 'darwin')).toBe(
      'CommandOrControl+Shift+2',
    );
    expect(keyboardEventToAccelerator(keyEvent({ code: 'Digit2', ctrlKey: true, shiftKey: true }), 'win32')).toBe(
      'CommandOrControl+Shift+2',
    );
  });

  it('keeps darwin ctrl as Control (distinct from ⌘)', () => {
    expect(keyboardEventToAccelerator(keyEvent({ code: 'KeyR', ctrlKey: true }), 'darwin')).toBe('Control+R');
    expect(
      keyboardEventToAccelerator(keyEvent({ code: 'KeyR', metaKey: true, ctrlKey: true }), 'darwin'),
    ).toBe('CommandOrControl+Control+R');
  });

  it('uses the physical key for letters (option-combos stay plain letters)', () => {
    expect(keyboardEventToAccelerator(keyEvent({ code: 'KeyK', altKey: true }), 'darwin')).toBe('Alt+K');
  });

  it('accepts F-keys and navigation keys', () => {
    expect(keyboardEventToAccelerator(keyEvent({ code: 'F6', shiftKey: true }), 'darwin')).toBe('Shift+F6');
    expect(keyboardEventToAccelerator(keyEvent({ code: 'F24', altKey: true }), 'win32')).toBe('Alt+F24');
    expect(keyboardEventToAccelerator(keyEvent({ code: 'Space', metaKey: true }), 'darwin')).toBe(
      'CommandOrControl+Space',
    );
    expect(keyboardEventToAccelerator(keyEvent({ code: 'ArrowUp', metaKey: true }), 'darwin')).toBe(
      'CommandOrControl+Up',
    );
  });

  it('rejects keys without any modifier', () => {
    expect(keyboardEventToAccelerator(keyEvent({ code: 'KeyA' }), 'darwin')).toBeNull();
    expect(keyboardEventToAccelerator(keyEvent({ code: 'F5' }), 'win32')).toBeNull();
  });

  it('rejects bare modifiers and unsupported keys', () => {
    expect(keyboardEventToAccelerator(keyEvent({ code: 'ShiftLeft', shiftKey: true }), 'darwin')).toBeNull();
    expect(keyboardEventToAccelerator(keyEvent({ code: 'MetaLeft', metaKey: true }), 'darwin')).toBeNull();
    expect(keyboardEventToAccelerator(keyEvent({ code: 'F25', metaKey: true }), 'darwin')).toBeNull();
    expect(keyboardEventToAccelerator(keyEvent({ code: 'Escape', metaKey: true }), 'darwin')).toBeNull();
  });
});
