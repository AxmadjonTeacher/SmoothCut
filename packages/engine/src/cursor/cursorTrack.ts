import type { VideoEvent } from '../time.js';
import {
  DEFAULT_SPRING_TUNING,
  SPRING_SAMPLE_RATE,
  bakeSpringTrack,
  extractClicks,
  extractPointerPath,
  scaleTuning,
} from './spring.js';
import type { SpringTuning } from './spring.js';

export interface CursorSample {
  x: number;
  y: number;
  speedUnitsPerSec: number;
  shapeId: string | null;
  hotspot: { x: number; y: number } | null;
  sizePx: { w: number; h: number } | null;
}

interface ShapeChange {
  tSec: number;
  shapeId: string;
  hotspot: { x: number; y: number };
  sizePx: { w: number; h: number };
}

export class CursorTrack {
  readonly durationSec: number;
  private readonly data: Float32Array;
  private readonly sampleCount: number;
  private readonly shapes: ShapeChange[];

  private constructor(data: Float32Array, durationSec: number, shapes: ShapeChange[]) {
    this.data = data;
    this.sampleCount = data.length / 4;
    this.durationSec = durationSec;
    this.shapes = shapes;
  }

  static bake(
    events: VideoEvent[],
    durationSec: number,
    smoothing: number,
    tuning: SpringTuning = DEFAULT_SPRING_TUNING,
  ): CursorTrack {
    const scaled = scaleTuning(tuning, smoothing);
    const data = bakeSpringTrack(
      extractPointerPath(events),
      extractClicks(events),
      durationSec,
      scaled,
    );
    const shapes: ShapeChange[] = [];
    for (const e of events) {
      if (e.type === 'cursorShape') {
        shapes.push({
          tSec: e.tSec,
          shapeId: e.shapeId,
          hotspot: { x: e.hotspot.x, y: e.hotspot.y },
          sizePx: { w: e.sizePx.w, h: e.sizePx.h },
        });
      }
    }
    return new CursorTrack(data, Math.max(0, durationSec), shapes);
  }

  sample(tSec: number): CursorSample {
    const maxIndex = this.sampleCount - 1;
    const t = Math.min(Math.max(tSec, 0), this.durationSec);
    const pos = Math.min(t * SPRING_SAMPLE_RATE, maxIndex);
    const i0 = Math.floor(pos);
    const i1 = Math.min(maxIndex, i0 + 1);
    const f = pos - i0;
    const d = this.data;
    const a = i0 * 4;
    const b = i1 * 4;
    const x = d[a]! + (d[b]! - d[a]!) * f;
    const y = d[a + 1]! + (d[b + 1]! - d[a + 1]!) * f;
    const vx = d[a + 2]! + (d[b + 2]! - d[a + 2]!) * f;
    const vy = d[a + 3]! + (d[b + 3]! - d[a + 3]!) * f;

    const shape = this.shapeAt(t);
    return {
      x,
      y,
      speedUnitsPerSec: Math.hypot(vx, vy),
      shapeId: shape ? shape.shapeId : null,
      hotspot: shape ? { x: shape.hotspot.x, y: shape.hotspot.y } : null,
      sizePx: shape ? { w: shape.sizePx.w, h: shape.sizePx.h } : null,
    };
  }

  /** Latest shape change at or before tSec, by binary search. */
  private shapeAt(tSec: number): ShapeChange | null {
    const shapes = this.shapes;
    if (shapes.length === 0 || shapes[0]!.tSec > tSec) return null;
    let lo = 0;
    let hi = shapes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (shapes[mid]!.tSec <= tSec) lo = mid;
      else hi = mid - 1;
    }
    return shapes[lo]!;
  }
}
