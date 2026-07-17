import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { powerSaveBlocker, systemPreferences } from 'electron';
import type { BrowserWindow } from 'electron';
import checkDiskSpace from 'check-disk-space';
import { createDefaultProject } from '@smoothcut/shared';
import type {
  CaptureStreamKind,
  RecordingConfig,
  RecordingMeta,
  RecordingState,
  RecordingStatus,
} from '@smoothcut/shared';
import { nativeMac, nativeWin } from '../native.js';
import { nowMonotonicMs } from './clock.js';
import { resolveCaptureGeometry } from './geometry.js';
import type { CaptureGeometry } from './geometry.js';
import { CaptureSink } from './captureSink.js';
import { InputLogger } from '../input/logger.js';
import { REL } from '../project/store.js';
import type { ProjectStore } from '../project/store.js';
import { listSources } from '../sources.js';
import { send } from '../ipc/register.js';
import {
  createBubbleWindow,
  createCaptureWindow,
  createCountdownWindow,
  createRecordingPillWindow,
} from '../windows/factory.js';

/** Structural recorder handle — MacRecorderHandle and WinRecorderHandle both match. */
interface RecorderHandle {
  stop(): Promise<{ durationMs: number }>;
  kill(): void;
}

const STATUS_PUSH_MS = 500;
const DISK_CHECK_MS = 5000;
const MIN_FREE_DISK_BYTES = 2 * 1024 ** 3;
/** Max wait for the hidden capture window to boot / start / flush its streams. */
const CAPTURE_ACK_TIMEOUT_MS = 10_000;
const BUBBLE_SIZE = 240;
const BUBBLE_MARGIN = 24;
/** Max wait for an overlay window to reach the screen before recording starts. */
const OVERLAY_SHOW_TIMEOUT_MS = 3000;
/** Dev harness only: record without the global input hook (no Accessibility needed). */
const DEV_NO_INPUT = process.env.SMOOTHCUT_DEV_NO_INPUT === '1';

