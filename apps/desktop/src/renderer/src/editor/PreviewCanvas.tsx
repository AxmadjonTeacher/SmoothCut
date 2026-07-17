/**
 * The live preview: a SceneRenderer on a DPR-aware canvas sized to the
 * project canvas aspect. The hidden <video> is the frame source; while
 * playing the transport drives it and we render video.currentTime, while
 * paused we seek it to the mapped playhead and render on invalidation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { SceneRenderer, fitScreenRect, outputToSource } from '@smoothcut/engine';
import type { CursorTrack, Ripple, ZoomTrack } from '@smoothcut/engine';
import type { BundleUrls, ProjectFile, RecordingMeta } from '@smoothcut/shared';
import { editorStore, useEditor } from './store';
import { createCursorTextureManager } from './cursorTextures';
import { clamp, resolveCanvasSize } from './util';

interface PreviewCanvasProps {
  project: ProjectFile;
  meta: RecordingMeta;
  urls: BundleUrls;
  cursorTrack: CursorTrack;
  zoomTrack: ZoomTrack;
  ripples: Ripple[];
  shapeIds: readonly string[];
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Owned by EditorRoot so the transport can drive it alongside the screen. */
  camRef: RefObject<HTMLVideoElement | null>;
  /** camera.webm t=0 position on the SOURCE timeline, seconds (≥ 0). */
  camOffsetSec: number;
  picking: boolean;
  onPickTarget: (x: number, y: number) => void;
}

interface Size {
  w: number;
  h: number;
}

const MARGIN = 28;

