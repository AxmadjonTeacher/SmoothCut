/**
 * Per-frame media inputs. `screen`/`webcam` accept whatever the host has on
 * hand: HTMLVideoElement, VideoFrame, ImageBitmap, OffscreenCanvas or
 * HTMLCanvasElement.
 */
export interface FrameSources {
  screen: unknown;
  webcam?: unknown;
}

/**
 * Host-supplied Pixi Textures for `cursors/<shapeId>.png`. Returning
 * null/undefined (or a non-Texture) falls back to the built-in arrow.
 */
export interface CursorTextureProvider {
  get(shapeId: string): unknown | null;
}
