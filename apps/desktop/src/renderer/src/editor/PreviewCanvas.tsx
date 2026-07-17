/**
 * The live preview: a SceneRenderer on a DPR-aware canvas sized to the
 * project canvas aspect. The hidden <video> is the frame source; while
 * playing the transport drives it and we render video.currentTime, while
 * paused we seek it to the mapped playhead and render on invalidation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { SceneRenderer, fitScreenRect, fitWebcamRect, outputToSource } from '@smoothcut/engine';
import type { CursorTrack, Ripple, ZoomTrack } from '@smoothcut/engine';
import type { BundleUrls, ProjectFile, RecordingMeta } from '@smoothcut/shared';
import { beginGesture, cancelGesture, commitGesture, editorStore, updateGesture, useEditor } from './store';
import { createCursorTextureManager } from './cursorTextures';
import { clamp, resolveCanvasSize } from './util';
import { WALLPAPER_URLS } from '../wallpapers';

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
        created.setWallpaperUrls(WALLPAPER_URLS);
        // Async background bakes (wallpaper/image) land after applyProject
        // returns; re-render even while paused so they show immediately.
        created.onNeedsRender = invalidate;
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
  }, [bootSize, invalidate]);

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
    const onFrameReady = (): void => invalidate();
    // The webcam element must invalidate too: on open (paused) the first
    // render happens when the SCREEN frame is ready, which can be before the
    // camera has decoded anything — without these listeners the webcam tile
    // stays empty until something else forces a render.
    const media = [videoRef.current, camRef.current].filter((el) => el !== null);
    for (const el of media) {
      el.addEventListener('loadeddata', onFrameReady);
      el.addEventListener('seeked', onFrameReady);
    }
    return () => {
      for (const el of media) {
        el.removeEventListener('loadeddata', onFrameReady);
        el.removeEventListener('seeked', onFrameReady);
      }
    };
  }, [videoRef, camRef, invalidate]);

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

  // ------------------------------------------------------------- webcam drag

  /** Grab offset from the pointer to the webcam center (view px) while dragging. */
  const camDragRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);

  /** Pointer position in renderer view px (the canvas backing resolution). */
  const toViewPx = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const b = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - b.left) / Math.max(1, b.width)) * canvas.width,
      y: ((e.clientY - b.top) / Math.max(1, b.height)) * canvas.height,
    };
  }, []);

  /**
   * Webcam-center unit coords for a drag point (view px), clamped through the
   * engine's own custom-layout fit so the card always stays fully on-canvas.
   */
  const dragPosition = useCallback((px: number, py: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    const current = editorStore.getState().project;
    if (!canvas || !current || canvas.width < 1 || canvas.height < 1) return null;
    const rect = fitWebcamRect(
      canvas.width,
      canvas.height,
      'custom',
      current.style.webcam.sizePct,
      current.style.webcam.cornerStyle,
      { x: px / canvas.width, y: py / canvas.height },
    );
    return {
      x: (rect.x + rect.width / 2) / canvas.width,
      y: (rect.y + rect.height / 2) / canvas.height,
    };
  }, []);

  const overWebcam = useCallback((p: { x: number; y: number }): boolean => {
    const cam = rendererRef.current?.getWebcamRectPx() ?? null;
    return (
      cam !== null &&
      p.x >= cam.x &&
      p.x <= cam.x + cam.width &&
      p.y >= cam.y &&
      p.y <= cam.y + cam.height
    );
  }, []);

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (picking || e.button !== 0) return;
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      const current = editorStore.getState().project;
      if (!renderer || !canvas || !current) return;
      const cam = renderer.getWebcamRectPx();
      const p = toViewPx(e);
      if (!cam || !overWebcam(p)) return;
      // Keep the grab offset so the card doesn't jump under the pointer; cap
      // it to the custom-size card (grabbing the tall split card shrinks it).
      const custom = fitWebcamRect(
        canvas.width,
        canvas.height,
        'custom',
        current.style.webcam.sizePct,
        current.style.webcam.cornerStyle,
      );
      camDragRef.current = {
        pointerId: e.pointerId,
        dx: clamp(cam.x + cam.width / 2 - p.x, -custom.width / 2, custom.width / 2),
        dy: clamp(cam.y + cam.height / 2 - p.y, -custom.height / 2, custom.height / 2),
      };
      beginGesture();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // No active pointer (synthetic events, pointer already lifted) —
        // the drag still works for events delivered to the canvas itself.
      }
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    },
    [picking, toViewPx, overWebcam],
  );

  const onCanvasPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const drag = camDragRef.current;
      if (!drag) {
        if (!picking) canvas.style.cursor = overWebcam(toViewPx(e)) ? 'grab' : '';
        return;
      }
      if (e.pointerId !== drag.pointerId) return;
      const p = toViewPx(e);
      const pos = dragPosition(p.x + drag.dx, p.y + drag.dy);
      if (!pos) return;
      updateGesture((d) => {
        d.style.webcam.layout = 'custom';
        d.style.webcam.position = pos;
      });
    },
    [picking, toViewPx, overWebcam, dragPosition],
  );

  const onCanvasPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = camDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      camDragRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = 'grab';
      const p = toViewPx(e);
      const pos = dragPosition(p.x + drag.dx, p.y + drag.dy);
      if (pos) {
        // Single undo entry for the whole drag.
        commitGesture((d) => {
          d.style.webcam.layout = 'custom';
          d.style.webcam.position = pos;
        });
      } else {
        cancelGesture();
      }
    },
    [toViewPx, dragPosition],
  );

  const onCanvasPointerCancel = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = camDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    camDragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    cancelGesture();
  }, []);

  // ----------------------------------------------------------------- picking

  const webcamStyle = project.style.webcam;
  const splitActive = webcamStyle.layout === 'split-right' && !webcamStyle.hidden && urls.camera !== undefined;

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
        splitActive ? 'split-right' : undefined,
      );
      const x = clamp((e.clientX - rect.left - screen.x) / screen.width, 0, 1);
      const y = clamp((e.clientY - rect.top - screen.y) / screen.height, 0, 1);
      onPickTarget(x, y);
    },
    [meta, project.style.screen.paddingPct, splitActive, onPickTarget],
  );

  const canvasStyle = useMemo(
    () => (cssSize ? { width: `${cssSize.w}px`, height: `${cssSize.h}px` } : undefined),
    [cssSize],
  );

  return (
    <div className="preview-panel" ref={containerRef}>
      <div className={picking ? 'preview-stage picking' : 'preview-stage'}>
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          style={canvasStyle}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerCancel}
        />
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
