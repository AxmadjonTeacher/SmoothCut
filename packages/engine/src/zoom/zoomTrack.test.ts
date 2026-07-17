import { describe, expect, it } from 'vitest';
import type { ZoomConfig, ZoomSegment } from '@smoothcut/shared';
import type { VideoEvent } from '../time.js';
import { CursorTrack } from '../cursor/cursorTrack.js';
import { SPRING_SAMPLE_RATE } from '../cursor/spring.js';
import { ZoomTrack } from './zoomTrack.js';

const CONFIG: ZoomConfig = {
  defaultLevel: 2,
  smoothness: 0.5,
  leadSec: 0.9,
  holdSec: 1.4,
  clusterGapSec: 2.5,
};

/** Deterministic LCG so the "random" walks are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randomWalkCursor(seed: number, durationSec: number): CursorTrack {
  const rnd = lcg(seed);
  const events: VideoEvent[] = [];
  let x = rnd();
  let y = rnd();
  for (let i = 0; i <= durationSec * 60; i++) {
    // wander aggressively, often beyond the edges
    x += (rnd() - 0.5) * 0.3;
    y += (rnd() - 0.5) * 0.3;
    events.push({ tSec: i / 60, type: 'move', x, y });
    if (rnd() < 0.02) events.push({ tSec: i / 60 + 0.001, type: 'down', x, y, button: 0 });
  }
  return CursorTrack.bake(events, durationSec, rnd());
}

function randomSegments(seed: number, durationSec: number): ZoomSegment[] {
  const rnd = lcg(seed);
  const segments: ZoomSegment[] = [];
  let t = 0;
  let i = 0;
  while (t < durationSec - 1) {
    const start = t + rnd() * 2;
    const end = Math.min(durationSec, start + 0.5 + rnd() * 3);
    if (end <= start) break;
    const fixed = rnd() < 0.5;
    segments.push({
      id: `z${i++}`,
      start,
      end,
      level: 1 + rnd() * 2,
      // fixed targets near edges/corners stress the clamp the hardest
      target: fixed ? { mode: 'fixed', x: rnd() * 1.4 - 0.2, y: rnd() * 1.4 - 0.2 } : { mode: 'follow-cursor' },
      origin: 'manual',
    });
    t = end + rnd();
  }
  return segments;
}

function assertInBounds(track: ZoomTrack, durationSec: number): void {
  const eps = 1e-4;
  const step = 1 / SPRING_SAMPLE_RATE;
  for (let t = -0.5; t <= durationSec + 0.5; t += step) {
    const s = track.sample(t);
    expect(s.scale).toBeGreaterThanOrEqual(1 - eps);
    const half = 0.5 / s.scale;
    expect(s.cx - half).toBeGreaterThanOrEqual(-eps);
    expect(s.cx + half).toBeLessThanOrEqual(1 + eps);
    expect(s.cy - half).toBeGreaterThanOrEqual(-eps);
    expect(s.cy + half).toBeLessThanOrEqual(1 + eps);
  }
}

describe('ZoomTrack clamp invariant', () => {
  it('keeps the visible rect inside the source for random segments + cursor walks', () => {
    for (const seed of [1, 42, 1337, 90210]) {
      const duration = 12;
      const cursor = randomWalkCursor(seed, duration);
      const segments = randomSegments(seed * 7 + 1, duration);
      const track = ZoomTrack.bake(segments, CONFIG, cursor, duration);
      assertInBounds(track, duration);
    }
  });

  it('pins the center to 0.5 at scale 1', () => {
    const cursor = randomWalkCursor(5, 5);
    const track = ZoomTrack.bake([], CONFIG, cursor, 5);
    for (let t = 0; t <= 5; t += 0.05) {
      const s = track.sample(t);
      expect(s.scale).toBe(1);
      expect(s.cx).toBe(0.5);
      expect(s.cy).toBe(0.5);
    }
  });
});

describe('ZoomTrack dynamics', () => {
  it('converges to the segment level and the clamped fixed target', () => {
    const cursor = randomWalkCursor(9, 10);
    const segments: ZoomSegment[] = [
      { id: 'z', start: 1, end: 9, level: 2, target: { mode: 'fixed', x: 0.9, y: 0.9 }, origin: 'manual' },
    ];
    const track = ZoomTrack.bake(segments, CONFIG, cursor, 10);
    const s = track.sample(8.5);
    expect(s.scale).toBeCloseTo(2, 1);
    // clamp bound at scale 2 is [0.25, 0.75]; the 0.9 target must be clamped
    expect(s.cx).toBeCloseTo(0.75, 1);
    expect(s.cy).toBeCloseTo(0.75, 1);
  });

  it('relaxes back to identity after the segment ends', () => {
    const cursor = randomWalkCursor(11, 12);
    const segments: ZoomSegment[] = [
      { id: 'z', start: 0.5, end: 2, level: 2.5, target: { mode: 'follow-cursor' }, origin: 'auto' },
    ];
    const track = ZoomTrack.bake(segments, CONFIG, cursor, 12);
    const during = track.sample(1.9);
    expect(during.scale).toBeGreaterThan(1.8);
    const after = track.sample(9);
    expect(after.scale).toBeCloseTo(1, 2);
    expect(after.cx).toBeCloseTo(0.5, 2);
    expect(after.cy).toBeCloseTo(0.5, 2);
  });

  it('follow-cursor chases the cursor position', () => {
    const events: VideoEvent[] = [];
    for (let i = 0; i <= 10 * 60; i++) {
      events.push({ tSec: i / 60, type: 'move', x: 0.2, y: 0.6 });
    }
    const cursor = CursorTrack.bake(events, 10, 0.5);
    const segments: ZoomSegment[] = [
      { id: 'z', start: 1, end: 9, level: 2, target: { mode: 'follow-cursor' }, origin: 'auto' },
    ];
    const track = ZoomTrack.bake(segments, CONFIG, cursor, 10);
    const s = track.sample(8.5);
    // cursor sits at (0.2, 0.6); clamp range at scale 2 is [0.25, 0.75]
    expect(s.cx).toBeCloseTo(0.25, 1);
    expect(s.cy).toBeCloseTo(0.6, 1);
  });

  it('is deterministic', () => {
    const cursor = randomWalkCursor(21, 8);
    const segments = randomSegments(22, 8);
    const a = ZoomTrack.bake(segments, CONFIG, cursor, 8);
    const b = ZoomTrack.bake(segments, CONFIG, cursor, 8);
    for (let t = 0; t <= 8; t += 0.01) {
      expect(a.sample(t)).toEqual(b.sample(t));
    }
  });
});
