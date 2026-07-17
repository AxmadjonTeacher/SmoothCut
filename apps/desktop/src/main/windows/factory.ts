import { join } from 'node:path';
import { BrowserWindow, dialog, screen } from 'electron';
import type { Rect } from '@smoothcut/shared';
import type { ExportFileSink } from '../export/fileSink.js';

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

/**
 * The recorder toolbar window: a transparent canvas the renderer draws a
 * compact floating pill into (top of the window), leaving room below for the
 * expandable settings panel without ever resizing the window.
 */
const RECORDER_W = 760;
const RECORDER_H = 560;

/** Last user-chosen toolbar position, remembered across opens (per app run). */
let recorderPos: { x: number; y: number } | undefined;

export function createRecorderWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: RECORDER_W,
    height: RECORDER_H,
    frame: false,
    transparent: true,
    // Native transparent background BEFORE first paint — the renderer's own
    // `background: transparent` is only applied by a useEffect, which runs
    // after React's first paint. ready-to-show can fire before that effect
    // runs, so without this the window briefly shows opaque at full window
    // size (760x560) before snapping to just the small pill — a visible
    // flash on every launch.
    backgroundColor: '#00000000',
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: false,
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  if (recorderPos) {
    win.setPosition(recorderPos.x, recorderPos.y);
  } else {
    // First open: pill centered horizontally in the lower third of the
    // primary display, clamped so the settings panel below it stays on screen.
    const wa = screen.getPrimaryDisplay().workArea;
    const x = Math.round(wa.x + (wa.width - RECORDER_W) / 2);
    const y = Math.round(Math.min(wa.y + wa.height * 0.62, wa.y + wa.height - RECORDER_H));
    win.setPosition(x, Math.max(wa.y, y));
  }
  const remember = (): void => {
    const [x, y] = win.getPosition();
    if (x !== undefined && y !== undefined) recorderPos = { x, y };
  };
  win.on('moved', remember);
  win.on('close', remember);
  win.once('ready-to-show', () => win.show());
  loadRenderer(win, {});
  return win;
}

export function createEditorWindow(
  projectId: string,
  extraQuery: Query = {},
  exportSink?: ExportFileSink,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: false },
  });
  // A backgrounded export survives the dialog closing but not the window
  // closing (its Worker dies with the webContents) — confirm before losing it.
  if (exportSink) {
    let allowClose = false;
    win.on('close', (event) => {
      if (allowClose) return;
      const activeExportId = exportSink.activeExportIdForWindow(win.webContents.id);
      if (!activeExportId) return;
      event.preventDefault();
      void dialog
        .showMessageBox(win, {
          type: 'warning',
          buttons: ['Keep Exporting', 'Stop Export && Close'],
          defaultId: 0,
          cancelId: 0,
          message: 'Export in progress',
          detail: "This export hasn't finished. Closing now cancels it and deletes the partial file.",
        })
        .then(({ response }) => (response === 1 ? exportSink.abort(activeExportId) : undefined))
        .then(() => {
          allowClose = true;
          win.close();
        })
        .catch(() => {
          allowClose = true;
          win.close();
        });
    });
  }
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
    backgroundColor: '#00000000',
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
 * Small always-on-top control pill shown while recording (stop / elapsed /
 * discard) at the top-center of the recorded display. Created HIDDEN before
 * the screen recorder starts so its CGWindowID can be excluded from display
 * capture; the session shows it once recording actually begins.
 */
const RECORDING_PILL_W = 220;
const RECORDING_PILL_H = 48;
const RECORDING_PILL_MARGIN = 12;

export function createRecordingPillWindow(displayBounds: Rect): BrowserWindow {
  const win = new BrowserWindow({
    x: Math.round(displayBounds.x + (displayBounds.width - RECORDING_PILL_W) / 2),
    y: Math.round(displayBounds.y + RECORDING_PILL_MARGIN),
    width: RECORDING_PILL_W,
    height: RECORDING_PILL_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    acceptFirstMouse: true,
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadRenderer(win, { view: 'recording-pill' });
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
    backgroundColor: '#00000000',
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
 * roundedCorners/enableLargerThanScreen plus the post-show setBounds re-assert
 * keep the overlay covering the WHOLE display (macOS otherwise constrains the
 * frame around the menu bar, leaving an offset strip uncovered).
 */
export function createAreaPickerWindow(displayId: string, displayBounds: Rect): BrowserWindow {
  const bounds = {
    x: Math.round(displayBounds.x),
    y: Math.round(displayBounds.y),
    width: Math.round(displayBounds.width),
    height: Math.round(displayBounds.height),
  };
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    roundedCorners: false,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: { preload: PRELOAD, sandbox: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    // macOS may have constrained the initial frame — re-assert after show.
    win.setBounds(bounds);
  });
  loadRenderer(win, { view: 'area-picker', displayId });
  return win;
}
