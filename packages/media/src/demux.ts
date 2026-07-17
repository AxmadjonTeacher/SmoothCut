/**
 * Mediabunny-backed demuxing of a source video into caller-owned VideoFrames.
 *
 * Frame lifetime semantics (per mediabunny's VideoSampleSink API):
 * `samples()` yields `VideoSample`s that WE own and must close;
 * `VideoSample.toVideoFrame()` returns a `VideoFrame` that "must be closed
 * separately from this video sample", so the CALLER closes every returned
 * VideoFrame while the cursor manages sample lifetimes internally.
 *
 * NOTE: `samplesAtTimestamps` fed by an on-demand timestamp channel deadlocks
 * (it pulls the next timestamp before yielding the current sample), so the
 * cursor drives the plain forward `samples()` iterator instead — the API the
 * docs recommend for primarily-sequential access.
 */
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from 'mediabunny';
import type { InputVideoTrack, VideoSample } from 'mediabunny';

export interface FrameCursor {
  getFrameAt(tSec: number): Promise<VideoFrame | null>;
  close(): Promise<void>;
}

interface Pipeline {
  iterator: AsyncGenerator<VideoSample, void, unknown>;
  /** Sample currently displayed at the last requested time (owned). */
  current: VideoSample | null;
  /** Decoded lookahead sample (owned). */
  next: VideoSample | null;
  done: boolean;
}

class SampleCursor implements FrameCursor {
  private readonly sink: VideoSampleSink;
  private pipeline: Pipeline | null = null;
  private lastRequested = -Infinity;
  private closed = false;
  // getFrameAt calls are serialized so interleaved awaits can't corrupt the
  // sliding window.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly input: Input,
    track: InputVideoTrack,
    private readonly durationSec: number,
  ) {
    this.sink = new VideoSampleSink(track);
  }

  getFrameAt(tSec: number): Promise<VideoFrame | null> {
    const result = this.chain.then(() => this.fetchFrame(tSec));
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async fetchFrame(tSec: number): Promise<VideoFrame | null> {
    if (this.closed) throw new Error('FrameCursor is closed');
    const t = Math.min(Math.max(tSec, 0), this.durationSec);
    if (this.pipeline && t < this.lastRequested) {
      // Backward seek: tear down the forward pipeline and start a fresh one.
      // This re-decodes from the previous keyframe — the documented slow path.
      await this.teardownPipeline();
    }
    this.lastRequested = t;

    if (!this.pipeline) {
      const iterator = this.sink.samples(t);
      const first = await iterator.next();
      this.pipeline = {
        iterator,
        current: first.done === true ? null : first.value,
        next: null,
        done: first.done === true,
      };
    }
    const p = this.pipeline;

    // Slide forward until `current` is the sample displayed at t (the last
    // sample whose timestamp is <= t, holding one decoded sample of lookahead).
    while (!p.done || p.next !== null) {
      if (p.next === null) {
        const result = await p.iterator.next();
        if (result.done === true) {
          p.done = true;
          break;
        }
        p.next = result.value;
      }
      if (p.next.timestamp <= t) {
        p.current?.close();
        p.current = p.next;
        p.next = null;
      } else {
        break;
      }
    }

    // When t precedes the first sample, `current` is the earliest frame —
    // returning it (instead of null) avoids black frames at the start of an
    // export when capture began fractionally after PTS 0.
    return p.current ? p.current.toVideoFrame() : null;
  }

  private async teardownPipeline(): Promise<void> {
    const pipeline = this.pipeline;
    this.pipeline = null;
    if (!pipeline) return;
    pipeline.current?.close();
    pipeline.next?.close();
    pipeline.current = null;
    pipeline.next = null;
    try {
      await pipeline.iterator.return(undefined);
    } catch {
      // Pipeline already failed; nothing left to release.
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.chain;
    await this.teardownPipeline();
    this.input.dispose();
  }
}

/**
 * Opens the video at `url` (served over Range-capable HTTP, e.g. the
 * `smoothcut://` protocol) and returns its dimensions, duration, and a
 * `FrameCursor` optimized for mostly-forward access.
 */
export async function openVideo(
  url: string,
): Promise<{ durationSec: number; width: number; height: number; cursor: FrameCursor }> {
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`No video track found in ${url}`);
    const [durationSec, width, height] = await Promise.all([
      track.computeDuration(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
    ]);
    return { durationSec, width, height, cursor: new SampleCursor(input, track, durationSec) };
  } catch (error) {
    input.dispose();
    throw error;
  }
}
