import { describe, expect, it } from 'vitest';
import { resolveCaptureGeometry } from './geometry.js';
import type { DisplayInfo, WindowInfo } from '@smoothcut/shared';

const retina: DisplayInfo = {
  id: 'd1',
  label: 'Built-in',
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  scaleFactor: 2,
  isPrimary: true,
};
const external: DisplayInfo = {
  id: 'd2',
  label: 'External',
  bounds: { x: 1512, y: -200, width: 2560, height: 1440 },
  scaleFactor: 1,
  isPrimary: false,
};
const win: WindowInfo = {
  id: 'w1',
  title: 'Doc',
  appName: 'App',
  displayId: 'd1',
  bounds: { x: 100, y: 80, width: 900, height: 600 },
};
const sources = { displays: [retina, external], windows: [win] };

describe('resolveCaptureGeometry (darwin)', () => {
  it('display capture: full bounds in points, physical px via scale', () => {
    const g = resolveCaptureGeometry({ kind: 'display', displayId: 'd1' }, sources, 'darwin');
    expect(g.captureRectPt).toEqual({ xPt: 0, yPt: 0, widthPt: 1512, heightPt: 982 });
    expect(g.widthPx).toBe(3024);
    expect(g.heightPx).toBe(1964);
  });

  it('area capture: physical crop rect mapped to global points', () => {
    const g = resolveCaptureGeometry(
      { kind: 'area', displayId: 'd1', rect: { x: 200, y: 100, width: 1280, height: 720 } },
      sources,
      'darwin',
    );
    expect(g.captureRectPt).toEqual({ xPt: 100, yPt: 50, widthPt: 640, heightPt: 360 });
    expect(g.widthPx).toBe(1280);
    expect(g.heightPx).toBe(720);
  });

  it('area capture on a non-origin display offsets by the display origin', () => {
    const g = resolveCaptureGeometry(
      { kind: 'area', displayId: 'd2', rect: { x: 10, y: 20, width: 100, height: 50 } },
      sources,
      'darwin',
    );
    expect(g.captureRectPt).toEqual({ xPt: 1522, yPt: -180, widthPt: 100, heightPt: 50 });
  });

  it('window capture: window bounds in points, px via display scale', () => {
    const g = resolveCaptureGeometry(
      { kind: 'window', windowId: 'w1', displayId: 'd1' },
      sources,
      'darwin',
    );
    expect(g.captureRectPt).toEqual({ xPt: 100, yPt: 80, widthPt: 900, heightPt: 600 });
    expect(g.widthPx).toBe(1800);
    expect(g.heightPx).toBe(1200);
  });

  it('input-hook rect is the point rect (uiohook reports points on darwin)', () => {
    for (const source of [
      { kind: 'display', displayId: 'd1' } as const,
      { kind: 'area', displayId: 'd1', rect: { x: 200, y: 100, width: 1280, height: 720 } } as const,
      { kind: 'window', windowId: 'w1', displayId: 'd1' } as const,
    ]) {
      const g = resolveCaptureGeometry(source, sources, 'darwin');
      expect(g.captureRectInput).toEqual(g.captureRectPt);
    }
  });

  it('throws for unknown sources', () => {
    expect(() =>
      resolveCaptureGeometry({ kind: 'display', displayId: 'nope' }, sources, 'darwin'),
    ).toThrow('source-not-found');
    expect(() =>
      resolveCaptureGeometry({ kind: 'window', windowId: 'nope', displayId: 'd1' }, sources, 'darwin'),
    ).toThrow('source-not-found');
  });
});

describe('resolveCaptureGeometry (win32: input hook reports physical px)', () => {
  // Mirrors native-win/INTEGRATION.md §4: monitor "points" are exact divisions
  // of physical px, and uiohook reports physical virtual-desktop px.
  const leftMonitor: DisplayInfo = {
    id: 'm1',
    label: 'Left',
    bounds: { x: -1280, y: 0, width: 1280, height: 800 },
    scaleFactor: 1.25,
    isPrimary: false,
  };
  const winSources = {
    displays: [retina, external, leftMonitor],
    windows: [win],
  };

  it('display capture: input rect = bounds * scale', () => {
    const g = resolveCaptureGeometry({ kind: 'display', displayId: 'd1' }, winSources, 'win32');
    expect(g.captureRectInput).toEqual({ xPt: 0, yPt: 0, widthPt: 3024, heightPt: 1964 });
    // Point-space rect and physical output dims are platform-independent.
    expect(g.captureRectPt).toEqual({ xPt: 0, yPt: 0, widthPt: 1512, heightPt: 982 });
    expect(g.widthPx).toBe(3024);
    expect(g.heightPx).toBe(1964);
  });

  it('display capture on a negative-origin monitor scales the origin too', () => {
    const g = resolveCaptureGeometry({ kind: 'display', displayId: 'm1' }, winSources, 'win32');
    expect(g.captureRectInput).toEqual({ xPt: -1600, yPt: 0, widthPt: 1600, heightPt: 1000 });
  });

  it('area capture: input rect = display origin px + rect (already physical px)', () => {
    const g = resolveCaptureGeometry(
      { kind: 'area', displayId: 'm1', rect: { x: 100, y: 60, width: 640, height: 360 } },
      winSources,
      'win32',
    );
    expect(g.captureRectInput).toEqual({ xPt: -1500, yPt: 60, widthPt: 640, heightPt: 360 });
    expect(g.widthPx).toBe(640);
    expect(g.heightPx).toBe(360);
  });

  it('window capture: input rect = window bounds * display scale', () => {
    const g = resolveCaptureGeometry(
      { kind: 'window', windowId: 'w1', displayId: 'd1' },
      winSources,
      'win32',
    );
    expect(g.captureRectInput).toEqual({ xPt: 200, yPt: 160, widthPt: 1800, heightPt: 1200 });
  });
});
