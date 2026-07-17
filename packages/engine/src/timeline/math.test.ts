import { describe, expect, it } from 'vitest';
import type { TimelineSegment } from '@smoothcut/shared';
import {
  MIN_SEGMENT_SEC,
  deleteSegment,
  outputToSource,
  segmentAtOutput,
  setSpeed,
  sourceToOutput,
  splitAt,
  totalOutputDuration,
  trimSegment,
} from './math.js';

function seg(id: string, sourceStart: number, sourceEnd: number, speed = 1): TimelineSegment {
  return { id, sourceStart, sourceEnd, speed };
}

// [0..4] at 1x (4s out), cut [4..5], [5..9] at 2x (2s out) → 6s output
const TIMELINE: TimelineSegment[] = [seg('a', 0, 4), seg('b', 5, 9, 2)];

describe('totalOutputDuration', () => {
  it('sums per-segment durations divided by speed', () => {
    expect(totalOutputDuration(TIMELINE)).toBeCloseTo(6, 10);
    expect(totalOutputDuration([])).toBe(0);
    expect(totalOutputDuration([seg('x', 2, 3, 0.5)])).toBeCloseTo(2, 10);
  });
});

describe('outputToSource', () => {
  it('maps within segments, honoring speed', () => {
    expect(outputToSource(TIMELINE, 0)).toBeCloseTo(0, 10);
    expect(outputToSource(TIMELINE, 2)).toBeCloseTo(2, 10);
    expect(outputToSource(TIMELINE, 4.5)).toBeCloseTo(6, 10); // 0.5s into 2x segment
  });

  it('handles boundaries: junction goes to the later segment, end to the last', () => {
    expect(outputToSource(TIMELINE, 4)).toBeCloseTo(5, 10);
    expect(outputToSource(TIMELINE, 6)).toBeCloseTo(9, 10);
  });

  it('returns null outside the output range', () => {
    expect(outputToSource(TIMELINE, -0.001)).toBeNull();
    expect(outputToSource(TIMELINE, 6.001)).toBeNull();
    expect(outputToSource([], 0)).toBeNull();
  });
});

describe('sourceToOutput', () => {
  it('maps within segments, honoring speed', () => {
    expect(sourceToOutput(TIMELINE, 2)).toBeCloseTo(2, 10);
    expect(sourceToOutput(TIMELINE, 6)).toBeCloseTo(4.5, 10);
    expect(sourceToOutput(TIMELINE, 9)).toBeCloseTo(6, 10);
  });

  it('returns null inside a cut and outside all segments', () => {
    expect(sourceToOutput(TIMELINE, 4.5)).toBeNull();
    expect(sourceToOutput(TIMELINE, -1)).toBeNull();
    expect(sourceToOutput(TIMELINE, 9.5)).toBeNull();
  });

  it('round-trips output → source → output', () => {
    for (let tOut = 0; tOut <= 6; tOut += 0.13) {
      const tSrc = outputToSource(TIMELINE, tOut);
      expect(tSrc).not.toBeNull();
      const back = sourceToOutput(TIMELINE, tSrc!);
      expect(back).not.toBeNull();
      expect(back!).toBeCloseTo(tOut, 9);
    }
  });
});

describe('segmentAtOutput', () => {
  it('finds the segment and index', () => {
    expect(segmentAtOutput(TIMELINE, 1)).toEqual({ segment: TIMELINE[0], index: 0 });
    expect(segmentAtOutput(TIMELINE, 5)).toEqual({ segment: TIMELINE[1], index: 1 });
  });

  it('junction boundary belongs to the later segment; total end to the last', () => {
    expect(segmentAtOutput(TIMELINE, 4)!.index).toBe(1);
    expect(segmentAtOutput(TIMELINE, 6)!.index).toBe(1);
    expect(segmentAtOutput(TIMELINE, 0)!.index).toBe(0);
  });

  it('returns null out of range', () => {
    expect(segmentAtOutput(TIMELINE, -0.1)).toBeNull();
    expect(segmentAtOutput(TIMELINE, 6.1)).toBeNull();
    expect(segmentAtOutput([], 0)).toBeNull();
  });
});

