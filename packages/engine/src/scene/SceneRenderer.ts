import './bootstrap.js';
import { Container, ImageSource, Sprite, Texture, autoDetectRenderer } from 'pixi.js';
import type { ICanvas, Renderer } from 'pixi.js';
import type { ProjectFile, RecordingMeta } from '@smoothcut/shared';
import type { CursorTrack } from '../cursor/cursorTrack.js';
import type { ZoomTrack } from '../zoom/zoomTrack.js';
import type { Ripple } from '../cursor/ripples.js';
import { BackgroundNode } from './BackgroundNode.js';
import { CursorNode } from './CursorNode.js';
import { RippleLayer } from './RippleLayer.js';
import { FrameTexture } from './frameTexture.js';
import { fitScreenRect, fitWebcamRect } from './layout.js';
import type { RectPx } from './layout.js';
import { bakeMask, bakeShadow, circlePath, roundedRectPath, squirclePath } from './canvas2d.js';
import type { BakeCanvas } from './canvas2d.js';
import {
  DEFAULT_CURSOR_DATA_URI,
  DEFAULT_CURSOR_HOTSPOT,
  DEFAULT_CURSOR_PIXEL_RATIO,
  DEFAULT_CURSOR_SIZE_PX,
} from './defaultCursor.js';
import type { CursorTextureProvider, FrameSources } from './types.js';

async function loadDefaultCursorTexture(): Promise<Texture> {
  const response = await fetch(DEFAULT_CURSOR_DATA_URI);
  const bitmap = await createImageBitmap(await response.blob());
  return new Texture({ source: new ImageSource({ resource: bitmap }) });
}

/**
 * The composited scene:
 *
 * canvasRoot
 * ├─ BackgroundNode
 * ├─ zoomGroup                (zoom transform; scales the whole screen card)
 * │  ├─ screenShadow          (baked rounded-rect + gaussian falloff sprite)
 * │  ├─ screenContainer       (video sprite, alpha-masked by a baked AA rounded rect)
 * │  ├─ RippleLayer
 * │  └─ CursorNode
 * └─ webcamGroup              (outside the zoom)
 *    ├─ webcamShadow
 *    └─ webcamContainer       (webcam sprite + squircle/circle alpha mask)
 */
export class SceneRenderer {
  private readonly renderer: Renderer;
  private readonly stage: Container;
  private readonly background: BackgroundNode;
  private readonly zoomGroup: Container;
  private readonly screenShadow: Sprite;
  private readonly screenContainer: Container;
  private readonly screenSprite: Sprite;
  private readonly screenMask: Sprite;
  private readonly rippleLayer: RippleLayer;
  private readonly cursorNode: CursorNode;
  private readonly webcamGroup: Container;
  private readonly webcamShadow: Sprite;
  private readonly webcamContainer: Container;
  private readonly webcamSprite: Sprite;
  private readonly webcamMask: Sprite;

  private readonly screenFrame = new FrameTexture();
  private readonly webcamFrame = new FrameTexture();
  private readonly defaultCursorTexture: Texture;
  private bakedTextures: Texture[] = [];

  private cursorProvider: CursorTextureProvider | null = null;
  private cursorTrack: CursorTrack | null = null;
  private zoomTrack: ZoomTrack | null = null;
  private project: ProjectFile | null = null;
  private meta: RecordingMeta | null = null;

  private viewW: number;
  private viewH: number;
  private screenRect: RectPx = { x: 0, y: 0, width: 1, height: 1 };
  private webcamRect: RectPx = { x: 0, y: 0, width: 1, height: 1 };

  static async create(opts: {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    width: number;
    height: number;
  }): Promise<SceneRenderer> {
    const renderer = await autoDetectRenderer({
      preference: 'webgl',
      canvas: opts.canvas as ICanvas,
      width: Math.max(1, opts.width),
      height: Math.max(1, opts.height),
      resolution: 1,
      autoDensity: false,
      antialias: true,
      backgroundColor: 0x101014,
      hello: false,
    });
    const defaultCursor = await loadDefaultCursorTexture();
    return new SceneRenderer(renderer, defaultCursor, opts.width, opts.height);
  }

  private constructor(renderer: Renderer, defaultCursor: Texture, width: number, height: number) {
    this.renderer = renderer;
    this.defaultCursorTexture = defaultCursor;
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);

    this.stage = new Container();
    this.background = new BackgroundNode();
    this.stage.addChild(this.background);

    this.zoomGroup = new Container();
    this.stage.addChild(this.zoomGroup);
    this.screenShadow = new Sprite();
    this.screenShadow.visible = false;
    this.zoomGroup.addChild(this.screenShadow);
    this.screenContainer = new Container();
    this.zoomGroup.addChild(this.screenContainer);
    this.screenSprite = new Sprite();
    this.screenContainer.addChild(this.screenSprite);
    this.screenMask = new Sprite();
    this.screenContainer.addChild(this.screenMask);
    this.screenContainer.mask = this.screenMask;
    this.rippleLayer = new RippleLayer();
    this.zoomGroup.addChild(this.rippleLayer);
    this.cursorNode = new CursorNode();
    this.cursorNode.visible = false;
    this.zoomGroup.addChild(this.cursorNode);

