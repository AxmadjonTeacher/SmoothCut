/**
 * Full export pipeline: decode source video(s), compose each output frame,
 * encode H.264 + AAC with WebCodecs, and mux into MP4 via mediabunny.
 *
 * Muxing uses `EncodedVideoPacketSource`/`EncodedAudioPacketSource` (not
 * mediabunny's encoding sources) so WE own the WebCodecs encoder configs —
 * explicit codec string, hardwareAcceleration, latencyMode, per-frame keyframe
 * control, and encodeQueueSize-based backpressure are all requirements here
 * that the high-level sources don't expose per-frame.
 *
 * The video track is written fully before the audio track (phases run
 * sequentially), so packets are not interleaved in the mdat; the moov at the
 * end (fastStart: false) indexes them correctly and players handle this fine.
 */
import {
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';
import { openVideo } from '../demux.js';
import { pickAvcCodecString } from '../support.js';
import { MIX_SAMPLE_RATE, mixAudio } from './audioPipeline.js';
import type { AudioTrackInput } from './audioPipeline.js';

export interface ExportProgress {
  phase: 'preparing' | 'video' | 'audio' | 'finalizing' | 'done';
  framesDone: number;
  framesTotal: number;
  fpsAchieved: number;
}

export interface ExportSink {
  write(chunk: Uint8Array, position: number | null): Promise<void>;
  close(): Promise<void>;
}

export interface RunExportOptions {
  screenUrl: string;
  cameraUrl?: string;
  /**
   * Camera clock offset: the camera file's t=0 sits at this SOURCE time
   * (seconds). Camera frames are fetched at `tSourceSec - cameraOffsetSec`
   * (clamped ≥ 0). Default 0.
   */
  cameraOffsetSec?: number;
  audioTracks: AudioTrackInput[];
  mapOutputToSourceSec: (tOut: number) => number | null;
  outputDurationSec: number;
  output: { width: number; height: number; fps: 30 | 60; bitrateMbps: number };
  compose: (
    tSourceSec: number,
    screen: VideoFrame,
    camera: VideoFrame | null,
  ) => OffscreenCanvas | HTMLCanvasElement;
  audio: { normalize: boolean };
  sink: ExportSink;
  onProgress: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface OutputFramePlan {
  frameIndex: number;
  tOutputSec: number;
  /** Source time to render, or null when this output frame falls in a cut. */
  tSourceSec: number | null;
}

export function totalOutputFrames(outputDurationSec: number, fps: number): number {
  return Math.max(0, Math.round(outputDurationSec * fps));
}

/** Pure output-frame iteration: frame index -> source time | skip (cuts). */
export function* iterateOutputFrames(
  mapOutputToSourceSec: (tOut: number) => number | null,
  outputDurationSec: number,
  fps: number,
): Generator<OutputFramePlan, void, undefined> {
  const total = totalOutputFrames(outputDurationSec, fps);
  for (let frameIndex = 0; frameIndex < total; frameIndex++) {
    const tOutputSec = frameIndex / fps;
    yield { frameIndex, tOutputSec, tSourceSec: mapOutputToSourceSec(tOutputSec) };
  }
}

const KEYFRAME_INTERVAL_US = 2_000_000;
const MAX_ENCODE_QUEUE = 4;
const PROGRESS_EVERY_FRAMES = 15;
const AAC_BITRATE = 192_000;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException('Export aborted', 'AbortError');
  }
}

