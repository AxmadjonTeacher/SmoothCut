import { Container, Graphics } from 'pixi.js';
import type { Ripple } from '../cursor/ripples.js';
import type { RectPx } from './layout.js';

export const RIPPLE_DURATION_SEC = 0.45;

/** Pooled expanding-and-fading click rings, positioned in screen-rect space. */
export class RippleLayer extends Container {
  private readonly pool: Graphics[] = [];
  private ripples: Ripple[] = [];
  private enabled = true;

  setRipples(ripples: Ripple[]): void {
    this.ripples = [...ripples].sort((a, b) => a.tSec - b.tSec);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  update(tSec: number, rect: RectPx): void {
    let used = 0;
    if (this.enabled && this.ripples.length > 0) {
      const from = tSec - RIPPLE_DURATION_SEC;
      let i = this.lowerBound(from);
      for (; i < this.ripples.length; i++) {
        const r = this.ripples[i]!;
        if (r.tSec > tSec) break;
        const p = (tSec - r.tSec) / RIPPLE_DURATION_SEC;
        this.drawRipple(this.acquire(used++), r, p, rect);
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }

  private acquire(index: number): Graphics {
    let g = this.pool[index];
    if (!g) {
      g = new Graphics();
      this.pool.push(g);
      this.addChild(g);
    }
    g.visible = true;
    return g;
  }

  private drawRipple(g: Graphics, r: Ripple, progress: number, rect: RectPx): void {
    const maxRadius = 0.05 * Math.min(rect.width, rect.height);
    const eased = 1 - (1 - progress) * (1 - progress);
    const radius = maxRadius * (0.2 + 0.8 * eased);
    const fade = 1 - progress;
    g.clear();
    g.circle(rect.x + r.x * rect.width, rect.y + r.y * rect.height, radius)
      .fill({ color: 0xffffff, alpha: 0.12 * fade })
      .stroke({ width: Math.max(1.5, maxRadius * 0.09), color: 0xffffff, alpha: 0.85 * fade });
  }

  /** First index with tSec >= t. */
  private lowerBound(t: number): number {
    let lo = 0;
    let hi = this.ripples.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ripples[mid]!.tSec < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
