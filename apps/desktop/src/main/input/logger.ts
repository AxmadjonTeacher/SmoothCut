import { appendFile } from 'node:fs/promises';
import { systemPreferences } from 'electron';
import { uIOhook } from 'uiohook-napi';
import type { UiohookKeyboardEvent, UiohookMouseEvent, UiohookWheelEvent } from 'uiohook-napi';
import { serializeEvent } from '@smoothcut/shared';
import type { InputEvent } from '@smoothcut/shared';
import { nowMonotonicMs } from '../recording/clock.js';
import { mapUiohookButton, mapWheelDelta, toUnitCoords } from './mapping.js';
import type { CaptureRectPt } from './mapping.js';

const FLUSH_INTERVAL_MS = 250;

export interface InputLoggerOptions {
  filePath: string;
  /** events.jsonl `t` = nowMonotonicMs() - epoch. */
  epoch: number;
  /**
   * Capture rect in the INPUT HOOK's coordinate space — the rect uiohook
   * coordinates are normalized against. darwin: global logical points;
   * win32: physical px in virtual-desktop coordinates
   * (`CaptureGeometry.captureRectInput` computes both).
   */
  captureRectPt: CaptureRectPt;
}

/**
 * Global input hook → buffered events.jsonl appends (crash-safe: at most the
 * last flush window is lost). One logger per recording session.
 */
export class InputLogger {
  private readonly opts: InputLoggerOptions;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private writeChain: Promise<void> = Promise.resolve();
  private hookStarted = false;

  private readonly onMouseMove = (e: UiohookMouseEvent): void => {
    const { x, y } = this.unit(e.x, e.y);
    this.push({ t: this.t(), type: 'move', x, y });
  };
  private readonly onMouseDown = (e: UiohookMouseEvent): void => {
    const button = mapUiohookButton(e.button);
    if (button === null) return;
    const { x, y } = this.unit(e.x, e.y);
    this.push({ t: this.t(), type: 'down', x, y, button });
  };
  private readonly onMouseUp = (e: UiohookMouseEvent): void => {
    const button = mapUiohookButton(e.button);
    if (button === null) return;
    const { x, y } = this.unit(e.x, e.y);
    this.push({ t: this.t(), type: 'up', x, y, button });
  };
  private readonly onWheel = (e: UiohookWheelEvent): void => {
    const { x, y } = this.unit(e.x, e.y);
    const { dx, dy } = mapWheelDelta(e.direction, e.rotation, e.amount);
    this.push({ t: this.t(), type: 'wheel', x, y, dx, dy });
  };
  private readonly onKeyDown = (e: UiohookKeyboardEvent): void => {
    this.push({ t: this.t(), type: 'key', keycode: e.keycode });
  };

  constructor(opts: InputLoggerOptions) {
    this.opts = opts;
  }

  start(hook = true): void {
    if (hook) {
      if (process.platform === 'darwin') {
        // uIOhook.start() without Accessibility trust hard-crashes the process.
        if (!systemPreferences.isTrustedAccessibilityClient(false)) {
          throw new Error('permission:accessibility');
        }
      }
      // win32: WH_* hooks need no permission; coords are physical virtual-desktop
      // px and `captureRectPt` is already in that space (geometry.captureRectInput).

      uIOhook.on('mousemove', this.onMouseMove);
      uIOhook.on('mousedown', this.onMouseDown);
      uIOhook.on('mouseup', this.onMouseUp);
      uIOhook.on('wheel', this.onWheel);
      uIOhook.on('keydown', this.onKeyDown);
      uIOhook.start();
      this.hookStarted = true;
    }

    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Log a cursorShape event reported by the native recorder (already on the main monotonic clock). */
  appendCursorShapeEvent(evt: {
    mainMonotonicMs: number;
    shapeId: string;
    hotspot: { x: number; y: number };
    sizePx: { w: number; h: number };
  }): void {
    this.push({
      t: evt.mainMonotonicMs - this.opts.epoch,
      type: 'cursorShape',
      shapeId: evt.shapeId,
      hotspot: evt.hotspot,
      sizePx: evt.sizePx,
    });
  }

  async stop(): Promise<void> {
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.hookStarted) {
      uIOhook.removeListener('mousemove', this.onMouseMove);
      uIOhook.removeListener('mousedown', this.onMouseDown);
      uIOhook.removeListener('mouseup', this.onMouseUp);
      uIOhook.removeListener('wheel', this.onWheel);
      uIOhook.removeListener('keydown', this.onKeyDown);
      uIOhook.stop();
      this.hookStarted = false;
    }
    this.flush();
    await this.writeChain;
  }

  private t(): number {
    return nowMonotonicMs() - this.opts.epoch;
  }

  private unit(globalXPt: number, globalYPt: number): { x: number; y: number } {
    return toUnitCoords(globalXPt, globalYPt, this.opts.captureRectPt);
  }

  private push(event: InputEvent): void {
    this.buffer.push(serializeEvent(event));
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const chunk = this.buffer.join('\n') + '\n';
    this.buffer = [];
    this.writeChain = this.writeChain
      .then(() => appendFile(this.opts.filePath, chunk, 'utf8'))
      .catch(() => {
        // Disk-full/teardown races must not take down the session loop;
        // the disk watchdog handles sustained failures.
      });
  }
}
