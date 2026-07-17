/**
 * Offscreen-2D bake helpers. Everything here runs ONCE per style change —
 * backgrounds, drop shadows and masks are baked into textures, never computed
 * with live filters per frame. Works in both the editor window and Workers
 * (OffscreenCanvas first, DOM canvas fallback).
 */

export type BakeCanvas = OffscreenCanvas | HTMLCanvasElement;
export type BakeContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface Baked {
  canvas: BakeCanvas;
  ctx: BakeContext;
  width: number;
  height: number;
}

export function createCanvas(width: number, height: number): Baked {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
    return { canvas, ctx, width: w, height: h };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  return { canvas, ctx, width: w, height: h };
}

export interface GradientStop {
  color: string;
  at: number;
}

export interface GradientSpec {
  /** CSS-style angle in degrees: 0 = to top, 90 = to right. */
  angle: number;
  stops: GradientStop[];
}

export const GRADIENT_PRESETS: Record<string, GradientSpec> = {
  aurora: {
    angle: 130,
    stops: [
      { color: '#0b1023', at: 0 },
      { color: '#16325c', at: 0.35 },
      { color: '#1f7a67', at: 0.7 },
      { color: '#67e0a3', at: 1 },
    ],
  },
  sunset: {
    angle: 160,
    stops: [
      { color: '#2d1b4e', at: 0 },
      { color: '#7b2d5e', at: 0.4 },
      { color: '#e05c45', at: 0.75 },
      { color: '#f8b26a', at: 1 },
    ],
  },
  ocean: {
    angle: 135,
    stops: [
      { color: '#0f2027', at: 0 },
      { color: '#203a43', at: 0.5 },
      { color: '#2c5364', at: 1 },
    ],
  },
  graphite: {
    angle: 135,
    stops: [
      { color: '#1b1c1f', at: 0 },
      { color: '#3a3d42', at: 1 },
    ],
  },
  peach: {
    angle: 135,
    stops: [
      { color: '#ffecd2', at: 0 },
      { color: '#fcb69f', at: 1 },
    ],
  },
  forest: {
    angle: 140,
    stops: [
      { color: '#0b2e24', at: 0 },
      { color: '#134e5e', at: 0.45 },
      { color: '#71b280', at: 1 },
    ],
  },
};

/** Preset id first, then the JSON `{angle, stops:[{color,at}]}` form. */
export function parseGradient(value: string): GradientSpec | null {
  const preset = GRADIENT_PRESETS[value];
  if (preset) return preset;
  try {
    const parsed = JSON.parse(value) as { angle?: unknown; stops?: unknown };
    if (typeof parsed.angle !== 'number' || !Array.isArray(parsed.stops)) return null;
    const stops: GradientStop[] = [];
    for (const s of parsed.stops as { color?: unknown; at?: unknown }[]) {
      if (typeof s?.color !== 'string' || typeof s?.at !== 'number') return null;
      stops.push({ color: s.color, at: Math.min(1, Math.max(0, s.at)) });
    }
    if (stops.length < 2) return null;
    return { angle: parsed.angle, stops };
  } catch {
    return null;
  }
}

export function drawLinearGradient(
  ctx: BakeContext,
  width: number,
  height: number,
  spec: GradientSpec,
): void {
  const rad = ((spec.angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const half = Math.abs(dx) * (width / 2) + Math.abs(dy) * (height / 2);
  const cx = width / 2;
  const cy = height / 2;
  const gradient = ctx.createLinearGradient(
    cx - dx * half,
    cy - dy * half,
    cx + dx * half,
    cy + dy * half,
  );
  const stops = [...spec.stops].sort((a, b) => a.at - b.at);
  for (const s of stops) gradient.addColorStop(s.at, s.color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

export type PathBuilder = (ctx: BakeContext, x: number, y: number, w: number, h: number) => void;

export function roundedRectPath(radius: number): PathBuilder {
  return (ctx, x, y, w, h) => {
    ctx.roundRect(x, y, w, h, Math.max(0, Math.min(radius, w / 2, h / 2)));
  };
}

export function circlePath(): PathBuilder {
  return (ctx, x, y, w, h) => {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  };
}

/** Superellipse |x/a|^n + |y/b|^n = 1 with n = 4 ("squircle"). */
export function squirclePath(steps = 64): PathBuilder {
  return (ctx, x, y, w, h) => {
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx;
    const cy = y + ry;
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const px = cx + rx * Math.sign(c) * Math.pow(Math.abs(c), 0.5);
      const py = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 0.5);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
}

export interface BakedShadow {
  canvas: BakeCanvas;
  /** Distance from the canvas edge to the shape's rect (offsetY is baked in). */
  margin: number;
}

/**
 * Bakes a drop shadow (rounded rect / squircle / circle + gaussian falloff)
 * into a canvas. The shape itself is drawn far off-canvas with a compensating
 * shadow offset so only the blurred shadow lands on the bitmap.
 */
export function bakeShadow(
  width: number,
  height: number,
  opacity: number,
  blurPx: number,
  offsetY: number,
  path: PathBuilder,
): BakedShadow | null {
  if (opacity <= 0) return null;
  const margin = Math.ceil(blurPx * 2 + Math.abs(offsetY)) + 4;
  const baked = createCanvas(width + margin * 2, height + margin * 2);
  const { ctx } = baked;
  ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(1, opacity)})`;
  ctx.shadowBlur = blurPx;
  ctx.shadowOffsetX = baked.width;
  ctx.shadowOffsetY = offsetY;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  path(ctx, margin - baked.width, margin, width, height);
  ctx.fill();
  return { canvas: baked.canvas, margin };
}

/** Bakes an opaque-white anti-aliased shape for use as a Sprite alpha mask. */
export function bakeMask(width: number, height: number, path: PathBuilder): BakeCanvas {
  const baked = createCanvas(width, height);
  const { ctx } = baked;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  path(ctx, 0, 0, baked.width, baked.height);
  ctx.fill();
  return baked.canvas;
}
