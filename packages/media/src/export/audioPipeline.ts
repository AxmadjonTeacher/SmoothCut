/**
 * Audio mixdown for export: decode each track via mediabunny, place samples on
 * the output timeline through `mapOutputToSourceSec`, sum to stereo planar
 * 48 kHz, and optionally peak-normalize.
 *
 * Resampling is naive per-output-sample linear interpolation: for every output
 * sample we map output time -> source time -> track sample position and lerp
 * between the two nearest decoded samples. This handles both sample-rate
 * conversion and timeline speed changes in one step; no anti-aliasing filter
 * is applied (audible only for extreme speed-ups).
 */
import { ALL_FORMATS, AudioSampleSink, Input, UrlSource } from 'mediabunny';

export interface AudioTrackInput {
  url: string;
  /** Track's sample 0 position on the SOURCE timeline, in seconds. */
  offsetSec: number;
  gainDb: number;
  /** Run RNNoise over this track before mixing (mic tracks only). */
  noiseRemoval?: boolean;
}

export const MIX_SAMPLE_RATE = 48000;

export interface StereoBuffer {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

// ---------------------------------------------------------------------------
// Pure math (node-testable, no WebCodecs)
// ---------------------------------------------------------------------------

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function applyGainInPlace(samples: Float32Array, gain: number): Float32Array {
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (samples[i] ?? 0) * gain;
  }
  return samples;
}

/** Adds `src * gain` into `dst`, element-wise over the overlapping length. */
export function mixInto(dst: Float32Array, src: Float32Array, gain = 1): void {
  const length = Math.min(dst.length, src.length);
  for (let i = 0; i < length; i++) {
    dst[i] = (dst[i] ?? 0) + (src[i] ?? 0) * gain;
  }
}

export function peakOf(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const magnitude = Math.abs(channel[i] ?? 0);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

/**
 * Single-pass peak normalization: scales all channels so the loudest sample
 * hits `targetPeak` (default -1 dBFS). Silence is left untouched.
 * Returns the applied linear gain.
 */
export function normalizePeakInPlace(
  channels: readonly Float32Array[],
  targetPeak: number = dbToGain(-1),
): number {
  const peak = peakOf(channels);
  if (peak === 0) return 1;
  const gain = targetPeak / peak;
  for (const channel of channels) {
    applyGainInPlace(channel, gain);
  }
  return gain;
}

/** Linear-interpolated read at fractional position `pos`; 0 outside the buffer. */
export function sampleLinear(data: Float32Array, pos: number): number {
  if (data.length === 0) return 0;
  const i0 = Math.floor(pos);
  if (i0 < -1 || i0 >= data.length) return 0;
  const v0 = i0 >= 0 ? (data[i0] ?? 0) : 0;
  const v1 = i0 + 1 < data.length ? (data[i0 + 1] ?? 0) : 0;
  return v0 + (v1 - v0) * (pos - i0);
}

/** Naive linear-interpolation resample from `srcRate` to `dstRate`. */
export function resampleLinear(src: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return new Float32Array(src);
  const outLength = Math.max(0, Math.round((src.length * dstRate) / srcRate));
  const out = new Float32Array(outLength);
  const step = srcRate / dstRate;
  for (let i = 0; i < outLength; i++) {
    out[i] = sampleLinear(src, i * step);
  }
  return out;
}

/**
 * Runs `processFrame` over `samples` in fixed-size frames (RNNoise wants
 * exactly `frameSize` samples per call — 480 at 48 kHz). The final short
 * frame is zero-padded before processing and only the real samples are
 * written back, so the buffer length never changes. `processFrame` mutates
 * its frame in place; the frame buffer is reused across calls.
 */
export function processInFrames(
  samples: Float32Array,
  frameSize: number,
  processFrame: (frame: Float32Array) => void,
): void {
  if (frameSize <= 0) throw new Error(`invalid frameSize ${frameSize}`);
  const frame = new Float32Array(frameSize);
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const count = Math.min(frameSize, samples.length - offset);
    frame.set(samples.subarray(offset, offset + count));
    if (count < frameSize) frame.fill(0, count);
    processFrame(frame);
    samples.set(frame.subarray(0, count), offset);
  }
}

/** RNNoise operates on 16-bit-PCM-scaled floats; wrap a raw -1..1 processor. */
export function scaleToPcm16Frame(processPcm16Frame: (frame: Float32Array) => void) {
  return (frame: Float32Array): void => {
    for (let i = 0; i < frame.length; i++) frame[i] = (frame[i] ?? 0) * 32768;
    processPcm16Frame(frame);
    for (let i = 0; i < frame.length; i++) frame[i] = (frame[i] ?? 0) / 32768;
  };
}

/**
 * Sums one decoded track into the output mix. For output sample i at
 * tOut = i / outSampleRate: tSource = map(tOut) (null = cut, stays silent),
 * then the track is read at (tSource - offsetSec) * track.sampleRate.
 */
