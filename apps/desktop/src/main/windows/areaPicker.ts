/**
 * Area-capture picker: opens one full-screen transparent overlay window on the
 * target display; the renderer (AreaPickerRoot) reports the drag result over
 * the 'area:picked' invoke channel in LOGICAL points relative to that display
 * (CSS px of the fullscreen overlay). This module converts to PHYSICAL px via
 * the display's scaleFactor — the space `CaptureSource` area rects live in —
 * flooring dimensions to even values (H.264 requires even dims).
 */
import type { BrowserWindow } from 'electron';
import type { DisplayInfo, Rect } from '@smoothcut/shared';
import { listSources } from '../sources.js';
import { createAreaPickerWindow } from './factory.js';

interface PendingPick {
  win: BrowserWindow;
  resolve: (rect: Rect | null) => void;
}

let pending: PendingPick | undefined;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Display-relative logical points → display-relative physical px, even dims. */
export function toPhysicalEvenRect(rectPt: Rect, display: DisplayInfo): Rect | null {
  const s = display.scaleFactor;
  const displayW = Math.round(display.bounds.width * s);
  const displayH = Math.round(display.bounds.height * s);
  let width = Math.round(rectPt.width * s);
  let height = Math.round(rectPt.height * s);
  width = Math.min(width - (width % 2), displayW - (displayW % 2));
  height = Math.min(height - (height % 2), displayH - (displayH % 2));
  if (width < 2 || height < 2) return null;
  const x = clamp(Math.round(rectPt.x * s), 0, displayW - width);
  const y = clamp(Math.round(rectPt.y * s), 0, displayH - height);
  return { x, y, width, height };
}

/**
 * Open the drag-select overlay on `displayId`. Resolves with the picked rect
 * in physical px relative to the display, or null (cancelled / display gone /
 * a pick is already in progress).
 */
export async function pickArea(displayId: string): Promise<Rect | null> {
  if (pending) {
    pending.win.focus();
    return null;
  }
  const { displays } = await listSources();
  const display = displays.find((d) => d.id === displayId);
  if (!display) return null;

  const win = createAreaPickerWindow(displayId, display.bounds);
  return new Promise<Rect | null>((resolve) => {
    pending = {
      win,
      resolve: (rectPt) => {
        resolve(rectPt ? toPhysicalEvenRect(rectPt, display) : null);
      },
    };
    // Closing the window by any other means (Cmd+W, crash) counts as cancel.
    win.on('closed', () => {
      if (pending?.win === win) {
        pending = undefined;
        resolve(null);
      }
    });
  });
}

/** IPC entry point for the overlay renderer ('area:picked'). */
export function resolveAreaPick(rectPt: Rect | null): void {
  const current = pending;
  if (!current) return;
  pending = undefined;
  current.resolve(rectPt);
  if (!current.win.isDestroyed()) current.win.destroy();
}
