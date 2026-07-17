/**
 * Pure coordinate/event mapping for the input logger (no electron/uiohook
 * imports so it stays unit-testable).
 *
 * Coordinate spaces: on darwin uiohook reports GLOBAL LOGICAL POINTS.
 * events.jsonl wants UNIT coords (0..1) of the capture rect; values may fall
 * outside 0..1 when the pointer leaves the rect — written as-is, consumers
 * clamp.
 */
import type { MouseButton } from '@smoothcut/shared';

/** Capture rect in global logical points. */
export interface CaptureRectPt {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}

export function toUnitCoords(
  globalXPt: number,
  globalYPt: number,
  rect: CaptureRectPt,
): { x: number; y: number } {
  return {
    x: (globalXPt - rect.xPt) / rect.widthPt,
    y: (globalYPt - rect.yPt) / rect.heightPt,
  };
}

/**
 * libuiohook buttons: 1 = left, 2 = right, 3 = middle. Shared MouseButton
 * follows the web convention: 0 = left, 1 = middle, 2 = right. Buttons 4/5
 * (back/forward) have no representation and are dropped.
 */
export function mapUiohookButton(button: unknown): MouseButton | null {
  switch (button) {
    case 1:
      return 0;
    case 2:
      return 2;
    case 3:
      return 1;
    default:
      return null;
  }
}

/** uiohook WheelDirection: 3 = vertical, 4 = horizontal. */
export function mapWheelDelta(
  direction: number,
  rotation: number,
  amount: number,
): { dx: number; dy: number } {
  const delta = rotation * amount;
  return direction === 4 ? { dx: delta, dy: 0 } : { dx: 0, dy: delta };
}
