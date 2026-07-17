import type { VideoEvent } from '../time.js';

export interface SpringTuning {
  tension: number;
  drag: number;
  mass: number;
  preClickStiffenMs: number;
  lookaheadMs: number;
  shakeFilterAmp: number;
}

export const DEFAULT_SPRING_TUNING: SpringTuning = {
  tension: 530,
  drag: 1000,
  mass: 1,
  preClickStiffenMs: 175,
  lookaheadMs: 500,
  shakeFilterAmp: 0.004,
};

/** Fixed bake rate for all baked tracks (samples per second). */
export const SPRING_SAMPLE_RATE = 240;

export interface PathPoint {
  tSec: number;
  x: number;
  y: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Pointer positions usable as spring targets. Raw coordinates may leave the
 * capture rect; the synthetic cursor is kept inside it.
 */
export function extractPointerPath(events: VideoEvent[]): PathPoint[] {
  const path: PathPoint[] = [];
  for (const e of events) {
    if (e.type === 'move' || e.type === 'down' || e.type === 'up' || e.type === 'wheel') {
      path.push({ tSec: e.tSec, x: clamp01(e.x), y: clamp01(e.y) });
    }
  }
  return path;
}

export function extractClicks(events: VideoEvent[]): PathPoint[] {
  const clicks: PathPoint[] = [];
  for (const e of events) {
    if (e.type === 'down') clicks.push({ tSec: e.tSec, x: clamp01(e.x), y: clamp01(e.y) });
  }
  return clicks;
}

/**
 * Maps the user-facing smoothing knob (0..1) onto the spring: 0 → tension x8
 * (nearly raw following), 1 → x0.5 (heaviest smoothing), geometric in between.
 * Drag scales by sqrt of the same factor so the damping ratio is preserved.
 */
export function scaleTuning(tuning: SpringTuning, smoothing: number): SpringTuning {
  const f = 8 * Math.pow(1 / 16, clamp01(smoothing));
  return { ...tuning, tension: tuning.tension * f, drag: tuning.drag * Math.sqrt(f) };
}

/** Linear interpolation of the pointer path; holds the end values outside it. */
export function pathAt(path: PathPoint[], tSec: number): { x: number; y: number } {
  const first = path[0];
  if (!first) return { x: 0.5, y: 0.5 };
  if (tSec <= first.tSec) return { x: first.x, y: first.y };
  const last = path[path.length - 1]!;
  if (tSec >= last.tSec) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid]!.tSec <= tSec) lo = mid;
    else hi = mid;
  }
  const a = path[lo]!;
  const b = path[hi]!;
  const span = b.tSec - a.tSec;
  const f = span > 0 ? (tSec - a.tSec) / span : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/**
 * Bakes the spring-smoothed cursor into a Float32Array of interleaved
 * [x, y, vx, vy] samples at SPRING_SAMPLE_RATE using semi-implicit Euler.
 *
 * - Target = interpolated pointer position at (t + lookahead); the lookahead
 *   ramps in from zero so the cursor does not jump at t = 0.
 * - Within preClickStiffenMs before a down event, tension ramps up to ~4x at
 *   click time so the cursor arrives at the click point.
 * - The two samples bracketing each click are hard-snapped to the click
 *   coordinates, guaranteeing linear interpolation at the click time
 *   reproduces the click point exactly.
 * - Shake filter: while the raw target's amplitude over the trailing 100 ms is
 *   below shakeFilterAmp (unit space), the target is held still.
 */
export function bakeSpringTrack(
  path: PathPoint[],
  clicks: PathPoint[],
  durationSec: number,
  tuning: SpringTuning,
): Float32Array {
  const rate = SPRING_SAMPLE_RATE;
  const dt = 1 / rate;
  const n = Math.max(2, Math.floor(Math.max(0, durationSec) * rate) + 1);
  const out = new Float32Array(n * 4);

  const snaps = new Map<number, PathPoint>();
  for (const c of clicks) {
    const i0 = Math.min(n - 1, Math.max(0, Math.floor(c.tSec * rate)));
    snaps.set(i0, c);
    snaps.set(Math.min(n - 1, i0 + 1), c);
  }

  const lookaheadSec = tuning.lookaheadMs / 1000;
  const stiffenSec = tuning.preClickStiffenMs / 1000;

  const windowLen = Math.max(1, Math.round(0.1 * rate));
  const winX = new Float32Array(windowLen);
  const winY = new Float32Array(windowLen);

  const start = pathAt(path, 0);
  let x = start.x;
  let y = start.y;
  let vx = 0;
  let vy = 0;
  let heldX = start.x;
  let heldY = start.y;
  winX.fill(start.x);
  winY.fill(start.y);

  let clickIdx = 0;

  for (let i = 0; i < n; i++) {
    const t = i * dt;

    if (i > 0) {
      const la = lookaheadSec <= 0 ? 0 : lookaheadSec * Math.min(1, t / lookaheadSec);
      const raw = pathAt(path, t + la);

      const w = i % windowLen;
      winX[w] = raw.x;
      winY[w] = raw.y;
      let minX = raw.x;
      let maxX = raw.x;
      let minY = raw.y;
      let maxY = raw.y;
      for (let k = 0; k < windowLen; k++) {
        const wx = winX[k]!;
        const wy = winY[k]!;
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }
      const amp = Math.max(maxX - minX, maxY - minY);
      if (amp >= tuning.shakeFilterAmp) {
        heldX = raw.x;
        heldY = raw.y;
      }

      while (clickIdx < clicks.length && clicks[clickIdx]!.tSec < t) clickIdx++;
      const next = clicks[clickIdx];
      let mult = 1;
      if (next && stiffenSec > 0) {
        const until = next.tSec - t;
        if (until <= stiffenSec) mult = 1 + 3 * (1 - until / stiffenSec);
      }

      const k = tuning.tension * mult;
      const m = tuning.mass;
      // Semi-implicit Euler with implicit drag: drag/mass · dt exceeds the
      // explicit stability bound at these tunings, the implicit form is
      // unconditionally stable and just as deterministic.
      const damp = 1 + (tuning.drag / m) * dt;
      vx = (vx + ((k * (heldX - x)) / m) * dt) / damp;
      vy = (vy + ((k * (heldY - y)) / m) * dt) / damp;
      x += vx * dt;
      y += vy * dt;
    }

    const snap = snaps.get(i);
    if (snap) {
      x = snap.x;
      y = snap.y;
      vx = 0;
      vy = 0;
    }

    const o = i * 4;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = vx;
    out[o + 3] = vy;
  }
  return out;
}
