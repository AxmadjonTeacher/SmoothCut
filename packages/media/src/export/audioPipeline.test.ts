import { describe, expect, it } from 'vitest';
import {
  applyGainInPlace,
  dbToGain,
  mixInto,
  normalizePeakInPlace,
  peakOf,
  processInFrames,
  renderTrackIntoMix,
  resampleLinear,
  sampleLinear,
  scaleToPcm16Frame,
} from './audioPipeline.js';

describe('dbToGain', () => {
  it('maps 0 dB to unity', () => {
    expect(dbToGain(0)).toBe(1);
  });

  it('maps -6 dB to roughly half amplitude', () => {
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 3);
  });

  it('maps +20 dB to 10x', () => {
    expect(dbToGain(20)).toBeCloseTo(10, 10);
  });
});

describe('applyGainInPlace', () => {
  it('scales every sample', () => {
    const samples = new Float32Array([0.5, -0.25, 1]);
    applyGainInPlace(samples, 2);
    expect(Array.from(samples)).toEqual([1, -0.5, 2]);
  });
});

describe('mixInto', () => {
  it('sums with gain over the overlapping length', () => {
    const dst = new Float32Array([0.1, 0.2, 0.3]);
    const src = new Float32Array([1, 1]);
    mixInto(dst, src, 0.5);
    expect(dst[0]).toBeCloseTo(0.6, 6);
    expect(dst[1]).toBeCloseTo(0.7, 6);
    expect(dst[2]).toBeCloseTo(0.3, 6);
  });
});

describe('normalizePeakInPlace', () => {
  it('scales the peak across all channels to -1 dBFS', () => {
    const left = new Float32Array([0.1, -0.5, 0.2]);
    const right = new Float32Array([0.25, 0.1, -0.1]);
    const gain = normalizePeakInPlace([left, right]);
    expect(peakOf([left, right])).toBeCloseTo(dbToGain(-1), 6);
    expect(gain).toBeCloseTo(dbToGain(-1) / 0.5, 6);
    // Relative balance preserved.
    expect((left[0] ?? 0) / (right[0] ?? 1)).toBeCloseTo(0.4, 6);
  });

  it('leaves silence untouched', () => {
    const silent = new Float32Array(8);
    expect(normalizePeakInPlace([silent])).toBe(1);
    expect(peakOf([silent])).toBe(0);
  });
});

describe('sampleLinear', () => {
  const data = new Float32Array([0, 1, 0.5]);

  it('returns exact samples at integer positions', () => {
    expect(sampleLinear(data, 0)).toBe(0);
    expect(sampleLinear(data, 1)).toBe(1);
    expect(sampleLinear(data, 2)).toBe(0.5);
  });

  it('interpolates between samples', () => {
    expect(sampleLinear(data, 0.5)).toBeCloseTo(0.5, 6);
    expect(sampleLinear(data, 1.5)).toBeCloseTo(0.75, 6);
  });

  it('returns 0 outside the buffer', () => {
    expect(sampleLinear(data, -2)).toBe(0);
    expect(sampleLinear(data, 3)).toBe(0);
    expect(sampleLinear(new Float32Array(0), 0)).toBe(0);
  });

  it('fades toward 0 at the edges', () => {
    expect(sampleLinear(data, -0.5)).toBeCloseTo(0, 6);
    expect(sampleLinear(data, 2.5)).toBeCloseTo(0.25, 6);
  });
});

describe('resampleLinear', () => {
  it('is a copy at identical rates', () => {
    const src = new Float32Array([1, 2, 3]);
    const out = resampleLinear(src, 48000, 48000);
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(out).not.toBe(src);
  });

  it('doubles the length when upsampling 2x and interpolates midpoints', () => {
    const src = new Float32Array([0, 1, 0, 1]);
    const out = resampleLinear(src, 24000, 48000);
    expect(out.length).toBe(8);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.5, 6);
    expect(out[2]).toBe(1);
    expect(out[3]).toBeCloseTo(0.5, 6);
  });

  it('halves the length when downsampling 2x', () => {
    const src = new Float32Array([0, 1, 2, 3]);
    const out = resampleLinear(src, 48000, 24000);
    expect(out.length).toBe(2);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(2);
  });
});

