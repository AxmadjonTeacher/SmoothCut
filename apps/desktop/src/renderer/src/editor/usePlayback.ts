/**
 * Transport: the hidden <video> element drives playback. The playhead lives
 * in OUTPUT time; each rAF derives it from video.currentTime via
 * sourceToOutput, jumping across cut boundaries and applying per-segment
 * playbackRate. Seeking (paused) only moves the store playhead — the
 * PreviewCanvas owns syncing video.currentTime while paused.
 *
 * Synced media (webcam video + mic/system audio) follow the screen video:
 * they are seeked/played/paused/rate-matched together, each shifted by its
 * clock offset (source time - offsetSec = that file's own timeline), and
 * drift-corrected while playing.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { outputToSource, segmentAtOutput, sourceToOutput } from '@smoothcut/engine';
import { editorStore, setPlayhead, setPlaying } from './store';
import { totalOutput } from './timelineGeom';

const END_EPS = 1e-3;
/** Re-seek a synced element when it strays this far from the screen video. */
const DRIFT_EPS_SEC = 0.25;

/** A media element that follows the screen video, shifted by its clock offset. */
export interface SyncedMedia {
  el: HTMLMediaElement;
  /** This file's t=0 position on the SOURCE timeline, seconds (≥ 0). */
  offsetSec: number;
}

export interface PlaybackControls {
  toggle(): void;
  play(): void;
  pause(): void;
  /** Pauses and moves the output playhead (clamped). */
  seek(tOut: number): void;
}

export function usePlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  getSynced?: () => SyncedMedia[],
): PlaybackControls {
  const rafRef = useRef<number | null>(null);
  const segIdxRef = useRef(0);
  const getSyncedRef = useRef(getSynced);
  getSyncedRef.current = getSynced;

  const synced = useCallback((): SyncedMedia[] => getSyncedRef.current?.() ?? [], []);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /**
   * Steers the followers toward source time `tSrc`: before a follower's own
   * start (tSrc < offsetSec) or past its end it stays paused; inside its
   * range it plays (when `wantPlaying`) and is re-seeked past DRIFT_EPS_SEC.
   */
  const syncFollowers = useCallback(
    (tSrc: number, speed: number, wantPlaying: boolean) => {
      for (const media of synced()) {
        const el = media.el;
        const want = tSrc - media.offsetSec;
        el.playbackRate = speed;
        const past = Number.isFinite(el.duration) && want >= el.duration;
        if (want < 0 || past || !wantPlaying) {
          if (!el.paused) el.pause();
          if (want < 0 && el.currentTime > DRIFT_EPS_SEC) el.currentTime = 0;
        } else {
          if (Math.abs(el.currentTime - want) > DRIFT_EPS_SEC) el.currentTime = want;
          if (el.paused) {
            void el.play().catch(() => {
              // A follower failing to play must not block the transport.
            });
          }
        }
      }
    },
    [synced],
  );

  const pause = useCallback(() => {
    stopLoop();
    videoRef.current?.pause();
    for (const media of synced()) media.el.pause();
    if (editorStore.getState().playing) setPlaying(false);
  }, [stopLoop, videoRef, synced]);

  const tick = useCallback(() => {
    rafRef.current = null;
    const video = videoRef.current;
    const { project, playing } = editorStore.getState();
    if (!video || !project || !playing) return;
    const segments = project.timeline;

    let idx = Math.min(segIdxRef.current, segments.length - 1);
    let seg = segments[idx];
    if (!seg) {
      pause();
      return;
    }

    if (video.currentTime >= seg.sourceEnd - END_EPS || video.ended) {
      idx += 1;
      const next = segments[idx];
      if (!next) {
        setPlayhead(totalOutput(segments));
        pause();
        return;
      }
      segIdxRef.current = idx;
      seg = next;
      video.currentTime = next.sourceStart;
      video.playbackRate = next.speed;
    }
    // Keep the followers locked to the screen video every frame.
    syncFollowers(video.currentTime, seg.speed, true);

    const clampedSrc = Math.min(Math.max(video.currentTime, seg.sourceStart), seg.sourceEnd);
    const out = sourceToOutput(segments, clampedSrc);
    if (out !== null) setPlayhead(out);

    rafRef.current = requestAnimationFrame(tick);
  }, [pause, videoRef, syncFollowers]);

  const play = useCallback(() => {
    const video = videoRef.current;
    const { project, playheadSec } = editorStore.getState();
    if (!video || !project || project.timeline.length === 0) return;
    const segments = project.timeline;
    const total = totalOutput(segments);

    let tOut = playheadSec;
    if (tOut >= total - END_EPS) tOut = 0; // replay from the start when at the end
    const located = segmentAtOutput(segments, tOut);
    const tSrc = outputToSource(segments, tOut);
    if (!located || tSrc === null) return;

    segIdxRef.current = located.index;
    video.currentTime = tSrc;
    video.playbackRate = located.segment.speed;
    void video.play().catch(() => {
      setPlaying(false);
    });
    syncFollowers(tSrc, located.segment.speed, true);
    setPlaying(true);
    setPlayhead(tOut);
    stopLoop();
    rafRef.current = requestAnimationFrame(tick);
  }, [stopLoop, tick, videoRef, syncFollowers]);

  const toggle = useCallback(() => {
    if (editorStore.getState().playing) pause();
    else play();
  }, [pause, play]);

  const seek = useCallback(
    (tOut: number) => {
      pause();
      const { project } = editorStore.getState();
      const total = project ? totalOutput(project.timeline) : 0;
      setPlayhead(Math.min(Math.max(tOut, 0), total));
    },
    [pause],
  );

  useEffect(() => stopLoop, [stopLoop]);

  return useMemo(() => ({ toggle, play, pause, seek }), [toggle, play, pause, seek]);
}
