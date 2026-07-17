import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { MotionBlurFilter } from 'pixi-filters';

export interface CursorNodeUpdate {
  texture: Texture;
  /** Canvas px, pre-zoom (the node lives inside zoomGroup). */
  xPx: number;
  yPx: number;
  /** Hotspot as a fraction of the texture. */
  anchorX: number;
  anchorY: number;
  widthPx: number;
  heightPx: number;
  /** Rendered px moved per 1/60s, for the motion-blur vector. */
  velocityXPx: number;
  velocityYPx: number;
  motionBlur: boolean;
}

const BLUR_MIN_SPEED_PX = 2;
const BLUR_MAX_PX = 32;

export class CursorNode extends Container {
  private readonly sprite: Sprite;
  private readonly motionBlur: MotionBlurFilter;
  private blurActive = false;

  constructor() {
    super();
    this.sprite = new Sprite();
    this.addChild(this.sprite);
    this.motionBlur = new MotionBlurFilter({ kernelSize: 9 });
  }

  update(u: CursorNodeUpdate): void {
    const s = this.sprite;
    if (s.texture !== u.texture) s.texture = u.texture;
    s.anchor.set(u.anchorX, u.anchorY);
    s.position.set(u.xPx, u.yPx);
    s.width = u.widthPx;
    s.height = u.heightPx;

    const speed = Math.hypot(u.velocityXPx, u.velocityYPx);
    const wantBlur = u.motionBlur && speed > BLUR_MIN_SPEED_PX;
    if (wantBlur) {
      const damp = speed > BLUR_MAX_PX ? BLUR_MAX_PX / speed : 1;
      this.motionBlur.velocityX = u.velocityXPx * damp;
      this.motionBlur.velocityY = u.velocityYPx * damp;
    }
    if (wantBlur !== this.blurActive) {
      this.blurActive = wantBlur;
      s.filters = wantBlur ? [this.motionBlur] : [];
    }
  }
}
