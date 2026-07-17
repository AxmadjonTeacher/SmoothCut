export type { FrameSources, CursorTextureProvider } from './types.js';
export { SceneRenderer } from './SceneRenderer.js';
export { BackgroundNode } from './BackgroundNode.js';
export { CursorNode } from './CursorNode.js';
export type { CursorNodeUpdate } from './CursorNode.js';
export { RippleLayer, RIPPLE_DURATION_SEC } from './RippleLayer.js';
export { FrameTexture } from './frameTexture.js';
export { fitScreenRect, fitWebcamRect } from './layout.js';
export type { RectPx, WebcamShape } from './layout.js';
export { BakedTexture } from './bakedTexture.js';
export {
  GRADIENT_PRESETS,
  parseGradient,
  drawLinearGradient,
  createCanvas,
  bakeMask,
  bakeShadow,
  roundedRectPath,
  circlePath,
  squirclePath,
} from './canvas2d.js';
export type { GradientSpec, GradientStop, BakeCanvas, BakeContext, PathBuilder } from './canvas2d.js';
export {
  DEFAULT_CURSOR_DATA_URI,
  DEFAULT_CURSOR_HOTSPOT,
  DEFAULT_CURSOR_SIZE_PX,
  DEFAULT_CURSOR_PIXEL_RATIO,
} from './defaultCursor.js';