describe('splitAt', () => {
  it('splits a segment into two at a source time', () => {
    const out = splitAt(TIMELINE, 2);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: 'a', sourceStart: 0, sourceEnd: 2, speed: 1 });
    expect(out[1]).toMatchObject({ sourceStart: 2, sourceEnd: 4, speed: 1 });
    expect(out[1]!.id).not.toBe('a');
    expect(out[2]).toEqual(TIMELINE[1]);
  });

  it('is a no-op at segment boundaries', () => {
    expect(splitAt(TIMELINE, 0)).toEqual(TIMELINE);
    expect(splitAt(TIMELINE, 4)).toEqual(TIMELINE);
    expect(splitAt(TIMELINE, 5)).toEqual(TIMELINE);
  });

  it('is a no-op inside a cut', () => {
    expect(splitAt(TIMELINE, 4.5)).toEqual(TIMELINE);
  });

  it('is a no-op when a piece would fall under the minimum length', () => {
    expect(splitAt(TIMELINE, 0.05)).toEqual(TIMELINE);
    expect(splitAt(TIMELINE, 3.96)).toEqual(TIMELINE);
  });

  it('does not mutate its input and generates unique ids across repeated splits', () => {
    const once = splitAt(TIMELINE, 2);
    const twice = splitAt(once, 1);
    expect(TIMELINE).toHaveLength(2);
    const ids = twice.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('deleteSegment', () => {
  it('removes by id, creating a cut', () => {
    const out = deleteSegment(TIMELINE, 'a');
    expect(out).toEqual([TIMELINE[1]]);
    expect(sourceToOutput(out, 2)).toBeNull();
  });

  it('is a no-op for unknown ids', () => {
    expect(deleteSegment(TIMELINE, 'nope')).toEqual(TIMELINE);
  });
});

describe('setSpeed', () => {
  it('sets and clamps speed to [0.5, 16]', () => {
    expect(setSpeed(TIMELINE, 'a', 4)[0]!.speed).toBe(4);
    expect(setSpeed(TIMELINE, 'a', 0.01)[0]!.speed).toBe(0.5);
    expect(setSpeed(TIMELINE, 'a', 99)[0]!.speed).toBe(16);
    expect(setSpeed(TIMELINE, 'a', 4)[1]!.speed).toBe(2);
  });
});

describe('trimSegment', () => {
  it('trims the start edge', () => {
    const out = trimSegment(TIMELINE, 'a', 'start', 1);
    expect(out[0]!.sourceStart).toBe(1);
    expect(out[0]!.sourceEnd).toBe(4);
  });

  it('trims the end edge', () => {
    const out = trimSegment(TIMELINE, 'b', 'end', 7);
    expect(out[1]!.sourceEnd).toBe(7);
  });

  it('clamps the start so at least MIN_SEGMENT_SEC remains', () => {
    const out = trimSegment(TIMELINE, 'a', 'start', 99);
    expect(out[0]!.sourceStart).toBeCloseTo(4 - MIN_SEGMENT_SEC, 10);
  });

  it('clamps the end so at least MIN_SEGMENT_SEC remains', () => {
    const out = trimSegment(TIMELINE, 'b', 'end', -99);
    expect(out[1]!.sourceEnd).toBeCloseTo(5 + MIN_SEGMENT_SEC, 10);
  });

  it('never overlaps the previous segment when trimming start', () => {
    const out = trimSegment(TIMELINE, 'b', 'start', 2);
    expect(out[1]!.sourceStart).toBe(4); // clamped to a.sourceEnd
  });

  it('never overlaps the next segment when trimming end', () => {
    const out = trimSegment(TIMELINE, 'a', 'end', 8);
    expect(out[0]!.sourceEnd).toBe(5); // clamped to b.sourceStart
  });

  it('never trims the first segment before 0', () => {
    const out = trimSegment(TIMELINE, 'a', 'start', -5);
    expect(out[0]!.sourceStart).toBe(0);
  });

  it('allows extending the last segment end freely (source length unknown here)', () => {
    const out = trimSegment(TIMELINE, 'b', 'end', 12);
    expect(out[1]!.sourceEnd).toBe(12);
  });

  it('is a no-op for unknown ids and does not mutate input', () => {
    expect(trimSegment(TIMELINE, 'zzz', 'start', 1)).toEqual(TIMELINE);
    trimSegment(TIMELINE, 'a', 'start', 3);
    expect(TIMELINE[0]!.sourceStart).toBe(0);
  });
});