    this.webcamGroup = new Container();
    this.webcamGroup.visible = false;
    this.stage.addChild(this.webcamGroup);
    this.webcamShadow = new Sprite();
    this.webcamShadow.visible = false;
    this.webcamGroup.addChild(this.webcamShadow);
    this.webcamContainer = new Container();
    this.webcamGroup.addChild(this.webcamContainer);
    this.webcamSprite = new Sprite();
    this.webcamContainer.addChild(this.webcamSprite);
    this.webcamMask = new Sprite();
    this.webcamContainer.addChild(this.webcamMask);
    this.webcamContainer.mask = this.webcamMask;
  }

  applyProject(project: ProjectFile, meta: RecordingMeta): void {
    this.project = project;
    this.meta = meta;
    this.rippleLayer.setEnabled(project.cursor.clickRipples);
    this.relayout();
  }

  setTracks(cursor: CursorTrack, zoom: ZoomTrack, ripples: Ripple[]): void {
    this.cursorTrack = cursor;
    this.zoomTrack = zoom;
    this.rippleLayer.setRipples(ripples);
  }

  setCursorTextures(provider: CursorTextureProvider): void {
    this.cursorProvider = provider;
  }

  renderFrame(tSourceSec: number, sources: FrameSources): void {
    const project = this.project;
    const meta = this.meta;
    if (project && meta) {
      const rect = this.screenRect;

      const screenTexture = this.screenFrame.update(sources.screen);
      if (screenTexture) {
        this.screenSprite.texture = screenTexture;
        this.screenSprite.width = rect.width;
        this.screenSprite.height = rect.height;
      }

      const zoom = this.zoomTrack
        ? this.zoomTrack.sample(tSourceSec)
        : { scale: 1, cx: 0.5, cy: 0.5 };
      // Scale about the zoom-center content point, pinning it to the screen
      // rect center. Identity at scale 1 because the track clamps cx,cy to
      // 0.5 there (pivot === position).
      this.zoomGroup.pivot.set(rect.x + zoom.cx * rect.width, rect.y + zoom.cy * rect.height);
      this.zoomGroup.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2);
      this.zoomGroup.scale.set(zoom.scale);

      if (this.cursorTrack) {
        this.cursorNode.visible = true;
        this.updateCursor(tSourceSec, project, meta, rect, zoom.scale);
      } else {
        this.cursorNode.visible = false;
      }

      this.rippleLayer.update(tSourceSec, rect);

      const wantWebcam = !project.style.webcam.hidden && sources.webcam != null;
      this.webcamGroup.visible = wantWebcam;
      if (wantWebcam) {
        const camTexture = this.webcamFrame.update(sources.webcam);
        if (camTexture) this.coverFitWebcam(camTexture);
      }
    }
    this.renderer.render(this.stage);
  }

  resize(width: number, height: number): void {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    this.renderer.resize(this.viewW, this.viewH);
    this.relayout();
  }

  destroy(): void {
    this.screenFrame.destroy();
    this.webcamFrame.destroy();
    this.destroyBaked();
    this.defaultCursorTexture.destroy(true);
    this.stage.destroy({ children: true });
    this.renderer.destroy();
  }

  // ---------------------------------------------------------------- layout

  private relayout(): void {
    const project = this.project;
    const meta = this.meta;
    if (!project || !meta) return;
    const style = project.style;
    const w = this.viewW;
    const h = this.viewH;

    // Style values (cornerRadius, shadow blur/offset) are authored in design
    // canvas px; scale them to the actual render resolution.
    const design =
      style.canvas.preset === 'source'
        ? { width: meta.capture.widthPx, height: meta.capture.heightPx }
        : { width: style.canvas.width, height: style.canvas.height };
    const styleScale = Math.min(w, h) / Math.max(1, Math.min(design.width, design.height));

    this.destroyBaked();
    this.background.apply(style.background, w, h);

    const rect = fitScreenRect(w, h, meta.capture.widthPx, meta.capture.heightPx, style.screen.paddingPct);
    this.screenRect = rect;
    const radiusPx = style.screen.cornerRadius * styleScale;

    this.screenContainer.position.set(rect.x, rect.y);
    this.screenSprite.position.set(0, 0);

    const maskTexture = this.textureFromCanvas(
      bakeMask(rect.width, rect.height, roundedRectPath(radiusPx)),
    );
    this.screenMask.texture = maskTexture;
    this.screenMask.position.set(0, 0);
    this.screenMask.width = rect.width;
    this.screenMask.height = rect.height;

    const screenShadow = bakeShadow(
      rect.width,
      rect.height,
      style.screen.shadow.opacity,
      style.screen.shadow.blurPx * styleScale,
      style.screen.shadow.offsetY * styleScale,
      roundedRectPath(radiusPx),
    );
    if (screenShadow) {
      this.screenShadow.texture = this.textureFromCanvas(screenShadow.canvas);
      this.screenShadow.position.set(rect.x - screenShadow.margin, rect.y - screenShadow.margin);
      this.screenShadow.width = rect.width + screenShadow.margin * 2;
      this.screenShadow.height = rect.height + screenShadow.margin * 2;
      this.screenShadow.visible = true;
    } else {
      this.screenShadow.visible = false;
    }

    const cam = fitWebcamRect(w, h, style.webcam.layout, style.webcam.sizePct);
    this.webcamRect = cam;
    const camPath = style.webcam.cornerStyle === 'squircle' ? squirclePath() : circlePath();

    this.webcamContainer.position.set(cam.x, cam.y);
    this.webcamMask.texture = this.textureFromCanvas(bakeMask(cam.width, cam.height, camPath));
    this.webcamMask.position.set(0, 0);
    this.webcamMask.width = cam.width;
    this.webcamMask.height = cam.height;

    const camShadow = bakeShadow(
      cam.width,
      cam.height,
      style.webcam.shadow.opacity,
      style.webcam.shadow.blurPx * styleScale,
      style.webcam.shadow.offsetY * styleScale,
      camPath,
    );
    if (camShadow) {
      this.webcamShadow.texture = this.textureFromCanvas(camShadow.canvas);
      this.webcamShadow.position.set(cam.x - camShadow.margin, cam.y - camShadow.margin);
      this.webcamShadow.width = cam.width + camShadow.margin * 2;
      this.webcamShadow.height = cam.height + camShadow.margin * 2;
      this.webcamShadow.visible = true;
    } else {
      this.webcamShadow.visible = false;
    }
  }

  // --------------------------------------------------------------- cursor

  private updateCursor(
    tSec: number,
    project: ProjectFile,
    meta: RecordingMeta,
    rect: RectPx,
    zoomScale: number,
  ): void {
    const track = this.cursorTrack!;
    const sample = track.sample(tSec);

    let texture = this.defaultCursorTexture;
    if (sample.shapeId && this.cursorProvider) {
      const provided = this.cursorProvider.get(sample.shapeId);
      if (provided instanceof Texture) texture = provided;
    }
    const usingDefault = texture === this.defaultCursorTexture;

    // Recorded cursor images are in capture-physical px; the built-in arrow
    // is 20x28 logical points rendered at 2x.
    const fitRatio = rect.width / Math.max(1, meta.capture.widthPx);
    const base =
      !usingDefault && sample.sizePx
        ? sample.sizePx
        : {
            w: (DEFAULT_CURSOR_SIZE_PX.w / DEFAULT_CURSOR_PIXEL_RATIO) * meta.capture.scaleFactor,
            h: (DEFAULT_CURSOR_SIZE_PX.h / DEFAULT_CURSOR_PIXEL_RATIO) * meta.capture.scaleFactor,
          };
    const hotspot =
      !usingDefault && sample.hotspot && sample.sizePx
        ? { x: sample.hotspot.x / sample.sizePx.w, y: sample.hotspot.y / sample.sizePx.h }
        : {
            x: DEFAULT_CURSOR_HOTSPOT.x / DEFAULT_CURSOR_SIZE_PX.w,
            y: DEFAULT_CURSOR_HOTSPOT.y / DEFAULT_CURSOR_SIZE_PX.h,
          };
    const sizeMul = fitRatio * project.cursor.size;

    // Finite difference over 1/60s for the blur direction; scale by the zoom
    // so blur length matches rendered motion.
    const dtSec = 1 / 60;
    const prev = track.sample(Math.max(0, tSec - dtSec));
    const velocityXPx = (sample.x - prev.x) * rect.width * zoomScale;
    const velocityYPx = (sample.y - prev.y) * rect.height * zoomScale;

    this.cursorNode.update({
      texture,
      xPx: rect.x + sample.x * rect.width,
      yPx: rect.y + sample.y * rect.height,
      anchorX: hotspot.x,
      anchorY: hotspot.y,
      widthPx: base.w * sizeMul,
      heightPx: base.h * sizeMul,
      velocityXPx,
      velocityYPx,
      motionBlur: project.cursor.motionBlur,
    });
  }

  // --------------------------------------------------------------- webcam

  private coverFitWebcam(texture: Texture): void {
    const cam = this.webcamRect;
    const srcW = Math.max(1, texture.source.pixelWidth);
    const srcH = Math.max(1, texture.source.pixelHeight);
    const cover = Math.max(cam.width / srcW, cam.height / srcH);
    const w = srcW * cover;
    const h = srcH * cover;
    this.webcamSprite.texture = texture;
    this.webcamSprite.width = w;
    this.webcamSprite.height = h;
    this.webcamSprite.position.set((cam.width - w) / 2, (cam.height - h) / 2);
  }

  // ---------------------------------------------------------------- bakes

  private textureFromCanvas(canvas: BakeCanvas): Texture {
    const texture = new Texture({ source: new ImageSource({ resource: canvas }) });
    this.bakedTextures.push(texture);
    return texture;
  }

  private destroyBaked(): void {
    for (const t of this.bakedTextures) t.destroy(true);
    this.bakedTextures = [];
  }
}
