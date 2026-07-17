/**
 * Bottom-docked timeline: ruler + clips lane + zoom lane, all in OUTPUT time.
 * Fit-to-width scale; cut boundaries render as slim gaps between clip blocks.
 * Drags preview through the store's gesture API and commit one undo entry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { outputToSource, setSpeed, trimSegment } from '@smoothcut/engine';
import type { ProjectFile, ZoomSegment } from '@smoothcut/shared';
import {
  applyCommand,
  cancelGesture,
  commitGesture,
  editorStore,
  setPickingZoom,
  setSelection,
  updateGesture,
  useEditor,
} from './store';
import type { PlaybackControls } from './usePlayback';
import {
  chooseTickStep,
  clipRects,
  fitPxPerSec,
  formatTime,
  formatTimeShort,
  outputTimeToPx,
  pxToOutputTime,
  resizeZoomRange,
  shiftZoomRange,
  sourceRangeToOutput,
  totalOutput,
} from './timelineGeom';
import type { LaneMetrics } from './timelineGeom';
import { SliderRow, Segmented } from './controls';
import { clamp } from './util';

const PAD = 14;
const GAP_PX = 6;
const SPEED_OPTIONS = [0.5, 1, 1.5, 2, 4, 8];

interface TimelineProps {
  project: ProjectFile;
  durationSec: number;
  controls: PlaybackControls;
}

function dragPointer(
  e: ReactPointerEvent<Element>,
  onMove: (ev: PointerEvent) => void,
  onUp: (ev: PointerEvent, moved: boolean) => void,
): void {
  const el = e.currentTarget as HTMLElement;
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Pointer already released — treat as a click.
  }
  const move = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 2) moved = true;
    onMove(ev);
  };
  const finish = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', finish);
    el.removeEventListener('pointercancel', finish);
    onUp(ev, moved);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
}

export function Timeline({ project, durationSec, controls }: TimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [speedMenu, setSpeedMenu] = useState<{ id: string; left: number } | null>(null);

  const selection = useEditor((s) => s.selection);
  const playheadSec = useEditor((s) => s.playheadSec);
  const picking = useEditor((s) => s.pickingZoomId);

  const segments = project.timeline;
  const zoomSegments = project.zoom.segments;
  const total = totalOutput(segments);
  const laneWidth = Math.max(50, width - PAD * 2);

  const metrics: LaneMetrics = useMemo(
    () => ({ pxPerSec: fitPxPerSec(segments, laneWidth, GAP_PX), gapPx: GAP_PX }),
    [segments, laneWidth],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const laneLeft = useCallback((): number => {
    const el = containerRef.current;
    return (el ? el.getBoundingClientRect().left : 0) + PAD;
  }, []);

  // ------------------------------------------------------------------ scrub

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const base = editorStore.getState().project;
      if (!base) return;
      controls.seek(pxToOutputTime(base.timeline, metrics, clientX - laneLeft()));
    },
    [controls, metrics, laneLeft],
  );

  const onRulerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      seekFromClientX(e.clientX);
      dragPointer(
        e,
        (ev) => seekFromClientX(ev.clientX),
        () => undefined,
      );
    },
    [seekFromClientX],
  );

  // ------------------------------------------------------------------ clips

  const onTrimDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, id: string, edge: 'start' | 'end') => {
      e.stopPropagation();
      const base = editorStore.getState().project;
      if (!base) return;
      const idx = base.timeline.findIndex((s) => s.id === id);
      const seg0 = base.timeline[idx];
      if (!seg0) return;
      const isLast = idx === base.timeline.length - 1;
      const pxPerSec0 = metrics.pxPerSec;
      const startClientX = e.clientX;
      const edge0 = edge === 'start' ? seg0.sourceStart : seg0.sourceEnd;
      let lastT = edge0;

      const targetFor = (clientX: number): number => {
        let t = edge0 + ((clientX - startClientX) / pxPerSec0) * seg0.speed;
        if (edge === 'end' && isLast) t = Math.min(t, durationSec);
        return t;
      };

      dragPointer(
        e,
        (ev) => {
          lastT = targetFor(ev.clientX);
          const next = trimSegment(base.timeline, id, edge, lastT);
          updateGesture((d) => {
            d.timeline = next;
          });
        },
        (_ev, moved) => {
          if (!moved) {
            cancelGesture();
            setSelection({ kind: 'clip', id });
            return;
          }
          const next = trimSegment(base.timeline, id, edge, lastT);
          commitGesture((d) => {
            d.timeline = next;
          });
          setSelection({ kind: 'clip', id });
        },
      );
    },
    [metrics, durationSec],
  );

  const onSetSpeed = useCallback((id: string, speed: number) => {
    const base = editorStore.getState().project;
    if (!base) return;
    const next = setSpeed(base.timeline, id, speed);
    applyCommand((d) => {
      d.timeline = next;
    });
    setSpeedMenu(null);
  }, []);

  // ------------------------------------------------------------------ zooms

  const onZoomBodyDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
      e.stopPropagation();
      const base = editorStore.getState().project;
      if (!base) return;
      const z0 = base.zoom.segments.find((s) => s.id === id);
      if (!z0) return;
      const range0 = sourceRangeToOutput(base.timeline, z0.start, z0.end);
      const pxPerSec0 = metrics.pxPerSec;
      const startClientX = e.clientX;
      const baseTotal = totalOutput(base.timeline);
      let last = { start: z0.start, end: z0.end };

      dragPointer(
        e,
        (ev) => {
          if (!range0) return;
          const dOut = (ev.clientX - startClientX) / pxPerSec0;
          const newOutStart = clamp(range0.start + dOut, 0, baseTotal);
          const newSrcStart = outputToSource(base.timeline, newOutStart);
          if (newSrcStart === null) return;
          last = shiftZoomRange(z0.start, z0.end, newSrcStart - z0.start, durationSec);
          updateGesture((d) => {
            const z = d.zoom.segments.find((s) => s.id === id);
            if (z) {
              z.start = last.start;
              z.end = last.end;
              z.origin = 'manual';
            }
          });
        },
        (_ev, moved) => {
          if (!moved) {
            cancelGesture();
            setSelection({ kind: 'zoom', id });
            return;
          }
          commitGesture((d) => {
            const z = d.zoom.segments.find((s) => s.id === id);
            if (z) {
              z.start = last.start;
              z.end = last.end;
              z.origin = 'manual';
            }
          });
          setSelection({ kind: 'zoom', id });
        },
      );
    },
    [metrics, durationSec],
  );

  const onZoomEdgeDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, id: string, edge: 'start' | 'end') => {
      e.stopPropagation();
      const base = editorStore.getState().project;
      if (!base) return;
      const z0 = base.zoom.segments.find((s) => s.id === id);
      if (!z0) return;
      let last = { start: z0.start, end: z0.end };

      dragPointer(
        e,
        (ev) => {
          const out = pxToOutputTime(base.timeline, metrics, ev.clientX - laneLeft());
          const src = outputToSource(base.timeline, out);
          if (src === null) return;
          last = resizeZoomRange(z0.start, z0.end, edge, src, durationSec);
          updateGesture((d) => {
            const z = d.zoom.segments.find((s) => s.id === id);
            if (z) {
              z.start = last.start;
              z.end = last.end;
              z.origin = 'manual';
            }
          });
        },
        (_ev, moved) => {
          if (!moved) {
            cancelGesture();
            setSelection({ kind: 'zoom', id });
            return;
          }
          commitGesture((d) => {
            const z = d.zoom.segments.find((s) => s.id === id);
            if (z) {
              z.start = last.start;
              z.end = last.end;
              z.origin = 'manual';
            }
          });
        },
      );
    },
    [metrics, durationSec, laneLeft],
  );

  const onZoomLevel = useCallback((id: string, level: number, phase: 'preview' | 'commit') => {
    const recipe = (d: ProjectFile): void => {
      const z = d.zoom.segments.find((s) => s.id === id);
      if (z) {
        z.level = level;
        z.origin = 'manual';
      }
    };
    if (phase === 'preview') updateGesture(recipe);
    else commitGesture(recipe);
  }, []);

  const onZoomMode = useCallback((z: ZoomSegment, mode: 'follow-cursor' | 'fixed') => {
    if (mode === 'follow-cursor') {
      setPickingZoom(null);
      if (z.target.mode !== 'follow-cursor') {
        applyCommand((d) => {
          const seg = d.zoom.segments.find((s) => s.id === z.id);
          if (seg) {
            seg.target = { mode: 'follow-cursor' };
            seg.origin = 'manual';
          }
        });
      }
    } else {
      setPickingZoom(z.id);
    }
  }, []);

  const onZoomDelete = useCallback((id: string) => {
    applyCommand((d) => {
      d.zoom.segments = d.zoom.segments.filter((s) => s.id !== id);
    });
    setSelection(null);
    setPickingZoom(null);
  }, []);

  // ----------------------------------------------------------------- render

  const rects = useMemo(() => clipRects(segments, metrics), [segments, metrics]);

  const ticks = useMemo(() => {
    const step = chooseTickStep(metrics.pxPerSec);
    const out: { t: number; x: number }[] = [];
    for (let t = 0; t <= total + 1e-9 && out.length < 200; t += step) {
      out.push({ t, x: outputTimeToPx(segments, metrics, t) });
    }
    return { step, out };
  }, [segments, metrics, total]);

  const playheadX = PAD + outputTimeToPx(segments, metrics, Math.min(playheadSec, total));

  const selectedZoom =
    selection?.kind === 'zoom' ? zoomSegments.find((z) => z.id === selection.id) ?? null : null;
  const selectedZoomRange = selectedZoom
    ? sourceRangeToOutput(segments, selectedZoom.start, selectedZoom.end)
    : null;

  const menuSegment = speedMenu ? segments.find((s) => s.id === speedMenu.id) ?? null : null;

  return (
    <div className="timeline" ref={containerRef} onPointerDown={() => setSelection(null)}>
      <div className="tl-ruler" onPointerDown={onRulerDown}>
        {ticks.out.map(({ t, x }) => (
          <div key={t.toFixed(3)} className="tl-tick" style={{ left: PAD + x }}>
            <span>{ticks.step < 1 ? formatTime(t) : formatTimeShort(t)}</span>
          </div>
        ))}
      </div>

      <div className="tl-lane tl-clips">
        {rects.map((rect) => {
          const seg = segments.find((s) => s.id === rect.id);
          if (!seg) return null;
          const isSelected = selection?.kind === 'clip' && selection.id === rect.id;
          return (
            <div
              key={rect.id}
              className={isSelected ? 'tl-clip selected' : 'tl-clip'}
              style={{ left: PAD + rect.x, width: Math.max(6, rect.width) }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setSelection({ kind: 'clip', id: rect.id });
              }}
            >
              <span className="tl-clip-label">{formatTime(rect.outEnd - rect.outStart)}</span>
              <button
                type="button"
                className="tl-speed-badge"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setSpeedMenu(
                    speedMenu?.id === rect.id
                      ? null
                      : { id: rect.id, left: clamp(PAD + rect.x + rect.width - 60, PAD, Math.max(PAD, width - 90)) },
                  );
                }}
              >
                {seg.speed}x
              </button>
              <div className="tl-trim tl-trim-l" onPointerDown={(e) => onTrimDown(e, rect.id, 'start')} />
              <div className="tl-trim tl-trim-r" onPointerDown={(e) => onTrimDown(e, rect.id, 'end')} />
            </div>
          );
        })}
      </div>

      <div className="tl-lane tl-zooms">
        {zoomSegments.map((z) => {
          const range = sourceRangeToOutput(segments, z.start, z.end);
          if (!range) return null;
          const x = outputTimeToPx(segments, metrics, range.start);
          const w = Math.max(8, outputTimeToPx(segments, metrics, range.end) - x);
          const isSelected = selection?.kind === 'zoom' && selection.id === z.id;
          return (
            <div
              key={z.id}
              className={isSelected ? 'tl-zoom selected' : 'tl-zoom'}
              style={{ left: PAD + x, width: w }}
              onPointerDown={(e) => onZoomBodyDown(e, z.id)}
            >
              <span className="tl-zoom-label">
                {z.level.toFixed(1)}x{z.target.mode === 'fixed' ? ' ·fixed' : ''}
              </span>
              <div className="tl-trim tl-trim-l" onPointerDown={(e) => onZoomEdgeDown(e, z.id, 'start')} />
              <div className="tl-trim tl-trim-r" onPointerDown={(e) => onZoomEdgeDown(e, z.id, 'end')} />
            </div>
          );
        })}
      </div>

      <div className="tl-playhead" style={{ left: playheadX }}>
        <div className="tl-playhead-cap" />
      </div>

      {menuSegment && speedMenu ? (
        <>
          <div className="tl-menu-backdrop" onPointerDown={() => setSpeedMenu(null)} />
          <div className="tl-speed-menu" style={{ left: speedMenu.left }}>
            {SPEED_OPTIONS.map((sp) => (
              <button
                key={sp}
                type="button"
                className={menuSegment.speed === sp ? 'tl-speed-option active' : 'tl-speed-option'}
                onClick={() => onSetSpeed(menuSegment.id, sp)}
              >
                {sp}x
              </button>
            ))}
          </div>
        </>
      ) : null}

      {selectedZoom && selectedZoomRange ? (
        <div
          className="tl-zoom-inspector"
          style={{
            left: clamp(
              PAD + outputTimeToPx(segments, metrics, selectedZoomRange.start),
              8,
              Math.max(8, width - 264),
            ),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="tl-zoom-inspector-head">
            <span>Zoom</span>
            <button type="button" className="tl-zoom-delete" onClick={() => onZoomDelete(selectedZoom.id)}>
              Delete
            </button>
          </div>
          <SliderRow
            label="Level"
            min={1}
            max={3}
            step={0.1}
            value={selectedZoom.level}
            display={(v) => `${v.toFixed(1)}x`}
            onValue={(v, phase) => onZoomLevel(selectedZoom.id, v, phase)}
          />
          <div className="control-row">
            <span className="control-label">Target</span>
            <Segmented
              options={[
                { value: 'follow-cursor', label: 'Follow cursor' },
                { value: 'fixed', label: 'Fixed' },
              ]}
              value={picking === selectedZoom.id ? 'fixed' : selectedZoom.target.mode}
              onChange={(mode) => onZoomMode(selectedZoom, mode)}
            />
          </div>
          {selectedZoom.target.mode === 'fixed' && picking !== selectedZoom.id ? (
            <div className="tl-zoom-fixed-note">
              ({selectedZoom.target.x.toFixed(2)}, {selectedZoom.target.y.toFixed(2)}) ·{' '}
              <button type="button" className="link-btn" onClick={() => setPickingZoom(selectedZoom.id)}>
                re-pick
              </button>
            </div>
          ) : null}
          {picking === selectedZoom.id ? (
            <div className="tl-zoom-fixed-note">Click the preview to set the target…</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