export function renderTrackIntoMix(
  track: StereoBuffer,
  offsetSec: number,
  gain: number,
  mapOutputToSourceSec: (tOut: number) => number | null,
  outLeft: Float32Array,
  outRight: Float32Array,
  outSampleRate: number,
): void {
  const length = Math.min(outLeft.length, outRight.length);
  for (let i = 0; i < length; i++) {
    const tSource = mapOutputToSourceSec(i / outSampleRate);
    if (tSource === null) continue;
    const pos = (tSource - offsetSec) * track.sampleRate;
    outLeft[i] = (outLeft[i] ?? 0) + gain * sampleLinear(track.left, pos);
    outRight[i] = (outRight[i] ?? 0) + gain * sampleLinear(track.right, pos);
  }
}

// ---------------------------------------------------------------------------
// Browser decode + mix (WebCodecs via mediabunny)
// ---------------------------------------------------------------------------

/**
 * Decodes the primary audio track at `url` into planar stereo Float32 at the
 * track's native sample rate. Mono is duplicated to both channels; channels
 * beyond the first two are dropped. Samples are placed by their timestamps,
 * preserving any gaps as silence.
 */
async function decodeTrackToStereo(url: string): Promise<StereoBuffer> {
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error(`No audio track found in ${url}`);
    const [durationSec, sampleRate] = await Promise.all([
      track.computeDuration(),
      track.getSampleRate(),
    ]);
    const length = Math.max(0, Math.ceil(durationSec * sampleRate));
    const left = new Float32Array(length);
    const right = new Float32Array(length);

    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples()) {
      const frames = sample.numberOfFrames;
      const channelLeft = new Float32Array(frames);
      sample.copyTo(channelLeft, { planeIndex: 0, format: 'f32-planar' });
      let channelRight = channelLeft;
      if (sample.numberOfChannels >= 2) {
        channelRight = new Float32Array(frames);
        sample.copyTo(channelRight, { planeIndex: 1, format: 'f32-planar' });
      }
      const startIndex = Math.round(sample.timestamp * sampleRate);
      sample.close();

      const srcStart = startIndex < 0 ? -startIndex : 0;
      const dstStart = Math.max(0, startIndex);
      const count = Math.min(frames - srcStart, length - dstStart);
      if (count <= 0) continue;
      left.set(channelLeft.subarray(srcStart, srcStart + count), dstStart);
      right.set(channelRight.subarray(srcStart, srcStart + count), dstStart);
    }
    return { left, right, sampleRate };
  } finally {
    input.dispose();
  }
}

/**
 * RNNoise pass over a decoded stereo track: resamples to 48 kHz first (the
 * model is trained at 48 kHz), then denoises each channel with its own
 * DenoiseState. Loaded lazily so node unit tests and audio-less exports never
 * touch the ~5 MB wasm bundle (base64-embedded — no separate .wasm fetch, so
 * it loads fine inside the export Web Worker).
 */
async function denoiseTrack(track: StereoBuffer): Promise<StereoBuffer> {
  const { Rnnoise } = await import('@shiguredo/rnnoise-wasm');
  const rnnoise = await Rnnoise.load();
  const left =
    track.sampleRate === MIX_SAMPLE_RATE
      ? track.left
      : resampleLinear(track.left, track.sampleRate, MIX_SAMPLE_RATE);
  const right =
    track.sampleRate === MIX_SAMPLE_RATE
      ? track.right
      : resampleLinear(track.right, track.sampleRate, MIX_SAMPLE_RATE);
  for (const channel of [left, right]) {
    const state = rnnoise.createDenoiseState();
    try {
      processInFrames(
        channel,
        rnnoise.frameSize,
        scaleToPcm16Frame((frame) => void state.processFrame(frame)),
      );
    } finally {
      state.destroy();
    }
  }
  return { left, right, sampleRate: MIX_SAMPLE_RATE };
}

/**
 * Mixes all tracks onto the output timeline as stereo planar 48 kHz. Tracks
 * flagged `noiseRemoval` are run through RNNoise before mixing.
 */
export async function mixAudio(
  tracks: AudioTrackInput[],
  mapOutputToSourceSec: (tOut: number) => number | null,
  outputDurationSec: number,
  opts: { normalize: boolean },
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: 48000 }> {
  const length = Math.max(0, Math.round(outputDurationSec * MIX_SAMPLE_RATE));
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  for (const trackInput of tracks) {
    let decoded = await decodeTrackToStereo(trackInput.url);
    if (trackInput.noiseRemoval === true) {
      decoded = await denoiseTrack(decoded);
    }
    renderTrackIntoMix(
      decoded,
      trackInput.offsetSec,
      dbToGain(trackInput.gainDb),
      mapOutputToSourceSec,
      left,
      right,
      MIX_SAMPLE_RATE,
    );
  }

  if (opts.normalize) {
    normalizePeakInPlace([left, right]);
  }
  return { left, right, sampleRate: MIX_SAMPLE_RATE };
}
