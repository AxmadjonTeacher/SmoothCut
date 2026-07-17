/**
 * Resolve a CaptureSource against the current source listing into the spaces
 * the session needs:
 * - captureRectPt: global LOGICAL POINTS — the rect the capture occupies in
 *   the OS point space (used for window placement math);
 * - captureRectInput: the same rect expressed in THE INPUT HOOK'S coordinate
 *   space — what InputLogger normalizes uiohook events against. On darwin
 *   uiohook reports global logical points (identical to captureRectPt); on
 *   win32 it reports PHYSICAL px in virtual-desktop coordinates, so the rect
 *   is scaled by the display's scaleFactor (see native-win/INTEGRATION.md §4);
 * - widthPx/heightPx: PHYSICAL pixels of the encoded video (meta.capture).
 */
import type { CaptureSource, DisplayInfo, WindowInfo } from '@smoothcut/shared';
import type { CaptureRectPt } from '../input/mapping.js';

export interface CaptureGeometry {
  display: DisplayInfo;
  captureRectPt: CaptureRectPt;
  /** Capture rect in the platform input hook's coordinate space. */
  captureRectInput: CaptureRectPt;
  widthPx: number;
  heightPx: number;
}

export function resolveCaptureGeometry(
  source: CaptureSource,
  sources: { displays: DisplayInfo[]; windows: WindowInfo[] },
  platform: NodeJS.Platform = process.platform,
): CaptureGeometry {
  const display = sources.displays.find((d) => d.id === source.displayId);
  if (!display) throw new Error('source-not-found');
  const scale = display.scaleFactor;
  const b = display.bounds;
  const win32 = platform === 'win32';

  switch (source.kind) {
    case 'display': {
      const captureRectPt = { xPt: b.x, yPt: b.y, widthPt: b.width, heightPt: b.height };
      return {
        display,
        captureRectPt,
        captureRectInput: win32
          ? { xPt: b.x * scale, yPt: b.y * scale, widthPt: b.width * scale, heightPt: b.height * scale }
          : captureRectPt,
        widthPx: Math.round(b.width * scale),
        heightPx: Math.round(b.height * scale),
      };
    }
    case 'area': {
      // source.rect is physical px relative to the display's top-left.
      const r = source.rect;
      const captureRectPt = {
        xPt: b.x + r.x / scale,
        yPt: b.y + r.y / scale,
        widthPt: r.width / scale,
        heightPt: r.height / scale,
      };
      return {
        display,
        captureRectPt,
        captureRectInput: win32
          ? { xPt: b.x * scale + r.x, yPt: b.y * scale + r.y, widthPt: r.width, heightPt: r.height }
          : captureRectPt,
        widthPx: Math.round(r.width),
        heightPx: Math.round(r.height),
      };
    }
    case 'window': {
      const win = sources.windows.find((w) => w.id === source.windowId);
      if (!win) throw new Error('source-not-found');
      const wb = win.bounds;
      const captureRectPt = { xPt: wb.x, yPt: wb.y, widthPt: wb.width, heightPt: wb.height };
      return {
        display,
        captureRectPt,
        captureRectInput: win32
          ? {
              xPt: wb.x * scale,
              yPt: wb.y * scale,
              widthPt: wb.width * scale,
              heightPt: wb.height * scale,
            }
          : captureRectPt,
        widthPx: Math.round(wb.width * scale),
        heightPx: Math.round(wb.height * scale),
      };
    }
  }
}