export function PreviewCanvas({
  project,
  meta,
  urls,
  cursorTrack,
  zoomTrack,
  ripples,
  shapeIds,
  videoRef,
  camRef,
  camOffsetSec,
  picking,
  onPickTarget,
}: PreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  /** Serializes create/destroy so remounts never race two GL contexts. */
  const lifecycleRef = useRef<Promise<void>>(Promise.resolve());
  const needsRender = useRef(true);
  const rafRef = useRef<number | null>(null);

  const [cssSize, setCssSize] = useState<Size | null>(null);
  const [bootSize, setBootSize] = useState<Size | null>(null);
  const [renderer, setRenderer] = useState<SceneRenderer | null>(null);
  const [failed, setFailed] = useState(false);

  const playing = useEditor((s) => s.playing);
  const playheadSec = useEditor((s) => s.playheadSec);
  const timeline = project.timeline;

  const design = resolveCanvasSize(project, meta);
  const aspect = design.width / design.height;

  // ------------------------------------------------------------ render loop

  const scheduleFrame = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const renderer = rendererRef.current;
      const video = videoRef.current;
      if (!renderer || !video) return;
      const state = editorStore.getState();
      if (state.playing || needsRender.current) {
        needsRender.current = false;
        let tSrc = video.currentTime;
        if (!state.playing && state.project) {
          tSrc = outputToSource(state.project.timeline, state.playheadSec) ?? video.currentTime;
        }
        renderer.renderFrame(tSrc, { screen: video, webcam: camRef.current ?? undefined });
      }
      if (editorStore.getState().playing) scheduleFrame();
    });
  }, [videoRef, camRef]);

  const invalidate = useCallback(() => {
    needsRender.current = true;
    scheduleFrame();
  }, [scheduleFrame]);

  useEffect(() => {
    if (playing) scheduleFrame();
  }, [playing, scheduleFrame]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // ------------------------------------------------------------------ sizing

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = (): void => {
      const rect = container.getBoundingClientRect();
      const availW = Math.max(64, rect.width - MARGIN * 2);
      const availH = Math.max(64, rect.height - MARGIN * 2);
      const scale = Math.min(availW / aspect, availH);
      const size = { w: Math.max(2, Math.floor(scale * aspect)), h: Math.max(2, Math.floor(scale)) };
      setCssSize(size);
      setBootSize((prev) => prev ?? size);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [aspect]);

  // --------------------------------------------------------------- renderer

  useEffect(() => {
    if (!bootSize) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const dpr = window.devicePixelRatio || 1;
    lifecycleRef.current = lifecycleRef.current.then(async () => {
      if (disposed) return;
      try {
        const created = await SceneRenderer.create({
          canvas,
          width: Math.round(bootSize.w * dpr),
          height: Math.round(bootSize.h * dpr),
        });
        if (disposed) {
          created.destroy();
          return;
        }
        rendererRef.current = created;
        setRenderer(created);
        // Dev-harness introspection hook (no effect in production flows).
        (window as unknown as Record<string, unknown>).__scene = created;
      } catch (error) {
        console.error('SceneRenderer.create failed:', error);
        if (!disposed) setFailed(true);
      }
    });
    return () => {
      disposed = true;
      lifecycleRef.current = lifecycleRef.current.then(() => {
        const current = rendererRef.current;
        if (current) {
          rendererRef.current = null;
          setRenderer(null);
          current.destroy();
        }
      });
    };
  }, [bootSize]);

  useEffect(() => {
    if (!renderer || !cssSize) return;
    const dpr = window.devicePixelRatio || 1;
    renderer.resize(Math.round(cssSize.w * dpr), Math.round(cssSize.h * dpr));
    invalidate();
  }, [renderer, cssSize, invalidate]);

  // Re-apply style/cursor changes only (identity-stable via immer otherwise);
  // relayout re-bakes masks/shadows, so it must not run on every timeline edit.
  const style = project.style;
  const cursorStyle = project.cursor;
  useEffect(() => {
    if (!renderer) return;
    const current = editorStore.getState().project;
    renderer.applyProject(current ?? project, meta);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, style, cursorStyle, meta, invalidate]);

  useEffect(() => {
    if (!renderer) return;
    renderer.setTracks(cursorTrack, zoomTrack, ripples);
    invalidate();
  }, [renderer, cursorTrack, zoomTrack, ripples, invalidate]);

  useEffect(() => {
    if (!renderer) return;
    const manager = createCursorTextureManager(urls.cursorsBase, invalidate);
    manager.preload(shapeIds);
    renderer.setCursorTextures(manager);
    return () => manager.destroy();
  }, [renderer, urls.cursorsBase, shapeIds, invalidate]);

  // ------------------------------------------------------------------ video

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onFrameReady = (): void => invalidate();
    video.addEventListener('loadeddata', onFrameReady);
    video.addEventListener('seeked', onFrameReady);
    return () => {
      video.removeEventListener('loadeddata', onFrameReady);
      video.removeEventListener('seeked', onFrameReady);
    };
  }, [videoRef, invalidate]);

  // While paused, keep the video element on the mapped playhead frame.
  useEffect(() => {
    if (playing) return;
    const video = videoRef.current;
    if (!video) return;
    const tSrc = outputToSource(timeline, playheadSec);
    if (tSrc !== null && Math.abs(video.currentTime - tSrc) > 0.002) {
      video.currentTime = tSrc;
      const cam = camRef.current;
      // The camera file starts at camOffsetSec on the source clock.
      if (cam) cam.currentTime = Math.max(0, tSrc - camOffsetSec);
    }
    invalidate();
  }, [playing, playheadSec, timeline, videoRef, camRef, camOffsetSec, invalidate]);

  // ----------------------------------------------------------------- picking

  const handlePick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const screen = fitScreenRect(
        rect.width,
        rect.height,
        meta.capture.widthPx,
        meta.capture.heightPx,
        project.style.screen.paddingPct,
      );
      const x = clamp((e.clientX - rect.left - screen.x) / screen.width, 0, 1);
      const y = clamp((e.clientY - rect.top - screen.y) / screen.height, 0, 1);
      onPickTarget(x, y);
    },
    [meta, project.style.screen.paddingPct, onPickTarget],
  );

  const canvasStyle = useMemo(
    () => (cssSize ? { width: `${cssSize.w}px`, height: `${cssSize.h}px` } : undefined),
    [cssSize],
  );

  return (
    <div className="preview-panel" ref={containerRef}>
      <div className={picking ? 'preview-stage picking' : 'preview-stage'}>
        <canvas ref={canvasRef} className="preview-canvas" style={canvasStyle} />
        {picking ? (
          <div className="preview-pick-overlay" style={canvasStyle} onPointerDown={handlePick} />
        ) : null}
      </div>
      {picking ? <div className="preview-pick-hint">Click to set the zoom target · Esc to cancel</div> : null}
      {!renderer && !failed ? <div className="preview-status">Preparing preview…</div> : null}
      {failed ? <div className="preview-status">Preview unavailable (WebGL failed to start)</div> : null}
      <video
        ref={videoRef}
        className="preview-hidden-media"
        src={urls.screen}
        crossOrigin="anonymous"
        muted
        playsInline
        preload="auto"
      />
      {urls.camera ? (
        <video
          ref={camRef}
          className="preview-hidden-media"
          src={urls.camera}
          crossOrigin="anonymous"
          muted
          playsInline
          preload="auto"
        />
      ) : null}
    </div>
  );
}
