import { describe, expect, it } from 'vitest';
import { fitScreenRect, fitWebcamRect } from './layout.js';

const W = 3840;
const H = 2160;
const MARGIN = 0.035 * H;

describe('fitScreenRect', () => {
  it('is unchanged for non-split layouts (regression)', () => {
    const plain = fitScreenRect(W, H, 3024, 1964, 0.06);
    for (const layout of [
      'bubble-bl',
      'bubble-br',
      'bubble-tl',
      'bubble-tr',
      'pinned-left',
      'pinned-right',
      'custom',
    ] as const) {
      expect(fitScreenRect(W, H, 3024, 1964, 0.06, layout)).toEqual(plain);
    }
    // Original centered-fit math, bit-for-bit.
    const pad = 0.06 * H;
    const scale = Math.min((W - pad * 2) / 3024, (H - pad * 2) / 1964);
    expect(plain.width).toBe(3024 * scale);
    expect(plain.x).toBe((W - plain.width) / 2);
  });

  it('reserves the right column for split-right', () => {
    const split = fitScreenRect(W, H, 3024, 1964, 0.06, 'split-right');
    const cam = fitWebcamRect(W, H, 'split-right', 0.22);
    // Screen stays fully left of the webcam column.
    expect(split.x + split.width).toBeLessThanOrEqual(cam.x);
    // Screen card lands in the Screen-Studio-ish 55–75% width band.
    expect(split.width / W).toBeGreaterThan(0.55);
    expect(split.width / W).toBeLessThan(0.75);
  });
});

describe('fitWebcamRect', () => {
  it('keeps the six preset layouts pixel-identical (regression)', () => {
    expect(fitWebcamRect(W, H, 'bubble-br', 0.22, 'squircle')).toEqual({
      x: W - MARGIN - 0.22 * H,
      y: H - MARGIN - 0.22 * H,
      width: 0.22 * H,
      height: 0.22 * H,
    });
    expect(fitWebcamRect(W, H, 'pinned-left', 0.3, 'rect')).toEqual({
      x: MARGIN,
      y: (H - 0.3 * H) / 2,
      width: 0.3 * H * 0.72,
      height: 0.3 * H,
    });
  });

  it('centers custom on position with bubble sizing', () => {
    const rect = fitWebcamRect(W, H, 'custom', 0.2, 'circle', { x: 0.25, y: 0.6 });
    expect(rect.width).toBe(0.2 * H);
    expect(rect.height).toBe(0.2 * H);
    expect(rect.x + rect.width / 2).toBeCloseTo(0.25 * W);
    expect(rect.y + rect.height / 2).toBeCloseTo(0.6 * H);
  });

  it('falls back to canvas center and clamps custom fully on-canvas', () => {
    const centered = fitWebcamRect(W, H, 'custom', 0.2, 'squircle');
    expect(centered.x + centered.width / 2).toBeCloseTo(W / 2);
    expect(centered.y + centered.height / 2).toBeCloseTo(H / 2);
    const clamped = fitWebcamRect(W, H, 'custom', 0.2, 'squircle', { x: 1.2, y: -0.5 });
    expect(clamped.x).toBe(W - clamped.width);
    expect(clamped.y).toBe(0);
  });

  it('fills the right column for split-right', () => {
    const rect = fitWebcamRect(W, H, 'split-right', 0.22, 'circle');
    expect(rect.x + rect.width).toBeCloseTo(W - MARGIN);
    expect(rect.y).toBeCloseTo(MARGIN);
    expect(rect.height).toBeCloseTo(H - MARGIN * 2);
    // Tall portrait column ~30% of canvas width minus the margin.
    expect(rect.width).toBeCloseTo(0.3 * W - MARGIN);
    expect(rect.height).toBeGreaterThan(rect.width);
  });
});
