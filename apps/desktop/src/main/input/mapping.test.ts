import { describe, expect, it } from 'vitest';
import { mapUiohookButton, mapWheelDelta, toUnitCoords } from './mapping.js';

describe('toUnitCoords', () => {
  const rect = { xPt: 100, yPt: 50, widthPt: 800, heightPt: 600 };

  it('maps rect corners to 0..1', () => {
    expect(toUnitCoords(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(toUnitCoords(900, 650, rect)).toEqual({ x: 1, y: 1 });
    expect(toUnitCoords(500, 350, rect)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('lets coords exceed 0..1 when the pointer leaves the rect', () => {
    expect(toUnitCoords(0, 0, rect)).toEqual({ x: -0.125, y: -50 / 600 });
    expect(toUnitCoords(1000, 700, rect).x).toBeGreaterThan(1);
  });

  // win32: uiohook reports PHYSICAL px in virtual-desktop coordinates, so the
  // rect is a physical-px rect (geometry.captureRectInput) — the math is the
  // same, including negative origins for monitors left of/above the primary.
  it('win32 physical-px rect with a negative virtual-desktop origin', () => {
    const monitorPx = { xPt: -1600, yPt: 0, widthPt: 1600, heightPt: 1000 };
    expect(toUnitCoords(-1600, 0, monitorPx)).toEqual({ x: 0, y: 0 });
    expect(toUnitCoords(0, 1000, monitorPx)).toEqual({ x: 1, y: 1 });
    expect(toUnitCoords(-800, 500, monitorPx)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('win32 area rect offset inside a scaled monitor', () => {
    // 1280x800pt monitor at scale 1.25 → 1600x1000px; area at px (100,60) 640x360.
    const areaPx = { xPt: -1500, yPt: 60, widthPt: 640, heightPt: 360 };
    expect(toUnitCoords(-1500, 60, areaPx)).toEqual({ x: 0, y: 0 });
    expect(toUnitCoords(-1180, 240, areaPx)).toEqual({ x: 0.5, y: 0.5 });
    expect(toUnitCoords(-860, 420, areaPx)).toEqual({ x: 1, y: 1 });
  });
});

describe('mapUiohookButton', () => {
  it('maps libuiohook 1/2/3 to web 0/2/1', () => {
    expect(mapUiohookButton(1)).toBe(0);
    expect(mapUiohookButton(2)).toBe(2);
    expect(mapUiohookButton(3)).toBe(1);
  });

  it('drops unknown buttons', () => {
    expect(mapUiohookButton(4)).toBeNull();
    expect(mapUiohookButton(undefined)).toBeNull();
  });
});

describe('mapWheelDelta', () => {
  it('routes vertical rotation to dy', () => {
    expect(mapWheelDelta(3, -1, 3)).toEqual({ dx: 0, dy: -3 });
  });

  it('routes horizontal rotation to dx', () => {
    expect(mapWheelDelta(4, 2, 1)).toEqual({ dx: 2, dy: 0 });
  });
});
