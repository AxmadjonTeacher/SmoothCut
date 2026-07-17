import type { VideoEvent } from '../time.js';

export interface Ripple {
  tSec: number;
  x: number;
  y: number;
}

/** Click-ripple emitters: one per `down` event, clamped into the capture rect. */
export function extractRipples(events: VideoEvent[]): Ripple[] {
  const out: Ripple[] = [];
  for (const e of events) {
    if (e.type === 'down') {
      out.push({
        tSec: e.tSec,
        x: Math.min(1, Math.max(0, e.x)),
        y: Math.min(1, Math.max(0, e.y)),
      });
    }
  }
  return out;
}
