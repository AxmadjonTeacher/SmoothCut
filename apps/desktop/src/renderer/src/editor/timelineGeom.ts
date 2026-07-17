/**
 * Pure px <-> time math for the timeline. No runtime imports so it stays
 * trivially unit-testable in bare node (vitest).
 *
 * The timeline renders in OUTPUT time (source duration / speed). Cut
 * boundaries render as slim visual gaps of `gapPx`, so the px position of an
 * output time also depends on how many segment boundaries precede it.
 */
import type { TimelineSegment } from '@smoothcut/shared';

export interface LaneMetrics {
  pxPerSec: number;
  gapPx: number;
}

export interface ClipRect {
  id: string;
  x: number;
  width: number;
  outStart: number;
  outEnd: number;
}

export function segmentOutputDuration(segment: TimelineSegment): number {
  return (segment.sourceEnd - segment.sourceStart) / segment.speed;
}

export function totalOutput(segments: readonly TimelineSegment[]): number {
  let total = 0;
  for (const s of segments) total += segmentOutputDuration(s);
  return total;
}

/** px/sec so that all clips plus inter-clip gaps exactly fill `widthPx`. */
export function fitPxPerSec(
  segments: readonly TimelineSegment[],
  widthPx: number,
  gapPx: number,
): number {
  const total = totalOutput(segments);
  if (total <= 0) return 100;
  const usable = widthPx - gapPx * Math.max(0, segments.length - 1);
  return Math.max(1e-6, usable / total);
}

/** Output time -> px. Gaps for every completed segment boundary are added. */
export function outputTimeToPx(
  segments: readonly TimelineSegment[],
  metrics: LaneMetrics,
  tOut: number,
): number {
  if (tOut <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const dur = segmentOutputDuration(s);
    const isLast = i === segments.length - 1;
    if (tOut < acc + dur || (isLast && tOut <= acc + dur)) {
      return tOut * metrics.pxPerSec + i * metrics.gapPx;
    }
    acc += dur;
  }
  return acc * metrics.pxPerSec + Math.max(0, segments.length - 1) * metrics.gapPx;
}

/**
 * px -> output time, clamped into [0, total]. Positions inside a visual gap
 * map to the start of the following segment.
 */
export function pxToOutputTime(
  segments: readonly TimelineSegment[],
  metrics: LaneMetrics,
  px: number,
): number {
  if (px <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const dur = segmentOutputDuration(s);
    const spanEndPx = (acc + dur) * metrics.pxPerSec + i * metrics.gapPx;
    if (px <= spanEndPx) {
      const t = (px - i * metrics.gapPx) / metrics.pxPerSec;
      return Math.min(acc + dur, Math.max(acc, t));
    }
    acc += dur;
  }
  return acc;
}

/** One rect per segment, in px, with gaps between consecutive clips. */
export function clipRects(
  segments: readonly TimelineSegment[],
  metrics: LaneMetrics,
): ClipRect[] {
  const rects: ClipRect[] = [];
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const dur = segmentOutputDuration(s);
    rects.push({
      id: s.id,
      x: acc * metrics.pxPerSec + i * metrics.gapPx,
      width: dur * metrics.pxPerSec,
      outStart: acc,
      outEnd: acc + dur,
    });
    acc += dur;
  }
  return rects;
}

/**
 * Maps a SOURCE interval onto the output timeline as the union of its
 * overlaps with the kept segments. Null when the interval falls entirely
 * inside cuts.
 */
export function sourceRangeToOutput(
  segments: readonly TimelineSegment[],
  srcStart: number,
  srcEnd: number,
): { start: number; end: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  let acc = 0;
  for (const s of segments) {
    const dur = segmentOutputDuration(s);
    const overlapS = Math.max(srcStart, s.sourceStart);
    const overlapE = Math.min(srcEnd, s.sourceEnd);
    if (overlapE > overlapS) {
      const outS = acc + (overlapS - s.sourceStart) / s.speed;
      const outE = acc + (overlapE - s.sourceStart) / s.speed;
      if (outS < lo) lo = outS;
      if (outE > hi) hi = outE;
    }
    acc += dur;
  }
  return hi > lo ? { start: lo, end: hi } : null;
}

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Smallest "nice" tick step that keeps ticks at least `minPx` apart. */
export function chooseTickStep(pxPerSec: number, minPx = 70): number {
  for (const step of TICK_STEPS) {
    if (step * pxPerSec >= minPx) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1]!;
}

/** m:ss.t — e.g. 83.46s -> "1:23.4". */
export function formatTime(sec: number): string {
  const tenths = Math.floor(Math.max(0, sec) * 10);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const t = tenths % 10;
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}

/** m:ss for ruler labels. */
export function formatTimeShort(sec: number): string {
  const whole = Math.max(0, Math.round(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Shifts a zoom segment by `delta` SOURCE seconds, clamping so the whole
 * segment stays inside [0, durationSec] without changing its length.
 */
export function shiftZoomRange(
  start: number,
  end: number,
  delta: number,
  durationSec: number,
): { start: number; end: number } {
  const clamped = Math.min(Math.max(delta, -start), Math.max(-start, durationSec - end));
  return { start: start + clamped, end: end + clamped };
}

/**
 * Moves one edge of a zoom segment to `tSrc` (SOURCE seconds), keeping at
 * least `minLen` and staying inside [0, durationSec].
 */
export function resizeZoomRange(
  start: number,
  end: number,
  edge: 'start' | 'end',
  tSrc: number,
  durationSec: number,
  minLen = 0.4,
): { start: number; end: number } {
  if (edge === 'start') {
    const hi = Math.max(0, end - minLen);
    return { start: Math.min(hi, Math.max(0, tSrc)), end };
  }
  const lo = Math.min(durationSec, start + minLen);
  return { start, end: Math.max(lo, Math.min(durationSec, tSrc)) };
}