describe('processInFrames', () => {
  it('feeds fixed-size frames to the denoiser and writes results back', () => {
    // 7 samples, frame size 3 → frames [0..2], [3..5], [6 + 2 zero pads].
    const samples = new Float32Array([1, 2, 3, 4, 5, 6, 7]);
    const seen: number[][] = [];
    processInFrames(samples, 3, (frame) => {
      seen.push(Array.from(frame));
      for (let i = 0; i < frame.length; i++) frame[i] = -(frame[i] ?? 0);
    });
    expect(seen).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 0, 0],
    ]);
    expect(Array.from(samples)).toEqual([-1, -2, -3, -4, -5, -6, -7]);
  });

  it('always passes exactly frameSize samples', () => {
    const samples = new Float32Array(10);
    const lengths: number[] = [];
    processInFrames(samples, 4, (frame) => lengths.push(frame.length));
    expect(lengths).toEqual([4, 4, 4]);
  });

  it('does not grow the buffer on a short tail frame', () => {
    const samples = new Float32Array([0.5, 0.5]);
    processInFrames(samples, 480, () => {});
    expect(samples.length).toBe(2);
    expect(Array.from(samples)).toEqual([0.5, 0.5]);
  });

  it('handles an empty buffer without calling the processor', () => {
    let calls = 0;
    processInFrames(new Float32Array(0), 480, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it('rejects a non-positive frame size', () => {
    expect(() => processInFrames(new Float32Array(4), 0, () => {})).toThrow();
  });
});

describe('scaleToPcm16Frame', () => {
  it('scales to 16-bit PCM range for the processor and back after', () => {
    const frame = new Float32Array([0.5, -1, 0.25]);
    const seen: number[][] = [];
    scaleToPcm16Frame((f) => {
      seen.push(Array.from(f));
      // Denoiser halves everything (still in PCM16 scale).
      for (let i = 0; i < f.length; i++) f[i] = (f[i] ?? 0) / 2;
    })(frame);
    expect(seen).toEqual([[16384, -32768, 8192]]);
    expect(frame[0]).toBeCloseTo(0.25, 6);
    expect(frame[1]).toBeCloseTo(-0.5, 6);
    expect(frame[2]).toBeCloseTo(0.125, 6);
  });

  it('round-trips unchanged when the processor is identity', () => {
    const frame = new Float32Array([0.1, -0.9, 0]);
    scaleToPcm16Frame(() => {})(frame);
    expect(frame[0]).toBeCloseTo(0.1, 6);
    expect(frame[1]).toBeCloseTo(-0.9, 6);
    expect(frame[2]).toBe(0);
  });
});

describe('renderTrackIntoMix', () => {
  const outRate = 10;

  it('places a track on the output timeline with an identity mapping', () => {
    // Track at 10 Hz: sample i has value i.
    const track = {
      left: new Float32Array([0, 1, 2, 3, 4]),
      right: new Float32Array([0, -1, -2, -3, -4]),
      sampleRate: 10,
    };
    const outLeft = new Float32Array(5);
    const outRight = new Float32Array(5);
    renderTrackIntoMix(track, 0, 1, (t) => t, outLeft, outRight, outRate);
    expect(Array.from(outLeft)).toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(outRight)).toEqual([0, -1, -2, -3, -4]);
  });

  it('applies offsetSec and gain', () => {
    const track = {
      left: new Float32Array([1, 1, 1]),
      right: new Float32Array([1, 1, 1]),
      sampleRate: 10,
    };
    const outLeft = new Float32Array(6);
    const outRight = new Float32Array(6);
    // Track begins at source t=0.2 → output samples 0-1 read before the track.
    renderTrackIntoMix(track, 0.2, 0.5, (t) => t, outLeft, outRight, outRate);
    expect(outLeft[0]).toBe(0);
    expect(outLeft[1]).toBe(0);
    expect(outLeft[2]).toBeCloseTo(0.5, 6);
    expect(outLeft[4]).toBeCloseTo(0.5, 6);
    expect(outLeft[5]).toBe(0);
  });

  it('leaves silence where the mapping returns null (cuts)', () => {
    const track = {
      left: new Float32Array([1, 1, 1, 1, 1, 1]),
      right: new Float32Array([1, 1, 1, 1, 1, 1]),
      sampleRate: 10,
    };
    const outLeft = new Float32Array(6);
    const outRight = new Float32Array(6);
    const map = (t: number): number | null => (t >= 0.2 && t < 0.4 ? null : t);
    renderTrackIntoMix(track, 0, 1, map, outLeft, outRight, outRate);
    expect(Array.from(outLeft)).toEqual([1, 1, 0, 0, 1, 1]);
  });

  it('reads every other sample for a 2x speed mapping', () => {
    const track = {
      left: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]),
      right: new Float32Array(8),
      sampleRate: 10,
    };
    const outLeft = new Float32Array(4);
    const outRight = new Float32Array(4);
    renderTrackIntoMix(track, 0, 1, (t) => t * 2, outLeft, outRight, outRate);
    expect(Array.from(outLeft)).toEqual([0, 2, 4, 6]);
  });

  it('sums multiple renders into the same mix', () => {
    const track = {
      left: new Float32Array([0.25, 0.25]),
      right: new Float32Array([0.25, 0.25]),
      sampleRate: 10,
    };
    const outLeft = new Float32Array(2);
    const outRight = new Float32Array(2);
    renderTrackIntoMix(track, 0, 1, (t) => t, outLeft, outRight, outRate);
    renderTrackIntoMix(track, 0, 2, (t) => t, outLeft, outRight, outRate);
    expect(outLeft[0]).toBeCloseTo(0.75, 6);
    expect(outRight[1]).toBeCloseTo(0.75, 6);
  });
});
