import { describe, expect, it } from 'vitest';
import type { TimelineSegment } from '@smoothcut/shared';
import {
  chooseTickStep,
  clipRects,
  fitPxPerSec,
  formatTime,
  formatTimeShort,
  outputTimeToPx,
  pxToOutputTime,
  resizeZoomRange,
  segmentOutputDuration,
  shiftZoomRange,
  sourceRangeToOutput,
  totalOutput,
} from './timelineGeom';

const seg = (id: string, sourceStart: number, sourceEnd: number, speed = 1): TimelineSegment => ({
  id,
  sourceStart,
  sourceEnd,
  speed,
});

// 0..4s at 1x (out 0..4), cut 4..6, 6..10s at 2x (out 4..6)
const segments = [seg('a', 0, 4), seg('b', 6, 10, 2)];
const metrics = { pxPerSec: 100, gapPx: 6 };

describe('durations', () => {
  it('computes output duration with speed', () => {
    expect(segmentOutputDuration(seg('x', 2, 6, 2))).toBe(2);
    expect(totalOutput(segments)).toBe(6);
  });

  it('fits px/sec into a width minus gaps', () => {
    // 6s total, one gap of 6px in 606px -> 100 px/sec
    expect(fitPxPerSec(segments, 606, 6)).toBeCloseTo(100);
    expect(fitPxPerSec([], 500, 6)).toBe(100);
    expect(fitPxPerSec(segments, 0, 6)).toBeGreaterThan(0);
  });
});

describe('outputTimeToPx / pxToOutputTime', () => {
  it('maps times inside the first segment', () => {
    expect(outputTimeToPx(segments, metrics, 0)).toBe(0);
    expect(outputTimeToPx(segments, metrics, 2)).toBe(200);
  });

  it('adds the gap for later segments', () => {
    // 4.5s out = 1s into segment b -> 450px + one gap
    expect(outputTimeToPx(segments, metrics, 4.5)).toBe(456);
    // total end belongs to the last segment
    expect(outputTimeToPx(segments, metrics, 6)).toBe(606);
  });

  it('clamps out-of-range times', () => {
    expect(outputTimeToPx(segments, metrics, -1)).toBe(0);
    expect(outputTimeToPx(segments, metrics, 99)).toBe(606);
  });

  it('is inverse of pxToOutputTime on segment interiors', () => {
    for (const t of [0, 1.25, 3.999, 4.5, 5.9, 6]) {
      const px = outputTimeToPx(segments, metrics, t);
      expect(pxToOutputTime(segments, metrics, px)).toBeCloseTo(t, 6);
    }
  });

  it('maps px inside a gap to the boundary', () => {
    // segment a ends at 400px; gap spans 400..406
    expect(pxToOutputTime(segments, metrics, 403)).toBeCloseTo(4, 6);
  });

  it('clamps px outside the lane', () => {
    expect(pxToOutputTime(segments, metrics, -50)).toBe(0);
    expect(pxToOutputTime(segments, metrics, 10_000)).toBe(6);
  });
});

describe('clipRects', () => {
  it('lays out clips with gaps', () => {
    const rects = clipRects(segments, metrics);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ id: 'a', x: 0, width: 400, outStart: 0, outEnd: 4 });
    expect(rects[1]).toMatchObject({ id: 'b', x: 406, width: 200, outStart: 4, outEnd: 6 });
  });
});

describe('sourceRangeToOutput', () => {
  it('maps a range inside one segment', () => {
    expect(sourceRangeToOutput(segments, 1, 3)).toEqual({ start: 1, end: 3 });
  });

  it('maps across a cut, collapsing the removed span', () => {
    // 3..7 source: 3..4 kept (out 3..4), 6..7 kept at 2x (out 4..4.5)
    expect(sourceRangeToOutput(segments, 3, 7)).toEqual({ start: 3, end: 4.5 });
  });

  it('returns null for ranges fully inside a cut', () => {
    expect(sourceRangeToOutput(segments, 4.2, 5.8)).toBeNull();
    expect(sourceRangeToOutput(segments, 11, 12)).toBeNull();
  });

  it('applies segment speed to the mapped range', () => {
    expect(sourceRangeToOutput(segments, 7, 9)).toEqual({ start: 4.5, end: 5.5 });
  });
});

describe('chooseTickStep', () => {
  it('keeps ticks at least minPx apart', () => {
    expect(chooseTickStep(100)).toBe(1);
    expect(chooseTickStep(1000)).toBe(0.1);
    expect(chooseTickStep(10)).toBe(10);
  });

  it('falls back to the largest step for tiny scales', () => {
    expect(chooseTickStep(0.01)).toBe(600);
  });
});

describe('formatTime', () => {
  it('formats m:ss.t', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(83.46)).toBe('1:23.4');
    expect(formatTime(-2)).toBe('0:00.0');
  });

  it('formats short m:ss', () => {
    expect(formatTimeShort(0)).toBe('0:00');
    expect(formatTimeShort(65)).toBe('1:05');
  });
});

describe('zoom range edits', () => {
  it('shifts without changing length and clamps to bounds', () => {
    expect(shiftZoomRange(1, 3, 0.5, 10)).toEqual({ start: 1.5, end: 3.5 });
    expect(shiftZoomRange(1, 3, -5, 10)).toEqual({ start: 0, end: 2 });
    expect(shiftZoomRange(1, 3, 50, 10)).toEqual({ start: 8, end: 10 });
  });

  it('resizes with a minimum length', () => {
    expect(resizeZoomRange(1, 3, 'start', 2, 10)).toEqual({ start: 2, end: 3 });
    expect(resizeZoomRange(1, 3, 'start', 2.9, 10)).toEqual({ start: 2.6, end: 3 });
    expect(resizeZoomRange(1, 3, 'end', 1.1, 10)).toEqual({ start: 1, end: 1.4 });
    expect(resizeZoomRange(1, 3, 'end', 99, 10)).toEqual({ start: 1, end: 10 });
  });

  it('never leaves [0, duration]', () => {
    expect(resizeZoomRange(0, 0.5, 'start', -4, 10).start).toBe(0);
    expect(resizeZoomRange(9.8, 10, 'end', 99, 10).end).toBe(10);
  });
});
