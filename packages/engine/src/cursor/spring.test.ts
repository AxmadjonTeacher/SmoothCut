import { describe, expect, it } from 'vitest';
import type { VideoEvent } from '../time.js';
import { CursorTrack } from './cursorTrack.js';
import { extractRipples } from './ripples.js';
import { DEFAULT_SPRING_TUNING, SPRING_SAMPLE_RATE, bakeSpringTrack, scaleTuning } from './spring.js';

function move(tSec: number, x: number, y: number): VideoEvent {
  return { tSec, type: 'move', x, y };
}

function down(tSec: number, x: number, y: number): VideoEvent {
  return { tSec, type: 'down', x, y, button: 0 };
}

/** Straight-line move events at 125 Hz from (x0,y0) to (x1,y1). */
function sweep(t0: number, t1: number, x0: number, y0: number, x1: number, y1: number): VideoEvent[] {
  const out: VideoEvent[] = [];
  const steps = Math.round((t1 - t0) * 125);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    out.push(move(t0 + (t1 - t0) * f, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f));
  }
  return out;
}

describe('spring determinism', () => {
  it('produces bit-identical bakes for identical input', () => {
    const events = [...sweep(0, 1, 0.1, 0.1, 0.8, 0.6), down(1.2, 0.8, 0.6)];
    const a = CursorTrack.bake(events, 2, 0.5);
    const b = CursorTrack.bake(events, 2, 0.5);
    for (let t = 0; t <= 2; t += 0.01) {
      const sa = a.sample(t);
      const sb = b.sample(t);
      expect(sa.x).toBe(sb.x);
      expect(sa.y).toBe(sb.y);
      expect(sa.speedUnitsPerSec).toBe(sb.speedUnitsPerSec);
    }
  });

  it('bakes identical raw arrays for identical input', () => {
    const tuning = scaleTuning(DEFAULT_SPRING_TUNING, 0.3);
    const path = [
      { tSec: 0, x: 0.2, y: 0.2 },
      { tSec: 1, x: 0.9, y: 0.4 },
    ];
    const clicks = [{ tSec: 1.1, x: 0.9, y: 0.4 }];
    const a = bakeSpringTrack(path, clicks, 2, tuning);
    const b = bakeSpringTrack(path, clicks, 2, tuning);
    expect(a).toEqual(b);
  });
});

describe('lands on click', () => {
  it('sample(clickT) is within 1e-3 of the click point', () => {
    const clickT = 1.2;
    const clickX = 0.8;
    const clickY = 0.6;
    const events = [...sweep(0, 1, 0.1, 0.1, clickX, clickY), down(clickT, clickX, clickY)];
    for (const smoothing of [0, 0.5, 1]) {
      const track = CursorTrack.bake(events, 3, smoothing);
      const s = track.sample(clickT);
      expect(Math.abs(s.x - clickX)).toBeLessThan(1e-3);
      expect(Math.abs(s.y - clickY)).toBeLessThan(1e-3);
    }
  });

  it('lands even at off-grid click times', () => {
    const clickT = 0.7431;
    const events = [...sweep(0, 0.6, 0.3, 0.9, 0.55, 0.25), down(clickT, 0.55, 0.25)];
    const track = CursorTrack.bake(events, 2, 1);
    const s = track.sample(clickT);
    expect(Math.abs(s.x - 0.55)).toBeLessThan(1e-3);
    expect(Math.abs(s.y - 0.25)).toBeLessThan(1e-3);
  });

  it('stays continuous through a click mid-fast-motion (no teleport)', () => {
    // Click lands while the spring is still lagging far behind a fast sweep —
    // the old hard snap teleported the cursor here. The corrected track must
    // move at most a few thousandths of the canvas per 240 Hz sample.
    const clickT = 0.55;
    const events = [...sweep(0.3, 0.55, 0.1, 0.1, 0.9, 0.8), down(clickT, 0.9, 0.8)];
    for (const smoothing of [0.5, 1]) {
      const track = CursorTrack.bake(events, 2, smoothing);
      const dt = 1 / SPRING_SAMPLE_RATE;
      let maxStep = 0;
      let prev = track.sample(0);
      for (let t = dt; t <= 1.5; t += dt) {
        const s = track.sample(t);
        maxStep = Math.max(maxStep, Math.hypot(s.x - prev.x, s.y - prev.y));
        prev = s;
      }
      // Full-speed spring motion plus the eased click correction stays under
      // ~3e-2 per sample; a hard snap shows up as a step of 0.1+.
      expect(maxStep).toBeLessThan(0.04);
      const at = track.sample(clickT);
      expect(Math.abs(at.x - 0.9)).toBeLessThan(1e-3);
      expect(Math.abs(at.y - 0.8)).toBeLessThan(1e-3);
    }
  });
});

