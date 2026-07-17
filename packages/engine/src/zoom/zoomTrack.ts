import type { ZoomConfig, ZoomSegment } from '@smoothcut/shared';
import type { CursorTrack } from '../cursor/cursorTrack.js';
import { SPRING_SAMPLE_RATE } from '../cursor/spring.js';

/** cx/cy are the UNIT-space center of the visible source rect at this scale. */
export interface ZoomSample {
  scale: number;
  cx: number;
  cy: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class ZoomTrack {
  readonly durationSec: number;
  private readonly data: Float32Array;
  private readonly sampleCount: number;

  private constructor(data: Float32Array, durationSec: number) {
    this.data = data;
    this.sampleCount = data.length / 3;
    this.durationSec = durationSec;
  }

  /**
   * Bakes scale + center at SPRING_SAMPLE_RATE. Scale runs a critically-damped
   * spring toward the active segment level (1.0 when none); config.smoothness
   * maps onto a ~0.25s..0.9s response time. Follow-cursor centers chase
   * cursor.sample through a slower spring; fixed targets use the full-speed
   * spring. Centers are clamped every step so the visible rect stays inside
   * the source (pinned to 0.5 at scale 1).
   */
  static bake(
    segments: ZoomSegment[],
    config: ZoomConfig,
    cursor: CursorTrack,
    durationSec: number,
  ): ZoomTrack {
    const rate = SPRING_SAMPLE_RATE;
    const dt = 1 / rate;
    const n = Math.max(2, Math.floor(Math.max(0, durationSec) * rate) + 1);
    const data = new Float32Array(n * 3);

    const sorted = [...segments].sort((a, b) => a.start - b.start);

    const smoothness = clamp01(config.smoothness);
    const responseSec = 0.25 + 0.65 * smoothness;
    // Critically damped: a = w^2 (target - x) - 2 w v; ~settled after responseSec.
    const omega = 6 / responseSec;
    const omegaFollow = omega * 0.45;

    let scale = 1;
    let vs = 0;
    let cx = 0.5;
    let vcx = 0;
    let cy = 0.5;
    let vcy = 0;
    // Held while no segment is active: the shrinking clamp window re-centers
    // the view smoothly as scale relaxes back to 1.
    let targetX = 0.5;
    let targetY = 0.5;

    let segIdx = 0;

    for (let i = 0; i < n; i++) {
      const t = i * dt;

      while (segIdx < sorted.length && sorted[segIdx]!.end < t) segIdx++;
      let active: ZoomSegment | null = null;
      for (let k = segIdx; k < sorted.length && sorted[k]!.start <= t; k++) {
        if (sorted[k]!.end >= t) {
          active = sorted[k]!;
          break;
        }
      }

      let targetScale = 1;
      let omegaCenter = omegaFollow;
      if (active) {
        targetScale = Math.max(1, active.level);
        if (active.target.mode === 'fixed') {
          targetX = clamp01(active.target.x);
          targetY = clamp01(active.target.y);
          omegaCenter = omega;
        } else {
          const c = cursor.sample(t);
          targetX = clamp01(c.x);
          targetY = clamp01(c.y);
          omegaCenter = omegaFollow;
        }
      }

      if (i > 0) {
        vs += (omega * omega * (targetScale - scale) - 2 * omega * vs) * dt;
        scale += vs * dt;
        if (scale < 1) {
          scale = 1;
          if (vs < 0) vs = 0;
        }

        vcx += (omegaCenter * omegaCenter * (targetX - cx) - 2 * omegaCenter * vcx) * dt;
        cx += vcx * dt;
        vcy += (omegaCenter * omegaCenter * (targetY - cy) - 2 * omegaCenter * vcy) * dt;
        cy += vcy * dt;
      }

      // CRITICAL edge clamp: keep the visible rect inside the source.
      const half = 0.5 / scale;
      if (cx < half) {
        cx = half;
        if (vcx < 0) vcx = 0;
      } else if (cx > 1 - half) {
        cx = 1 - half;
        if (vcx > 0) vcx = 0;
      }
      if (cy < half) {
        cy = half;
        if (vcy < 0) vcy = 0;
      } else if (cy > 1 - half) {
        cy = 1 - half;
        if (vcy > 0) vcy = 0;
      }

      const o = i * 3;
      data[o] = scale;
      data[o + 1] = cx;
      data[o + 2] = cy;
    }

    return new ZoomTrack(data, Math.max(0, durationSec));
  }

  sample(tSec: number): ZoomSample {
    const maxIndex = this.sampleCount - 1;
    const t = Math.min(Math.max(tSec, 0), this.durationSec);
    const pos = Math.min(t * SPRING_SAMPLE_RATE, maxIndex);
    const i0 = Math.floor(pos);
    const i1 = Math.min(maxIndex, i0 + 1);
    const f = pos - i0;
    const d = this.data;
    const a = i0 * 3;
    const b = i1 * 3;
    const scale = Math.max(1, d[a]! + (d[b]! - d[a]!) * f);
    // Re-clamp after interpolation: the clamp bound varies with scale between
    // samples, so blended values can drift out by a hair.
    const half = 0.5 / scale;
    const cx = Math.min(1 - half, Math.max(half, d[a + 1]! + (d[b + 1]! - d[a + 1]!) * f));
    const cy = Math.min(1 - half, Math.max(half, d[a + 2]! + (d[b + 2]! - d[a + 2]!) * f));
    return { scale, cx, cy };
  }
}
