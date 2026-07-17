import type { WebcamLayout } from '@smoothcut/shared';

/** Canvas-space rectangle, in output pixels. */
export interface RectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Corner/edge margin shared by webcam layouts, px. */
function layoutMargin(canvasW: number, canvasH: number): number {
  return 0.035 * Math.min(canvasW, canvasH);
}

/** Right-column width for the 'split-right' layout, as a fraction of canvas width. */
const SPLIT_COLUMN_PCT = 0.3;

/** Corner radius of the split-view webcam card, as a fraction of its width. */
export const SPLIT_WEBCAM_RADIUS_PCT = 0.08;

/** Column geometry (x/width plus the shared margin) for 'split-right'. */
function splitRightColumn(
  canvasW: number,
  canvasH: number,
): { x: number; width: number; margin: number } {
  const margin = layoutMargin(canvasW, canvasH);
  const width = Math.max(1, SPLIT_COLUMN_PCT * canvasW - margin);
  return { x: canvasW - margin - width, width, margin };
}

/**
 * Fits the screen content into the canvas minus padding (paddingPct is a
 * fraction of the shorter canvas edge), preserving aspect, centered. When the
 * webcam uses the 'split-right' layout, the right column is reserved first and
 * the screen centers in the remaining left region.
 */
export function fitScreenRect(
  canvasW: number,
  canvasH: number,
  contentW: number,
  contentH: number,
  paddingPct: number,
  webcamLayout?: WebcamLayout,
): RectPx {
  const pad = paddingPct * Math.min(canvasW, canvasH);
  if (webcamLayout !== 'split-right') {
    const availW = Math.max(1, canvasW - pad * 2);
    const availH = Math.max(1, canvasH - pad * 2);
    const scale = Math.min(availW / Math.max(1, contentW), availH / Math.max(1, contentH));
    const width = contentW * scale;
    const height = contentH * scale;
    return { x: (canvasW - width) / 2, y: (canvasH - height) / 2, width, height };
  }
  // Split view: keep at least the column margin between the screen card and
  // both the canvas edges and the webcam column, then honor paddingPct on top.
  const col = splitRightColumn(canvasW, canvasH);
  const inset = Math.max(pad, col.margin);
  const left = inset;
  const right = col.x - inset;
  const top = inset;
  const bottom = canvasH - inset;
  const availW = Math.max(1, right - left);
  const availH = Math.max(1, bottom - top);
  const scale = Math.min(availW / Math.max(1, contentW), availH / Math.max(1, contentH));
  const width = contentW * scale;
  const height = contentH * scale;
  return { x: left + (availW - width) / 2, y: top + (availH - height) / 2, width, height };
}

export type WebcamShape = 'squircle' | 'circle' | 'rect';

/** Portrait rounded-rect webcam: width as a fraction of its height. */
const WEBCAM_RECT_ASPECT = 0.72;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Webcam placement: bubbles sit in a corner with a margin; pinned layouts hug
 * the left/right edge at vertical center. Height is sizePct of the canvas
 * height; squircle/circle are square, 'rect' is a portrait rounded rect.
 * 'custom' uses bubble sizing centered on `position` (canvas unit coords,
 * clamped fully on-canvas); 'split-right' fills the reserved right column.
 */
export function fitWebcamRect(
  canvasW: number,
  canvasH: number,
  layout: WebcamLayout,
  sizePct: number,
  shape: WebcamShape = 'squircle',
  position?: { x: number; y: number },
): RectPx {
  const height = sizePct * canvasH;
  const width = shape === 'rect' ? height * WEBCAM_RECT_ASPECT : height;
  const margin = layoutMargin(canvasW, canvasH);
  switch (layout) {
    case 'bubble-bl':
      return { x: margin, y: canvasH - margin - height, width, height };
    case 'bubble-br':
      return { x: canvasW - margin - width, y: canvasH - margin - height, width, height };
    case 'bubble-tl':
      return { x: margin, y: margin, width, height };
    case 'bubble-tr':
      return { x: canvasW - margin - width, y: margin, width, height };
    case 'pinned-left':
      return { x: margin, y: (canvasH - height) / 2, width, height };
    case 'pinned-right':
      return { x: canvasW - margin - width, y: (canvasH - height) / 2, width, height };
    case 'custom': {
      const cx = (position?.x ?? 0.5) * canvasW;
      const cy = (position?.y ?? 0.5) * canvasH;
      return {
        x: clamp(cx - width / 2, 0, Math.max(0, canvasW - width)),
        y: clamp(cy - height / 2, 0, Math.max(0, canvasH - height)),
        width,
        height,
      };
    }
    case 'split-right': {
      const col = splitRightColumn(canvasW, canvasH);
      return {
        x: col.x,
        y: col.margin,
        width: col.width,
        height: Math.max(1, canvasH - col.margin * 2),
      };
    }
  }
}
