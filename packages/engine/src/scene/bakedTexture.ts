import { ImageSource, Texture } from 'pixi.js';
import type { BakeCanvas } from './canvas2d.js';

/**
 * A persistent GPU texture for baked masks/shadows, UPDATED in place on
 * re-bake instead of destroyed and recreated.
 *
 * Keeping the TextureSource identity stable is load-bearing, not an
 * optimization: pixi's pooled AlphaMaskEffect keeps the last mask source
 * inside a shader BindGroup, and BindGroup.onResourceChange DESTROYS the
 * whole group when a subscribed resource reports `destroyed`. A destroyed
 * group left in the pool makes the next alpha-masked render throw mid-frame
 * (`this.resources` is null), which presented as "style change → background +
 * shadow render but the screen video, ripples and cursor vanish until the
 * next scrub".
 */
export class BakedTexture {
  private source: ImageSource | null = null;
  private texture: Texture | null = null;

  /** Points the persistent source at `canvas` and re-uploads in place. */
  set(canvas: BakeCanvas): Texture {
    if (!this.source || !this.texture) {
      this.source = new ImageSource({ resource: canvas });
      this.texture = new Texture({ source: this.source });
      return this.texture;
    }
    this.source.resource = canvas;
    // resize() emits 'change' (never a destroy) when dimensions differ;
    // update() re-uploads the swapped resource either way.
    this.source.resize(canvas.width, canvas.height, 1);
    this.source.update();
    return this.texture;
  }

  destroy(): void {
    // Texture wrapper only — never the source, for the pool-poisoning reason
    // above (a pooled mask filter may still hold it; GPU memory goes away
    // with the renderer's GL context, the canvas is GC'd once the pool
    // rebinds a newer source).
    this.texture?.destroy(false);
    this.texture = null;
    this.source = null;
  }
}
