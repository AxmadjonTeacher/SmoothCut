import type { ZoomConfig, ZoomSegment } from '@smoothcut/shared';
import type { VideoEvent } from '../time.js';

/** Adjacent generated segments closer than this are merged into one. */
const MERGE_GAP_SEC = 1.0;
/** Clusters whose click bounding-box diagonal exceeds this are treated as drag-selects. */
const DRAG_DIAGONAL_MAX = 0.6;

interface Click {
  tSec: number;
  x: number;
  y: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Auto-generates follow-cursor zoom segments from click clusters:
 * down events closer than clusterGapSec form a cluster; each cluster becomes a
 * segment [firstClick - leadSec, lastClick + holdSec] clamped to the video,
 * clusters that look like drag-selects are dropped, and segments closer than
 * 1s are merged.
 */
export function generateZoomSegments(
  events: VideoEvent[],
  durationSec: number,
  config: ZoomConfig,
): ZoomSegment[] {
  const clicks: Click[] = [];
  for (const e of events) {
    if (e.type === 'down') clicks.push({ tSec: e.tSec, x: clamp01(e.x), y: clamp01(e.y) });
  }
  if (clicks.length === 0) return [];
  clicks.sort((a, b) => a.tSec - b.tSec);

  const clusters: Click[][] = [];
  let current: Click[] = [clicks[0]!];
  for (let i = 1; i < clicks.length; i++) {
    const click = clicks[i]!;
    if (click.tSec - current[current.length - 1]!.tSec <= config.clusterGapSec) {
      current.push(click);
    } else {
      clusters.push(current);
      current = [click];
    }
  }
  clusters.push(current);

  const spans: { start: number; end: number }[] = [];
  for (const cluster of clusters) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of cluster) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    if (Math.hypot(maxX - minX, maxY - minY) > DRAG_DIAGONAL_MAX) continue;

    const start = Math.max(0, cluster[0]!.tSec - config.leadSec);
    const end = Math.min(durationSec, cluster[cluster.length - 1]!.tSec + config.holdSec);
    if (end - start <= 1e-6) continue;
    spans.push({ start, end });
  }

  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const prev = merged[merged.length - 1];
    if (prev && span.start - prev.end < MERGE_GAP_SEC) {
      prev.end = Math.max(prev.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  return merged.map((span, i) => ({
    id: `zoom-${i}`,
    start: span.start,
    end: span.end,
    level: config.defaultLevel,
    target: { mode: 'follow-cursor' as const },
    origin: 'auto' as const,
  }));
}
