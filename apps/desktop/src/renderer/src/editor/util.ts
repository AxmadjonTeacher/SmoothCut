/** Small shared editor helpers (no DOM, no pixi). */
import type { ProjectFile, RecordingMeta, ZoomSegment } from '@smoothcut/shared';
import type { GradientSpec } from '@smoothcut/engine';

/** The design-canvas pixel size ('source' preset resolves from the capture). */
export function resolveCanvasSize(
  project: ProjectFile,
  meta: RecordingMeta,
): { width: number; height: number } {
  const canvas = project.style.canvas;
  if (canvas.preset === 'source' || canvas.width <= 0 || canvas.height <= 0) {
    return { width: Math.max(1, meta.capture.widthPx), height: Math.max(1, meta.capture.heightPx) };
  }
  return { width: canvas.width, height: canvas.height };
}

export interface ResolutionTier {
  label: string;
  width: number;
  height: number;
}

/** ~1080p / 1440p / 4K tiers scaled to the canvas aspect, even dimensions. */
export function resolutionTiers(canvasW: number, canvasH: number): ResolutionTier[] {
  return [
    { k: 1080, label: '1080p' },
    { k: 1440, label: '1440p' },
    { k: 2160, label: '4K' },
  ].map(({ k, label }) => {
    const scale = k / Math.max(1, Math.min(canvasW, canvasH));
    const even = (v: number): number => Math.max(2, Math.round((v * scale) / 2) * 2);
    return { label, width: even(canvasW), height: even(canvasH) };
  });
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** CSS preview string for an engine gradient spec. */
export function cssGradient(spec: GradientSpec): string {
  const stops = spec.stops.map((s) => `${s.color} ${(s.at * 100).toFixed(1)}%`).join(', ');
  return `linear-gradient(${spec.angle}deg, ${stops})`;
}

/** Ids that never collide with the segments already present. */
export function uniqueZoomIds(existing: readonly ZoomSegment[], count: number): string[] {
  const taken = new Set(existing.map((s) => s.id));
  const ids: string[] = [];
  let n = 0;
  while (ids.length < count) {
    const candidate = `zoom-${n}`;
    n++;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    ids.push(candidate);
  }
  return ids;
}

export function formatEta(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "812 KB" / "24.3 MB" / "1.21 GB" (decimal units, like Finder). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit: string = units[0];
  for (const u of units) {
    value /= 1000;
    unit = u;
    if (value < 1000) break;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${unit}`;
}