describe('shake filter', () => {
  it('holds the cursor still under sub-threshold jitter', () => {
    const events: VideoEvent[] = [];
    for (let i = 0; i <= 6 * 125; i++) {
      const t = i / 125;
      // deterministic jitter well below shakeFilterAmp (0.004)
      events.push(move(t, 0.5 + 0.001 * Math.sin(i * 1.7), 0.5 + 0.001 * Math.cos(i * 2.3)));
    }
    const track = CursorTrack.bake(events, 6, 0.5);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let t = 5; t <= 6; t += 1 / SPRING_SAMPLE_RATE) {
      const s = track.sample(t);
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
    }
    expect(maxX - minX).toBeLessThan(5e-4);
  });
});

describe('CursorTrack sampling', () => {
  it('exposes duration and clamps sampling outside it', () => {
    const track = CursorTrack.bake([move(0, 0.4, 0.4)], 2, 0.5);
    expect(track.durationSec).toBe(2);
    const before = track.sample(-1);
    const after = track.sample(99);
    expect(before.x).toBeCloseTo(0.4, 5);
    expect(after.x).toBeCloseTo(0.4, 5);
  });

  it('tracks cursor shape changes with binary search', () => {
    const events: VideoEvent[] = [
      move(0, 0.5, 0.5),
      {
        tSec: 1,
        type: 'cursorShape',
        shapeId: 'ibeam',
        hotspot: { x: 4, y: 8 },
        sizePx: { w: 16, h: 24 },
      },
      {
        tSec: 2,
        type: 'cursorShape',
        shapeId: 'pointer',
        hotspot: { x: 6, y: 2 },
        sizePx: { w: 24, h: 24 },
      },
    ];
    const track = CursorTrack.bake(events, 3, 0.5);
    expect(track.sample(0.5).shapeId).toBeNull();
    expect(track.sample(0.5).hotspot).toBeNull();
    expect(track.sample(0.5).sizePx).toBeNull();
    expect(track.sample(1).shapeId).toBe('ibeam');
    expect(track.sample(1.9).shapeId).toBe('ibeam');
    expect(track.sample(1.9).hotspot).toEqual({ x: 4, y: 8 });
    expect(track.sample(2.5).shapeId).toBe('pointer');
    expect(track.sample(2.5).sizePx).toEqual({ w: 24, h: 24 });
  });

  it('reports plausible speed while moving', () => {
    const events = sweep(0, 2, 0.1, 0.5, 0.9, 0.5);
    const track = CursorTrack.bake(events, 2.5, 0.2);
    // steady-state horizontal speed should be near the raw 0.4 units/sec
    const s = track.sample(1.5);
    expect(s.speedUnitsPerSec).toBeGreaterThan(0.1);
    expect(s.speedUnitsPerSec).toBeLessThan(1.5);
  });

  it('clamps out-of-bounds pointer coordinates', () => {
    const events = [move(0, -0.5, 0.5), move(1, 1.5, 0.5)];
    const track = CursorTrack.bake(events, 2, 0);
    for (let t = 0; t <= 2; t += 0.05) {
      const s = track.sample(t);
      expect(s.x).toBeGreaterThanOrEqual(-1e-6);
      expect(s.x).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe('extractRipples', () => {
  it('emits one ripple per down event, clamped to the capture rect', () => {
    const events: VideoEvent[] = [
      move(0.1, 0.2, 0.2),
      down(0.5, 0.25, 0.5),
      { tSec: 0.6, type: 'up', x: 0.25, y: 0.5, button: 0 },
      down(1.5, 1.2, -0.1),
    ];
    const ripples = extractRipples(events);
    expect(ripples).toEqual([
      { tSec: 0.5, x: 0.25, y: 0.5 },
      { tSec: 1.5, x: 1, y: 0 },
    ]);
  });
});