export interface RecordingSessionDeps {
  store: ProjectStore;
  broadcastStatus: (status: RecordingStatus) => void;
  onFinalized: (projectId: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejection may land before anyone awaits — never let it go unhandled.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function withTimeout(promise: Promise<void>, ms: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function expectedCaptureStreams(config: RecordingConfig): Set<CaptureStreamKind> {
  const streams = new Set<CaptureStreamKind>();
  if (config.webcam) streams.add('camera');
  if (config.mic) streams.add('mic');
  if (config.systemAudio) streams.add('system');
  return streams;
}

/**
 * CGWindowID of one of our overlay windows, parsed out of Electron's media
 * source id ('window:<CGWindowID>:<n>') — the id space ScreenCaptureKit's
 * window-exclusion list expects.
 */
function cgWindowId(win: BrowserWindow | undefined): string | undefined {
  if (!win || win.isDestroyed()) return undefined;
  try {
    const id = win.getMediaSourceId().split(':')[1];
    return id !== undefined && Number(id) > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves once `win` is showing (or after `timeoutMs`). The Swift recorder
 * resolves excludeWindowIds against SCShareableContent with
 * onScreenWindowsOnly=true, so an excluded overlay window MUST be on screen
 * before the recorder process starts — a merely-created (hidden) window would
 * silently not be excluded and end up in the capture.
 */
function whenWindowShown(win: BrowserWindow | undefined, timeoutMs: number): Promise<void> {
  if (!win || win.isDestroyed() || win.isVisible()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      win.removeListener('show', onShow);
      resolve();
    }, timeoutMs);
    const onShow = (): void => {
      clearTimeout(timer);
      resolve();
    };
    win.once('show', onShow);
  });
}

/** One active recording at a time; owns the native recorder + input logger. */
export class RecordingSession {
  private readonly deps: RecordingSessionDeps;

  private state: RecordingState = 'idle';
  private projectId: string | undefined;
  private error: string | undefined;
  private countdownRemaining: number | undefined;
  private freeDiskBytes: number | undefined;
  private cancelRequested = false;

  private config: RecordingConfig | undefined;
  private geometry: CaptureGeometry | undefined;
  private displays: Awaited<ReturnType<typeof listSources>>['displays'] = [];
  private recorder: RecorderHandle | undefined;
  private logger: InputLogger | undefined;
  private powerBlockerId: number | undefined;
  private epoch = 0;
  private screenFirstFrame: number | undefined;
  private startedAtMonotonic = 0;
  private finalDurationMs = 0;
  private createdAt = new Date();

  private statusTimer: ReturnType<typeof setInterval> | undefined;
  private diskTimer: ReturnType<typeof setInterval> | undefined;

  /** Auxiliary-stream capture (webcam/mic/system audio) via the hidden window. */
  private readonly captureSink = new CaptureSink();
  private captureWindow: BrowserWindow | undefined;
  private bubbleWindow: BrowserWindow | undefined;
  private pillWindow: BrowserWindow | undefined;
  private countdownWindow: BrowserWindow | undefined;
  private captureExpected = new Set<CaptureStreamKind>();
  private captureWindowReady: Deferred | undefined;
  private captureStarted: Deferred | undefined;
  private captureStopped: Deferred | undefined;

  constructor(deps: RecordingSessionDeps) {
    this.deps = deps;
  }

  // ---------------------------------------------------- capture window plumbing
  // Called by the IPC layer; every message is a no-op unless a capture window
  // for the active session is expected to be talking to us.

  onCaptureReady(): void {
    this.captureWindowReady?.resolve();
  }

  onCaptureStreamStarted(stream: CaptureStreamKind, mainMonotonicMs: number): void {
    this.captureSink.markStarted(stream, mainMonotonicMs);
    const starts = this.captureSink.startTimes();
    if ([...this.captureExpected].every((kind) => starts[kind] !== undefined)) {
      this.captureStarted?.resolve();
    }
  }

  onCaptureChunk(stream: CaptureStreamKind, chunk: ArrayBuffer): Promise<void> {
    return this.captureSink.append(stream, chunk);
  }

  onCaptureAllStopped(): void {
    this.captureStopped?.resolve();
  }

  onCaptureError(message: string): void {
    if (this.state === 'recording') {
      void this.fail(`capture: ${message}`);
    } else {
      // Pre-recording: unblocks the start ack immediately (no 10s timeout).
      this.captureStarted?.reject(new Error(`capture: ${message}`));
    }
  }

  status(): RecordingStatus {
    return {
      state: this.state,
      projectId: this.projectId,
      elapsedMs: this.elapsedMs(),
      countdownRemaining: this.countdownRemaining,
      freeDiskBytes: this.freeDiskBytes,
      error: this.error,
    };
  }

  async start(config: RecordingConfig): Promise<{ projectId: string }> {
    if (this.state !== 'idle' && this.state !== 'finalized' && this.state !== 'failed') {
      throw new Error('recording-already-active');
    }
    const isDarwin = process.platform === 'darwin';
    this.resetForStart();
    this.setState('checking-permissions');

    try {
      if (isDarwin) {
        // macOS TCC gates; win32 has no screen-recording permission and the
        // global input hook needs no Accessibility equivalent.
        const native = await nativeMac();
        if ((await native.checkScreenPermission()) !== 'granted') {
          throw new Error('permission:screen');
        }
        if (!DEV_NO_INPUT && !systemPreferences.isTrustedAccessibilityClient(false)) {
          throw new Error('permission:accessibility');
        }
      }

      const sources = await listSources();
      const geometry = resolveCaptureGeometry(config.source, sources);

      const projectId = randomUUID();
      this.projectId = projectId;
      this.createdAt = new Date();
      const bundleDir = await this.deps.store.createBundle(projectId);

      const needsCapture = expectedCaptureStreams(config).size > 0;
      if (needsCapture) {
        // The hidden window boots during the countdown so its streams are
        // warm by the time the screen recorder starts.
        this.captureSink.arm(bundleDir);
        this.captureExpected = expectedCaptureStreams(config);
        this.captureWindowReady = deferred();
        this.captureStarted = deferred();
        this.captureStopped = deferred();
        this.captureWindow = createCaptureWindow();
      }

      if (config.countdownSec > 0) {
        // Click-through overlay on the capture display mirrors the countdown.
        this.countdownWindow = createCountdownWindow(geometry.display.bounds);
        this.setState('countdown');
        for (let remaining = config.countdownSec; remaining > 0; remaining -= 1) {
          this.countdownRemaining = remaining;
          this.pushStatus();
          await sleep(1000);
          if (this.cancelRequested) throw new Error('recording-cancelled');
        }
        this.countdownRemaining = undefined;
      }

      this.setState('starting');

      if (needsCapture && this.captureWindow && this.captureWindowReady) {
        await withTimeout(
          this.captureWindowReady.promise,
          CAPTURE_ACK_TIMEOUT_MS,
          'capture-window-failed-to-load',
        );
        if (this.cancelRequested) throw new Error('recording-cancelled');
        send(this.captureWindow, 'capture:command', { kind: 'start', config, bundleDir });
      }

      this.epoch = nowMonotonicMs();
      const logger = new InputLogger({
        filePath: join(bundleDir, REL.events),
        epoch: this.epoch,
        // The rect in the input hook's coordinate space (points on darwin,
        // physical virtual-desktop px on win32).
        captureRectPt: geometry.captureRectInput,
      });
      logger.start(!DEV_NO_INPUT);
      this.logger = logger;

      // Overlay windows (webcam bubble + the floating stop pill) must be ON
      // SCREEN before the recorder starts so ScreenCaptureKit can exclude
      // them from display/area capture (see whenWindowShown). The pill shows
      // fully transparent and is revealed once recording begins.
      if (config.webcam) {
        const b = geometry.display.bounds;
        this.bubbleWindow = createBubbleWindow(config.webcam.deviceId, {
          x: Math.round(b.x + BUBBLE_MARGIN),
          y: Math.round(b.y + b.height - BUBBLE_SIZE - BUBBLE_MARGIN),
        });
      }
      this.pillWindow = createRecordingPillWindow(geometry.display.bounds);
      this.pillWindow.setOpacity(0);
      this.pillWindow.showInactive();
      await Promise.all([
        whenWindowShown(this.bubbleWindow, OVERLAY_SHOW_TIMEOUT_MS),
        whenWindowShown(this.pillWindow, OVERLAY_SHOW_TIMEOUT_MS),
      ]);
      if (this.cancelRequested) throw new Error('recording-cancelled');
      const excludeWindowIds =
        isDarwin && config.source.kind !== 'window'
          ? [cgWindowId(this.bubbleWindow), cgWindowId(this.pillWindow)].filter(
              (id): id is string => id !== undefined,
            )
          : [];

      const recorderOpts = {
        displayId: config.source.displayId,
        ...(config.source.kind === 'window' ? { windowId: config.source.windowId } : {}),
        ...(config.source.kind === 'area' ? { cropRectPx: config.source.rect } : {}),
        ...(excludeWindowIds.length > 0 ? { excludeWindowIds } : {}),
        fps: config.fps,
        outputPath: join(bundleDir, REL.screen),
        cursorsDir: join(bundleDir, REL.cursorsDir),
      };
      const recorderCallbacks = {
        onFirstFrame: (mainMonotonicMs: number) => {
          this.screenFirstFrame ??= mainMonotonicMs;
        },
        onCursorShape: (evt: {
          mainMonotonicMs: number;
          shapeId: string;
          hotspot: { x: number; y: number };
          sizePx: { w: number; h: number };
        }) => {
          this.logger?.appendCursorShapeEvent(evt);
        },
        onStats: () => {},
        onError: (message: string) => {
          void this.fail(message);
        },
      };
      try {
        this.recorder = isDarwin
          ? await (await nativeMac()).startMacRecorder(recorderOpts, recorderCallbacks)
          : await (await nativeWin()).startWinRecorder(recorderOpts, recorderCallbacks);
      } catch (err) {
        await logger.stop().catch(() => {});
        this.logger = undefined;
        throw err;
      }

      if (this.cancelRequested) {
        throw new Error('recording-cancelled');
      }

      if (needsCapture && this.captureStarted) {
        // The ack: every enabled stream reported its MediaRecorder onstart.
        await withTimeout(
          this.captureStarted.promise,
          CAPTURE_ACK_TIMEOUT_MS,
          'capture-streams-failed-to-start',
        );
        if (this.cancelRequested) throw new Error('recording-cancelled');
      }

      this.config = config;
      this.geometry = geometry;
      this.displays = sources.displays;
      this.startedAtMonotonic = nowMonotonicMs();
      this.closeCountdownWindow();
      this.startPowerBlocker();
      if (this.pillWindow && !this.pillWindow.isDestroyed()) {
        this.pillWindow.setOpacity(1);
        this.pillWindow.showInactive();
      }
      this.setState('recording');
      this.statusTimer = setInterval(() => this.pushStatus(), STATUS_PUSH_MS);
      this.diskTimer = setInterval(() => void this.checkDisk(), DISK_CHECK_MS);
      void this.checkDisk();
      return { projectId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.teardownCapture().catch(() => {});
      if (this.projectId !== undefined) {
        await this.deps.store.deleteBundleDirHard(this.projectId).catch(() => {});
        this.projectId = undefined;
      }
      // Permission rejections and user cancellation are expected flows, not
      // failures — leave the session immediately restartable.
      if (this.cancelRequested || message.startsWith('permission:')) {
        this.setState('idle');
      } else {
        this.error = message;
        this.setState('failed');
      }
      throw err;
    }
  }

  async stop(): Promise<{ projectId: string }> {
    const { projectId, recorder, logger, config, geometry } = this;
    if (this.state !== 'recording' || !projectId || !recorder || !logger || !config || !geometry) {
      throw new Error('not-recording');
    }
    this.setState('stopping');
    this.clearTimers();
    this.stopPowerBlocker();

    try {
      // Stop the aux streams first so their tails line up with the screen's.
      const captureWindow = this.captureWindow;
      if (captureWindow && !captureWindow.isDestroyed()) {
        send(captureWindow, 'capture:command', { kind: 'stop' });
      }

      const { durationMs } = await recorder.stop();
      this.finalDurationMs = durationMs;
      await logger.stop();
      this.recorder = undefined;
      this.logger = undefined;

      if (captureWindow && this.captureStopped) {
        // Final chunks arrive before this ack. A wedged capture renderer must
        // not lose the screen recording — keep whatever chunks made it.
        await withTimeout(
          this.captureStopped.promise,
          CAPTURE_ACK_TIMEOUT_MS,
          'capture-stop-timeout',
        ).catch(() => {});
      }
      const captureStarts = { ...this.captureSink.startTimes() };
      this.closeCaptureWindows();
      await this.captureSink.close();

      const meta: RecordingMeta = {
        schemaVersion: 1,
        platform: process.platform === 'win32' ? 'win32' : 'darwin',
        createdAt: this.createdAt.toISOString(),
        capture: {
          widthPx: geometry.widthPx,
          heightPx: geometry.heightPx,
          fps: config.fps,
          scaleFactor: geometry.display.scaleFactor,
          source: config.source,
        },
        displays: this.displays,
        clocks: {
          // If the recorder never reported a first frame, the best estimate
          // is the shared epoch taken just before it started.
          screenFirstFrame: this.screenFirstFrame ?? this.epoch,
          eventsEpoch: this.epoch,
          ...(captureStarts.camera !== undefined ? { cameraStart: captureStarts.camera } : {}),
          ...(captureStarts.mic !== undefined ? { micStart: captureStarts.mic } : {}),
          ...(captureStarts.system !== undefined
            ? { systemAudioStart: captureStarts.system }
            : {}),
        },
        durationMs,
      };
      await this.deps.store.writeMeta(projectId, meta);
      const project = createDefaultProject(`Recording ${this.createdAt.toLocaleString()}`, meta);
      // The editor auto-generates click zooms on first open unless this run
      // was recorded with auto-zoom off.
      project.zoom.autoGenerate = config.autoZoom ?? true;
      await this.deps.store.save(projectId, project);

      this.setState('finalized');
      this.deps.onFinalized(projectId);
      return { projectId };
    } catch (err) {
      await this.fail(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async cancel(): Promise<void> {
    switch (this.state) {
      case 'checking-permissions':
      case 'countdown':
      case 'starting':
        // start() unwinds at its next checkpoint.
        this.cancelRequested = true;
        return;
      case 'recording': {
        const projectId = this.projectId;
        this.clearTimers();
        await this.teardownCapture();
        if (projectId !== undefined) {
          await this.deps.store.deleteBundleDirHard(projectId).catch(() => {});
        }
        this.projectId = undefined;
        this.setState('idle');
        return;
      }
      default:
        return;
    }
  }

  private async fail(message: string): Promise<void> {
    if (this.state === 'failed' || this.state === 'idle' || this.state === 'finalized') return;
    this.error = message;
    this.clearTimers();
    await this.teardownCapture();
    this.setState('failed');
  }

  private async teardownCapture(): Promise<void> {
    this.stopPowerBlocker();
    try {
      this.recorder?.kill();
    } catch {
      // Recorder already gone.
    }
    this.recorder = undefined;
    const logger = this.logger;
    this.logger = undefined;
    if (logger) await logger.stop().catch(() => {});
    const captureWindow = this.captureWindow;
    if (captureWindow && !captureWindow.isDestroyed()) {
      send(captureWindow, 'capture:command', { kind: 'abort' });
    }
    this.closeCaptureWindows();
    await this.captureSink.close();
  }

  /** Destroys the capture/bubble/pill/countdown windows and clears the capture waiters. */
  private closeCaptureWindows(): void {
    this.closeCountdownWindow();
    for (const win of [this.captureWindow, this.bubbleWindow, this.pillWindow]) {
      if (win && !win.isDestroyed()) win.destroy();
    }
    this.captureWindow = undefined;
    this.bubbleWindow = undefined;
    this.pillWindow = undefined;
    this.captureExpected = new Set();
    this.captureWindowReady = undefined;
    this.captureStarted = undefined;
    this.captureStopped = undefined;
  }

  private closeCountdownWindow(): void {
    const win = this.countdownWindow;
    this.countdownWindow = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }

  private startPowerBlocker(): void {
    if (this.powerBlockerId === undefined) {
      this.powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    }
  }

  private stopPowerBlocker(): void {
    if (this.powerBlockerId !== undefined) {
      if (powerSaveBlocker.isStarted(this.powerBlockerId)) {
        powerSaveBlocker.stop(this.powerBlockerId);
      }
      this.powerBlockerId = undefined;
    }
  }

  private async checkDisk(): Promise<void> {
    try {
      const { free } = await checkDiskSpace(this.deps.store.bundlesRoot);
      this.freeDiskBytes = free;
      if (free < MIN_FREE_DISK_BYTES && this.state === 'recording') {
        await this.stop().catch(() => {});
      }
    } catch {
      // Disk stats are advisory; never interrupt a recording over them.
    }
  }

  private elapsedMs(): number {
    if (this.state === 'recording' || this.state === 'stopping') {
      return Math.max(0, Math.round(nowMonotonicMs() - this.startedAtMonotonic));
    }
    if (this.state === 'finalized') return this.finalDurationMs;
    return 0;
  }

  private resetForStart(): void {
    this.projectId = undefined;
    this.error = undefined;
    this.countdownRemaining = undefined;
    this.cancelRequested = false;
    this.config = undefined;
    this.geometry = undefined;
    this.displays = [];
    this.recorder = undefined;
    this.logger = undefined;
    this.screenFirstFrame = undefined;
    this.finalDurationMs = 0;
    this.closeCaptureWindows();
  }

  private clearTimers(): void {
    if (this.statusTimer !== undefined) clearInterval(this.statusTimer);
    if (this.diskTimer !== undefined) clearInterval(this.diskTimer);
    this.statusTimer = undefined;
    this.diskTimer = undefined;
  }

  private setState(state: RecordingState): void {
    this.state = state;
    this.pushStatus();
  }

  private pushStatus(): void {
    this.deps.broadcastStatus(this.status());
  }
}
