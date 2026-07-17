import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { Rect } from '@smoothcut/shared';

const PRELOAD = join(import.meta.dirname, '../preload/index.mjs');
const RENDERER_HTML = join(import.meta.dirname, '../renderer/index.html');

type Query = Record<string, string>;

function loadRenderer(win: BrowserWindow, query: Query): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(RENDERER_HTML, Object.keys(query).length > 0 ? { query } : undefined);
  }
}

export function createRecorderWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 700,
    resizable: false,
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: false },
  });
  win.once('ready-to-show', () => win.show());
  loadRenderer(win, {});
  return win;
}

export function createEditorWindow(projectId: string, extraQuery: Query = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: false },
  });
  win.once('ready-to-show', () => win.show());
  loadRenderer(win, { view: 'editor', projectId, ...extraQuery });
  return win;
}

/** Hidden window that records webcam/mic/system audio via getUserMedia + MediaRecorder. */
export function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: false, backgroundThrottling: false },
  });
  loadRenderer(win, { view: 'capture' });
  return win;
}

/** Floating always-on-top webcam bubble shown while recording (drag to move). */
export function createBubbleWindow(deviceId: string, position?: { x: number; y: number }): BrowserWindow {
  const win = new BrowserWindow({
    width: 240,
    height: 240,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    ...(position ?? {}),
    webPreferences: { preload: PRELOAD, sandbox: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.showInactive());
  loadRenderer(win, { view: 'bubble', deviceId });
  return win;
}

/**
 * Full-screen click-through countdown overlay on the capture display.
 * Never takes focus (the app being recorded keeps it).
 */
export function createCountdownWindow(displayBounds: Rect): BrowserWindow {
  const win = new BrowserWindow({
    x: Math.round(displayBounds.x),
    y: Math.round(displayBounds.y),
    width: Math.round(displayBounds.width),
    height: Math.round(displayBounds.height),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.once('ready-to-show', () => win.showInactive());
  loadRenderer(win, { view: 'countdown' });
  return win;
}

/**
 * Full-screen drag-select overlay for area capture. Focused so Esc/Enter work;
 * the renderer reports the result over the 'area:picked' invoke channel.
 */
export function createAreaPickerWindow(displayId: string, displayBounds: Rect): BrowserWindow {
  const win = new BrowserWindow({
    x: Math.round(displayBounds.x),
    y: Math.round(displayBounds.y),
    width: Math.round(displayBounds.width),
    height: Math.round(displayBounds.height),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  loadRenderer(win, { view: 'area-picker', displayId });
  return win;
}
