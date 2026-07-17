import { ImageSource, Texture } from 'pixi.js';
import type { ImageResource } from 'pixi.js';

/**
 * Wraps a live frame resource (HTMLVideoElement, VideoFrame, ImageBitmap,
 * canvas). Same resource identity → re-upload in place; new identity (e.g. a
 * fresh VideoFrame every frame) → rebuild the texture.
 */
export class FrameTexture {
  private resource: unknown = null;
  private current: Texture | null = null;

  update(resource: unknown): Texture | null {
    if (resource == null) return null;
    // A <video> must have a decodable current frame (HAVE_CURRENT_DATA)
    // before the first GL upload: uploading earlier fails without defining
    // the texture storage, and pixi then records the size as uploaded so
    // every later texSubImage2D hits GL_INVALID_OPERATION forever. Report
    // "no frame yet" — the host re-renders on 'loadeddata'.
    if (
      typeof HTMLVideoElement !== 'undefined' &&
      resource instanceof HTMLVideoElement &&
      (resource.videoWidth === 0 || resource.readyState < 2)
    ) {
      return null;
    }
    if (resource === this.resource && this.current) {
      this.current.source.update();
      return this.current;
    }
    this.destroy();
    this.resource = resource;
    const source = new ImageSource({ resource: resource as ImageResource });
    this.current = new Texture({ source });
    return this.current;
  }

  destroy(): void {
    // Destroying the source releases GPU memory; the resource itself (video
    // element / VideoFrame) stays owned by the caller.
    this.current?.destroy(true);
    this.current = null;
    this.resource = null;
  }
}
