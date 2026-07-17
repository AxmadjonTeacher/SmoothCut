/**
 * TS wrapper over the smoothcut-native-win napi addon. Mirrors the surface of
 * @smoothcut/native-mac: listShareableContent / checkScreenPermission /
 * requestScreenPermission / startWinRecorder(opts, callbacks) → handle.
 *
 * The addon is loaded lazily; on non-win32 platforms every function throws
 * Error('windows-only') so this module is safe to import anywhere.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clockOffsetMs, mainMonotonicNowMs, nativeToMainMs } from './clock.js';
import { parseRecorderLine, type RecorderEvent } from './protocol.js';

export interface WinDisplay {
  id: string;
  widthPt: number;
  heightPt: number;
  scaleFactor: number;
  originX: number;
  originY: number;
  isPrimary: boolean;
  label: string;
}

export interface WinWindow {
  id: string;
  title: string;
  appName: string;
  displayId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NativeAddon {
  listShareableContent(): string;
  startRecording(configJson: string, callback: (err: Error | null, line: string) => void): number;
  stopRecording(handle: number): Promise<number>;
}

/**
 * Path of the .node addon: SMOOTHCUT_WIN_ADDON override (used by the packaged
 * app), else the napi-cli output at the package root
 * (`napi build --platform` names it smoothcut-native-win.win32-<arch>-msvc.node).
 */
export function addonPath(): string {
  const override = process.env['SMOOTHCUT_WIN_ADDON'];
  if (override) return override;
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(srcDir, '..', `smoothcut-native-win.win32-${process.arch}-msvc.node`);
}

let cachedAddon: NativeAddon | undefined;

function loadAddon(): NativeAddon {
  if (process.platform !== 'win32') {
    throw new Error('windows-only');
  }
  if (!cachedAddon) {
    const require = createRequire(import.meta.url);
    cachedAddon = require(addonPath()) as NativeAddon;
  }
  return cachedAddon;
}

export async function listShareableContent(): Promise<{ displays: WinDisplay[]; windows: WinWindow[] }> {
  const parsed = JSON.parse(loadAddon().listShareableContent()) as {
    displays: WinDisplay[];
    windows: WinWindow[];
  };
  return { displays: parsed.displays, windows: parsed.windows };
}

/** Windows has no screen-recording TCC equivalent — capture always works. */
export async function checkScreenPermission(): Promise<'granted' | 'denied'> {
  if (process.platform !== 'win32') throw new Error('windows-only');
  return 'granted';
}

export async function requestScreenPermission(): Promise<boolean> {
  if (process.platform !== 'win32') throw new Error('windows-only');
  return true;
}

export interface WinRecorderOptions {
  displayId: string;
  windowId?: string;
  /** Physical px, relative to the display's top-left. */
  cropRectPx?: { x: number; y: number; width: number; height: number };
  fps: 30 | 60;
  outputPath: string;
  cursorsDir: string;
}

export interface WinRecorderCallbacks {
  onFirstFrame(mainMonotonicMs: number): void;
  onCursorShape(e: {
    mainMonotonicMs: number;
    shapeId: string;
    hotspot: { x: number; y: number };
    sizePx: { w: number; h: number };
  }): void;
  onStats(s: { frames: number; dropped: number }): void;
  onError(message: string): void;
}

export interface WinRecorderHandle {
  stop(): Promise<{ durationMs: number }>;
  kill(): void;
}

export async function startWinRecorder(
  opts: WinRecorderOptions,
  cb: WinRecorderCallbacks,
): Promise<WinRecorderHandle> {
  const addon = loadAddon();
  const config = {
    displayId: opts.displayId,
    ...(opts.windowId !== undefined ? { windowId: opts.windowId } : {}),
    ...(opts.cropRectPx !== undefined ? { cropRectPx: opts.cropRectPx } : {}),
    fps: opts.fps,
    outputPath: opts.outputPath,
    cursorsDir: opts.cursorsDir,
  };

  let offsetMs: number | null = null;
  let readySettled = false;

  let resolveReady!: (handle: WinRecorderHandle) => void;
  const ready = new Promise<WinRecorderHandle>((resolve) => {
    resolveReady = resolve;
  });

  // Assigned right after startRecording returns; the threadsafe callback is
  // only ever invoked from a later event-loop turn, so onEvent can never see
  // it unset.
  let handle!: WinRecorderHandle;

  const onEvent = (event: RecorderEvent): void => {
    switch (event.event) {
      case 'ready':
        if (!readySettled) {
          offsetMs = clockOffsetMs(mainMonotonicNowMs(), event.nativeMs);
          readySettled = true;
          resolveReady(handle);
        }
        break;
      case 'firstFrame':
        if (offsetMs !== null) cb.onFirstFrame(nativeToMainMs(event.nativeMs, offsetMs));
        break;
      case 'cursorShape':
        if (offsetMs !== null) {
          cb.onCursorShape({
            mainMonotonicMs: nativeToMainMs(event.nativeMs, offsetMs),
            shapeId: event.shapeId,
            hotspot: { x: event.hotspotX, y: event.hotspotY },
            sizePx: { w: event.w, h: event.h },
          });
        }
        break;
      case 'stats':
        cb.onStats({ frames: event.frames, dropped: event.dropped });
        break;
      case 'stopped':
        // durationMs is authoritative via stopRecording()'s promise.
        break;
      case 'error':
        cb.onError(event.message);
        break;
    }
  };

  // Throws synchronously if the capture cannot start (bad source, encoder
  // init failure, ...) — the async wrapper surfaces that as a rejection.
  const id = addon.startRecording(JSON.stringify(config), (err, line) => {
    if (err) {
      cb.onError(err.message);
      return;
    }
    const event = parseRecorderLine(line);
    if (event) onEvent(event);
  });

  handle = {
    async stop() {
      const durationMs = await addon.stopRecording(id);
      return { durationMs };
    },
    kill() {
      // Best effort: same teardown path; a second stop of the same handle
      // rejects with unknown-handle, which is fine to swallow.
      void addon.stopRecording(id).then(
        () => {},
        () => {},
      );
    },
  };

  return ready;
}
