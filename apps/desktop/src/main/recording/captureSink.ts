/**
 * Receives webcam/mic/system-audio chunks from the hidden capture window and
 * appends them to the recording bundle (recording/{camera,mic,system}.webm).
 * One sink per app, armed for at most one session at a time; chunks that
 * arrive while disarmed (late stragglers after a cancel) are dropped.
 *
 * Writes are serialized on a single promise chain — chunk volume is tiny
 * (~1 chunk/second/stream) and per-stream order is what matters.
 */
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureStreamKind } from '@smoothcut/shared';
import { REL } from '../project/store.js';

const FILE_FOR: Record<CaptureStreamKind, string> = {
  camera: REL.camera,
  mic: REL.mic,
  system: REL.system,
};

export class CaptureSink {
  private bundleDir: string | null = null;
  private handles = new Map<CaptureStreamKind, Promise<FileHandle>>();
  private chain: Promise<void> = Promise.resolve();
  private starts: Partial<Record<CaptureStreamKind, number>> = {};

  /** Arm the sink for a new session. */
  arm(bundleDir: string): void {
    this.bundleDir = bundleDir;
    this.handles = new Map();
    this.chain = Promise.resolve();
    this.starts = {};
  }

  get armed(): boolean {
    return this.bundleDir !== null;
  }

  append(stream: CaptureStreamKind, chunk: ArrayBuffer): Promise<void> {
    const dir = this.bundleDir;
    if (dir === null) return Promise.resolve();
    const data = new Uint8Array(chunk);
    this.chain = this.chain.then(async () => {
      // Re-check: the sink may have been closed while queued.
      if (this.bundleDir !== dir) return;
      const handle = await this.handleFor(stream, dir);
      await handle.write(data);
    });
    return this.chain;
  }

  /** Record a stream's first-sample time on the main monotonic clock. */
  markStarted(stream: CaptureStreamKind, mainMonotonicMs: number): void {
    if (this.bundleDir === null) return;
    this.starts[stream] ??= mainMonotonicMs;
  }

  startTimes(): Readonly<Partial<Record<CaptureStreamKind, number>>> {
    return this.starts;
  }

  /** Flush pending writes, close every file, and disarm. */
  async close(): Promise<void> {
    this.bundleDir = null;
    await this.chain.catch(() => {});
    const handles = this.handles;
    this.handles = new Map();
    for (const pending of handles.values()) {
      const handle = await pending.catch(() => null);
      await handle?.close().catch(() => {});
    }
  }

  private handleFor(stream: CaptureStreamKind, dir: string): Promise<FileHandle> {
    let pending = this.handles.get(stream);
    if (!pending) {
      pending = open(join(dir, FILE_FOR[stream]), 'w');
      this.handles.set(stream, pending);
    }
    return pending;
  }
}
