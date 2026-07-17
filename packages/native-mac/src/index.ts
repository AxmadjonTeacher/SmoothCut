import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clockOffsetMs, mainMonotonicNowMs, swiftToMainMs } from './clock.js';
import { createLineSplitter, parseRecorderLine, type RecorderEvent } from './protocol.js';

export interface MacDisplay {
  id: string;
  widthPt: number;
  heightPt: number;
  scaleFactor: number;
  originX: number;
  originY: number;
  isPrimary: boolean;
  label: string;
}

export interface MacWindow {
  id: string;
  title: string;
  appName: string;
  displayId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function recorderBinaryPath(): string {
  const override = process.env['SMOOTHCUT_RECORDER_BIN'];
  if (override) return override;
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(srcDir, '..', 'bin', 'smoothcut-recorder');
}

async function runRecorderCommand(args: string[]): Promise<string> {
  const child = spawn(recorderBinaryPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const [code] = (await once(child, 'close')) as [number | null];
  if (code !== 0) {
    throw new Error(`smoothcut-recorder ${args[0] ?? ''} exited with code ${code}: ${stderr.trim()}`);
  }
  return stdout;
}

export async function listShareableContent(): Promise<{ displays: MacDisplay[]; windows: MacWindow[] }> {
  const stdout = await runRecorderCommand(['list']);
  const parsed = JSON.parse(stdout) as { displays: MacDisplay[]; windows: MacWindow[] };
  return { displays: parsed.displays, windows: parsed.windows };
}

export async function checkScreenPermission(): Promise<'granted' | 'denied'> {
  const stdout = await runRecorderCommand(['check-permission']);
  const parsed = JSON.parse(stdout) as { status: string };
  return parsed.status === 'granted' ? 'granted' : 'denied';
}

export async function requestScreenPermission(): Promise<boolean> {
  const stdout = await runRecorderCommand(['request-permission']);
  const parsed = JSON.parse(stdout) as { granted: boolean };
  return parsed.granted === true;
}

export interface MacRecorderOptions {
  displayId: string;
  windowId?: string;
  cropRectPx?: { x: number; y: number; width: number; height: number };
  fps: 30 | 60;
  outputPath: string;
  cursorsDir: string;
}

export interface MacRecorderCallbacks {
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

export interface MacRecorderHandle {
  stop(): Promise<{ durationMs: number }>;
  kill(): void;
}

const STOP_TIMEOUT_MS = 10_000;

export async function startMacRecorder(
  opts: MacRecorderOptions,
  cb: MacRecorderCallbacks,
): Promise<MacRecorderHandle> {
  const config = {
    displayId: Number(opts.displayId),
    ...(opts.windowId !== undefined ? { windowId: Number(opts.windowId) } : {}),
    ...(opts.cropRectPx !== undefined ? { cropRect: opts.cropRectPx } : {}),
    fps: opts.fps,
    outputPath: opts.outputPath,
    cursorsDir: opts.cursorsDir,
  };
  const child = spawn(recorderBinaryPath(), ['record', JSON.stringify(config)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let offsetMs: number | null = null;
  let stoppedDurationMs: number | null = null;
  let exited = false;
  let exitCode: number | null = null;
  let stderrTail = '';
  let lastErrorMessage: string | null = null;
  let readySettled = false;
  const exitWaiters: Array<() => void> = [];

  let resolveReady!: (handle: MacRecorderHandle) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<MacRecorderHandle>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const handle: MacRecorderHandle = {
    async stop() {
      if (exited) {
        if (stoppedDurationMs !== null) return { durationMs: stoppedDurationMs };
        throw new Error(
          `recorder already exited (code ${exitCode}) without stopped event: ${stderrTail.trim()}`,
        );
      }
      try {
        child.stdin.write('stop\n');
      } catch {
        // stdin already closed; the exit waiter below still settles.
      }
      const finished = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), STOP_TIMEOUT_MS);
        exitWaiters.push(() => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      if (!finished) {
        child.kill('SIGKILL');
        throw new Error(`recorder did not stop within ${STOP_TIMEOUT_MS}ms; killed`);
      }
      if (stoppedDurationMs === null) {
        throw new Error(
          `recorder exited (code ${exitCode}) without stopped event: ${
            lastErrorMessage ?? stderrTail.trim()
          }`,
        );
      }
      return { durationMs: stoppedDurationMs };
    },
    kill() {
      child.kill('SIGKILL');
    },
  };

  const onEvent = (event: RecorderEvent): void => {
    switch (event.event) {
      case 'ready':
        if (!readySettled) {
          offsetMs = clockOffsetMs(mainMonotonicNowMs(), event.swiftMs);
          readySettled = true;
          resolveReady(handle);
        }
        break;
      case 'firstFrame':
        if (offsetMs !== null) cb.onFirstFrame(swiftToMainMs(event.swiftMs, offsetMs));
        break;
      case 'cursorShape':
        if (offsetMs !== null) {
          cb.onCursorShape({
            mainMonotonicMs: swiftToMainMs(event.swiftMs, offsetMs),
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
        stoppedDurationMs = event.durationMs;
        break;
      case 'error':
        lastErrorMessage = event.message;
        cb.onError(event.message);
        break;
    }
  };

  const splitter = createLineSplitter((line) => {
    const event = parseRecorderLine(line);
    if (event) onEvent(event);
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => splitter.push(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4096);
  });

  child.on('error', (error) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error instanceof Error ? error : new Error(String(error)));
    } else {
      cb.onError(error.message);
    }
  });
  child.on('close', (code) => {
    exited = true;
    exitCode = code;
    splitter.flush();
    if (!readySettled) {
      readySettled = true;
      rejectReady(
        new Error(
          `recorder exited before ready (code ${code}): ${lastErrorMessage ?? stderrTail.trim()}`,
        ),
      );
    }
    for (const waiter of exitWaiters.splice(0)) waiter();
  });

  return ready;
}