function awaitDequeue(encoder: VideoEncoder | AudioEncoder): Promise<void> {
  return new Promise<void>((resolve) => {
    encoder.addEventListener('dequeue', () => resolve(), { once: true });
  });
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function runExport(opts: RunExportOptions): Promise<void> {
  const { fps, width, height } = opts.output;
  const framesTotal = totalOutputFrames(opts.outputDurationSec, fps);
  let framesDone = 0;
  let startedAt = performance.now();

  const emitProgress = (phase: ExportProgress['phase']): void => {
    const elapsedSec = (performance.now() - startedAt) / 1000;
    opts.onProgress({
      phase,
      framesDone,
      framesTotal,
      fpsAchieved: elapsedSec > 0 ? framesDone / elapsedSec : 0,
    });
  };

  emitProgress('preparing');
  throwIfAborted(opts.signal);

  const hasAudio = opts.audioTracks.length > 0;
  const aacConfig: AudioEncoderConfig = {
    codec: 'mp4a.40.2',
    sampleRate: MIX_SAMPLE_RATE,
    numberOfChannels: 2,
    bitrate: AAC_BITRATE,
  };
  if (hasAudio) {
    const aacSupport = await AudioEncoder.isConfigSupported(aacConfig).catch(() => null);
    if (aacSupport?.supported !== true) throw new Error('aac-unsupported');
  }

  const screen = await openVideo(opts.screenUrl);
  let camera: Awaited<ReturnType<typeof openVideo>> | null = null;
  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;
  let sinkClosed = false;

  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) => opts.sink.write(chunk.data, chunk.position),
  });
  const output = new Output({
    // fastStart: false → moov at the end; finalization rewrites the mdat
    // header in place, hence the positioned writes the sink must honor.
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true }),
  });

  try {
    camera = opts.cameraUrl !== undefined ? await openVideo(opts.cameraUrl) : null;

    const videoSource = new EncodedVideoPacketSource('avc');
    output.addVideoTrack(videoSource, { frameRate: fps });
    const audioSource = hasAudio ? new EncodedAudioPacketSource('aac') : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    // --- Video phase -------------------------------------------------------
    let muxError: Error | null = null;
    let muxChain: Promise<void> = Promise.resolve();
    videoEncoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const packet = EncodedPacket.fromEncodedChunk(chunk);
        muxChain = muxChain
          .then(() => videoSource.add(packet, metadata ?? undefined))
          .catch((error: unknown) => {
            muxError ??= toError(error);
          });
      },
      error: (error) => {
        muxError ??= error;
      },
    });
    videoEncoder.configure({
      codec: pickAvcCodecString(width, height, fps),
      width,
      height,
      bitrate: Math.round(opts.output.bitrateMbps * 1_000_000),
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      avc: { format: 'avc' },
    });

    startedAt = performance.now();
    const frameDurationUs = Math.round(1e6 / fps);
    let lastKeyUs = -Infinity;

    for (const plan of iterateOutputFrames(opts.mapOutputToSourceSec, opts.outputDurationSec, fps)) {
      throwIfAborted(opts.signal);
      if (muxError) throw muxError;

      if (plan.tSourceSec !== null) {
        const tSource = plan.tSourceSec;
        const screenFrame = await screen.cursor.getFrameAt(tSource);
        if (screenFrame) {
          const tCamera = Math.max(0, tSource - (opts.cameraOffsetSec ?? 0));
          const cameraFrame = camera ? await camera.cursor.getFrameAt(tCamera) : null;
          try {
            const canvas = opts.compose(tSource, screenFrame, cameraFrame);
            const timestamp = Math.round((plan.frameIndex * 1e6) / fps);
            const outFrame = new VideoFrame(canvas, { timestamp, duration: frameDurationUs });
            const keyFrame = timestamp - lastKeyUs >= KEYFRAME_INTERVAL_US;
            if (keyFrame) lastKeyUs = timestamp;
            try {
              videoEncoder.encode(outFrame, { keyFrame });
            } finally {
              outFrame.close();
            }
          } finally {
            screenFrame.close();
            cameraFrame?.close();
          }
          while (videoEncoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
            await awaitDequeue(videoEncoder);
          }
        }
      }

      framesDone++;
      if (framesDone % PROGRESS_EVERY_FRAMES === 0) emitProgress('video');
    }

    await videoEncoder.flush();
    videoEncoder.close();
    await muxChain;
    if (muxError) throw muxError;
    videoSource.close();
    emitProgress('video');

    // --- Audio phase -------------------------------------------------------
    if (audioSource) {
      emitProgress('audio');
      const mixed = await mixAudio(
        opts.audioTracks,
        opts.mapOutputToSourceSec,
        opts.outputDurationSec,
        { normalize: opts.audio.normalize },
      );
      throwIfAborted(opts.signal);

      let audioMuxError: Error | null = null;
      let audioMuxChain: Promise<void> = Promise.resolve();
      audioEncoder = new AudioEncoder({
        output: (chunk, metadata) => {
          const packet = EncodedPacket.fromEncodedChunk(chunk);
          audioMuxChain = audioMuxChain
            .then(() => audioSource.add(packet, metadata ?? undefined))
            .catch((error: unknown) => {
              audioMuxError ??= toError(error);
            });
        },
        error: (error) => {
          audioMuxError ??= error;
        },
      });
      audioEncoder.configure(aacConfig);

      const blockFrames = MIX_SAMPLE_RATE; // 1-second AudioData blocks
      for (let offset = 0; offset < mixed.left.length; offset += blockFrames) {
        throwIfAborted(opts.signal);
        if (audioMuxError) throw audioMuxError;
        const count = Math.min(blockFrames, mixed.left.length - offset);
        const planar = new Float32Array(count * 2);
        planar.set(mixed.left.subarray(offset, offset + count), 0);
        planar.set(mixed.right.subarray(offset, offset + count), count);
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: MIX_SAMPLE_RATE,
          numberOfFrames: count,
          numberOfChannels: 2,
          timestamp: Math.round((offset / MIX_SAMPLE_RATE) * 1e6),
          data: planar,
        });
        try {
          audioEncoder.encode(audioData);
        } finally {
          audioData.close();
        }
        while (audioEncoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
          await awaitDequeue(audioEncoder);
        }
      }

      await audioEncoder.flush();
      audioEncoder.close();
      await audioMuxChain;
      if (audioMuxError) throw audioMuxError;
      audioSource.close();
    }

    // --- Finalize ----------------------------------------------------------
    throwIfAborted(opts.signal);
    emitProgress('finalizing');
    await output.finalize();
    sinkClosed = true;
    await opts.sink.close();
    emitProgress('done');
  } catch (error) {
    if (videoEncoder && videoEncoder.state !== 'closed') {
      try {
        videoEncoder.close();
      } catch {
        // Encoder already errored.
      }
    }
    if (audioEncoder && audioEncoder.state !== 'closed') {
      try {
        audioEncoder.close();
      } catch {
        // Encoder already errored.
      }
    }
    if (output.state === 'pending' || output.state === 'started') {
      try {
        await output.cancel();
      } catch {
        // Output already failed.
      }
    }
    if (!sinkClosed) {
      sinkClosed = true;
      try {
        await opts.sink.close();
      } catch {
        // Best-effort close on the failure path.
      }
    }
    throw error;
  } finally {
    try {
      await screen.cursor.close();
    } catch {
      // Best-effort close.
    }
    if (camera) {
      try {
        await camera.cursor.close();
      } catch {
        // Best-effort close.
      }
    }
  }
}
