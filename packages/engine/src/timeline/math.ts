import type { TimelineSegment } from '@smoothcut/shared';

/** Segments may never shrink below this (source seconds). */
export const MIN_SEGMENT_SEC = 0.1;

const SPEED_MIN = 0.5;
const SPEED_MAX = 16;

function segmentOutputDuration(segment: TimelineSegment): number {
  return (segment.sourceEnd - segment.sourceStart) / segment.speed;
}

export function totalOutputDuration(segments: TimelineSegment[]): number {
  let total = 0;
  for (const s of segments) total += segmentOutputDuration(s);
  return total;
}

/**
 * Maps an output-timeline time to source seconds. Null outside the output
 * range. Boundaries between segments belong to the later segment; the final
 * end boundary belongs to the last segment.
 */
export function outputToSource(segments: TimelineSegment[], tOut: number): number | null {
  if (tOut < 0) return null;
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const dur = segmentOutputDuration(s);
    const isLast = i === segments.length - 1;
    if (tOut < acc + dur || (isLast && tOut <= acc + dur)) {
      return s.sourceStart + (tOut - acc) * s.speed;
    }
    acc += dur;
  }
  return null;
}

/** Maps source seconds to the output timeline; null when tSrc falls in a cut. */
export function sourceToOutput(segments: TimelineSegment[], tSrc: number): number | null {
  let acc = 0;
  for (const s of segments) {
    if (tSrc >= s.sourceStart && tSrc <= s.sourceEnd) {
      return acc + (tSrc - s.sourceStart) / s.speed;
    }
    acc += segmentOutputDuration(s);
  }
  return null;
}

export function segmentAtOutput(
  segments: TimelineSegment[],
  tOut: number,
): { segment: TimelineSegment; index: number } | null {
  if (tOut < 0) return null;
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const dur = segmentOutputDuration(s);
    const isLast = i === segments.length - 1;
    if (tOut < acc + dur || (isLast && tOut <= acc + dur)) {
      return { segment: s, index: i };
    }
    acc += dur;
  }
  return null;
}

function uniqueId(segments: TimelineSegment[], base: string): string {
  const taken = new Set(segments.map((s) => s.id));
  let candidate = `${base}-b`;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-b${counter}`;
    counter++;
  }
  return candidate;
}

/**
 * Splits the segment containing tSrc into two at that source time. A no-op
 * (copy returned) when tSrc lies on a boundary, in a cut, or so close to an
 * edge that a piece would fall under MIN_SEGMENT_SEC.
 */
export function splitAt(segments: TimelineSegment[], tSrc: number): TimelineSegment[] {
  const idx = segments.findIndex((s) => tSrc > s.sourceStart && tSrc < s.sourceEnd);
  if (idx < 0) return segments.slice();
  const seg = segments[idx]!;
  if (tSrc - seg.sourceStart < MIN_SEGMENT_SEC || seg.sourceEnd - tSrc < MIN_SEGMENT_SEC) {
    return segments.slice();
  }
  const left: TimelineSegment = { ...seg, sourceEnd: tSrc };
  const right: TimelineSegment = { ...seg, id: uniqueId(segments, seg.id), sourceStart: tSrc };
  return [...segments.slice(0, idx), left, right, ...segments.slice(idx + 1)];
}

export function deleteSegment(segments: TimelineSegment[], id: string): TimelineSegment[] {
  return segments.filter((s) => s.id !== id);
}

export function setSpeed(segments: TimelineSegment[], id: string, speed: number): TimelineSegment[] {
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  return segments.map((s) => (s.id === id ? { ...s, speed: clamped } : s));
}

/**
 * Moves one edge of a segment to tSrc, clamped so the segment keeps at least
 * MIN_SEGMENT_SEC, never overlaps its neighbors, and never starts before 0.
 */
export function trimSegment(
  segments: TimelineSegment[],
  id: string,
  edge: 'start' | 'end',
  tSrc: number,
): TimelineSegment[] {
  const idx = segments.findIndex((s) => s.id === id);
  if (idx < 0) return segments.slice();
  const seg = segments[idx]!;

  if (edge === 'start') {
    const hi = seg.sourceEnd - MIN_SEGMENT_SEC;
    const lo = Math.min(hi, idx > 0 ? segments[idx - 1]!.sourceEnd : 0);
    const next = Math.min(hi, Math.max(lo, tSrc));
    return segments.map((s, i) => (i === idx ? { ...s, sourceStart: next } : s));
  }

  const lo = seg.sourceStart + MIN_SEGMENT_SEC;
  const hi = Math.max(lo, idx < segments.length - 1 ? segments[idx + 1]!.sourceStart : Infinity);
  const next = Math.min(hi, Math.max(lo, tSrc));
  return segments.map((s, i) => (i === idx ? { ...s, sourceEnd: next } : s));
}
