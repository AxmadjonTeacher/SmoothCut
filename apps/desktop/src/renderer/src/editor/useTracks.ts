/**
 * Bakes the deterministic effect tracks, re-baking only when their actual
 * inputs change (immer structural sharing keeps zoom.segments / zoom.config
 * reference-stable across unrelated project edits).
 */
import { useMemo } from 'react';
import { CursorTrack, ZoomTrack, extractRipples } from '@smoothcut/engine';
import type { Ripple, SpringTuning, VideoEvent } from '@smoothcut/engine';
import type { ZoomConfig, ZoomSegment } from '@smoothcut/shared';

export interface Tracks {
  cursorTrack: CursorTrack;
  zoomTrack: ZoomTrack;
  ripples: Ripple[];
}

export function useTracks(
  events: VideoEvent[],
  durationSec: number,
  smoothing: number,
  tuning: SpringTuning,
  zoomSegments: ZoomSegment[],
  zoomConfig: ZoomConfig,
): Tracks {
  const cursorTrack = useMemo(
    () => CursorTrack.bake(events, durationSec, smoothing, tuning),
    [events, durationSec, smoothing, tuning],
  );

  const ripples = useMemo(() => extractRipples(events), [events]);

  const zoomTrack = useMemo(
    () => ZoomTrack.bake(zoomSegments, zoomConfig, cursorTrack, durationSec),
    [zoomSegments, zoomConfig, cursorTrack, durationSec],
  );

  return useMemo(
    () => ({ cursorTrack, zoomTrack, ripples }),
    [cursorTrack, zoomTrack, ripples],
  );
}
