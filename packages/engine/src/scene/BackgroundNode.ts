import { Assets, Container, ImageSource, Sprite, Texture } from 'pixi.js';
import type { BackgroundStyle } from '@smoothcut/shared';
import {
  GRADIENT_PRESETS,
  createCanvas,
  drawLinearGradient,
  parseGradient,
} from './canvas2d.js';
import type { BakeCanvas, Baked } from './canvas2d.js';

/** Backgrounds are baked at most this large — they are smooth, so upscaling is invisible. */
const BAKE_MAX_DIM = 1024;

const FALLBACK_GRADIENT = GRADIENT_PRESETS['graphite']!;

export class BackgroundNode extends Container {
  private readonly sprite: Sprite;
  private texture: Texture | null = null;
  private canvasW = 1;
  private canvasH = 1;
  /** Guards against a stale async image bake landing after a newer apply(). */
  private generation = 0;
  /** Bundled wallpaper id → asset URL, registered by the host. */
  private wallpaperUrls: Record<string, string> = {};
  /** In-flight async bake (image/wallpaper); null when the bake was sync. */
  private pending: Promise<void> | null = null;
  /** Fired when an async bake lands, so paused hosts can re-render. */
  onAsyncBake: (() => void) | null = null;

  constructor() {
    super();
    this.sprite = new Sprite();
    this.addChild(this.sprite);
  }

  setWallpaperUrls(urls: Record<string, string>): void {
    this.wallpaperUrls = urls;
  }

  /**
   * Resolves once the current background is fully baked (immediately for
   * solid/gradient). Never rejects — load failures fall back gracefully.
   */
  waitForLoad(): Promise<void> {
    return this.pending ?? Promise.resolve();
  }

  apply(style: BackgroundStyle, canvasW: number, canvasH: number): void {
    this.canvasW = Math.max(1, canvasW);
    this.canvasH = Math.max(1, canvasH);
    const gen = ++this.generation;

    if (style.kind === 'image') {
      this.pending = this.bakeImage(style.value, style.blur, gen, false);
      return;
    }
    if (style.kind === 'wallpaper') {
      const url = this.wallpaperUrls[style.value];
      if (url !== undefined) {
        this.pending = this.bakeImage(url, style.blur, gen, true);
        return;
      }
      // Unknown wallpaper id → graphite gradient fallback below.
    }

    this.pending = null;
    const baked = this.createBakeCanvas();
    if (style.kind === 'solid') {
      baked.ctx.fillStyle = style.value;
      baked.ctx.fillRect(0, 0, baked.width, baked.height);
    } else {
      const spec =
        style.kind === 'gradient' ? (parseGradient(style.value) ?? FALLBACK_GRADIENT) : FALLBACK_GRADIENT;
      drawLinearGradient(baked.ctx, baked.width, baked.height, spec);
    }
    this.setBaked(this.blurred(baked.canvas, this.toBakePx(style.blur, baked.width)), gen);
  }

  private createBakeCanvas(): Baked {
    const scale = Math.min(1, BAKE_MAX_DIM / Math.max(this.canvasW, this.canvasH));
    return createCanvas(this.canvasW * scale, this.canvasH * scale);
  }

  private toBakePx(blur: number, bakeW: number): number {
    return blur * (bakeW / this.canvasW);
  }

  private blurred(canvas: BakeCanvas, blurPx: number): BakeCanvas {
    if (blurPx <= 0) return canvas;
    const { canvas: out, ctx, width, height } = createCanvas(canvas.width, canvas.height);
    ctx.filter = `blur(${blurPx}px)`;
    // Overscan so the blur does not bleed transparency in from the edges.
    const o = Math.ceil(blurPx * 2);
    ctx.drawImage(canvas as CanvasImageSource, -o, -o, width + o * 2, height + o * 2);
    ctx.filter = 'none';
    return out;
  }

  private async bakeImage(
    url: string,
    blur: number,
    gen: number,
    fallbackOnError: boolean,
  ): Promise<void> {
    try {
      const loaded = await Assets.load<Texture>(url);
      if (gen !== this.generation) return;
      const baked = this.createBakeCanvas();
      const { ctx, width, height } = baked;
      const src = loaded.source.resource as CanvasImageSource;
      const srcW = Math.max(1, loaded.source.pixelWidth);
      const srcH = Math.max(1, loaded.source.pixelHeight);
      const cover = Math.max(width / srcW, height / srcH);
      const blurPx = this.toBakePx(blur, width);
      if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
      const o = blurPx > 0 ? Math.ceil(blurPx * 2) : 0;
      const dw = srcW * cover + o * 2;
      const dh = srcH * cover + o * 2;
      ctx.drawImage(src, (width - dw) / 2, (height - dh) / 2, dw, dh);
      ctx.filter = 'none';
      this.setBaked(baked.canvas, gen);
      this.onAsyncBake?.();
    } catch (err) {
      // Never silent: a swallowed bake error looks like a "random" background
      // switch to the graphite fallback with no trail to follow.
      console.warn(`background bake failed for ${url}:`, err);
      if (gen !== this.generation) return;
      if (fallbackOnError) {
        // Unloadable wallpaper asset: bake the graphite fallback so exports
        // never compose over an unstyled clear color.
        const baked = this.createBakeCanvas();
        drawLinearGradient(baked.ctx, baked.width, baked.height, FALLBACK_GRADIENT);
        this.setBaked(baked.canvas, gen);
        this.onAsyncBake?.();
      }
      // Missing/unreadable user image: keep whatever background is shown.
    }
  }

  private setBaked(canvas: BakeCanvas, gen: number): void {
    if (gen !== this.generation) return;
    const next = new Texture({ source: new ImageSource({ resource: canvas }) });
    this.sprite.texture = next;
    this.sprite.width = this.canvasW;
    this.sprite.height = this.canvasH;
    this.texture?.destroy(true);
    this.texture = next;
  }

  override destroy(): void {
    this.generation++;
    super.destroy({ children: true });
    this.texture?.destroy(true);
    this.texture = null;
  }
}
