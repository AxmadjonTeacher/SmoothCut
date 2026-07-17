import type { WebcamLayout } from '@smoothcut/shared';

/** Canvas-space rectangle, in output pixels. */
export interface RectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fits the screen content into the canvas minus padding (paddingPct is a
 * fraction of the shorter canvas edge), preserving aspect, centered.
 */
export function fitScreenRect(
  canvasW: number,
  canvasH: number,
  contentW: number,
  contentH: number,
  paddingPct: number,
): RectPx {
  const pad = paddingPct * Math.min(canvasW, canvasH);
  const availW = Math.max(1, canvasW - pad * 2);
  const availH = Math.max(1, canvasH - pad * 2);
  const scale = Math.min(availW / Math.max(1, contentW), availH / Math.max(1, contentH));
  const width = contentW * scale;
  const height = contentH * scale;
  return { x: (canvasW - width) / 2, y: (canvasH - height) / 2, width, height };
}

/**
 * Webcam placement: bubbles sit in a corner with a margin; pinned layouts hug
 * the left/right edge at vertical center. The webcam is square, sized as
 * sizePct of the canvas height.
 */
export function fitWebcamRect(
  canvasW: number,
  canvasH: number,
  layout: WebcamLayout,
  sizePct: number,
): RectPx {
  const size = sizePct * canvasH;
  const margin = 0.035 * Math.min(canvasW, canvasH);
  switch (layout) {
    case 'bubble-bl':
      return { x: margin, y: canvasH - margin - size, width: size, height: size };
    case 'bubble-br':
      return { x: canvasW - margin - size, y: canvasH - margin - size, width: size, height: size };
    case 'bubble-tl':
      return { x: margin, y: margin, width: size, height: size };
    case 'bubble-tr':
      return { x: canvasW - margin - size, y: margin, width: size, height: size };
    case 'pinned-left':
      return { x: margin, y: (canvasH - size) / 2, width: size, height: size };
    case 'pinned-right':
      return { x: canvasW - margin - size, y: (canvasH - size) / 2, width: size, height: size };
  }
}
