/**
 * Area-capture drag-select overlay (?view=area-picker&displayId=...): a
 * full-screen transparent window on the target display. Crosshair guides
 * follow the cursor; dragging draws a marching-ants rect with a physical-px
 * dimensions readout. Esc cancels, mouse-up / Enter confirms. The result goes
 * back to main over the 'area:picked' invoke channel in LOGICAL points
 * relative to this display (CSS px of this fullscreen window).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Rect } from '@smoothcut/shared';
import './area.css';

const sc = window.smoothcut;

/** Selections smaller than this (in points) are treated as an accidental click. */
const MIN_SIZE_PT = 8;

interface DragState {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

function dragRect(d: DragState): Rect {
  return {
    x: Math.min(d.startX, d.x),
    y: Math.min(d.startY, d.y),
    width: Math.abs(d.x - d.startX),
    height: Math.abs(d.y - d.startY),
  };
}

export default function AreaPickerRoot() {
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const doneRef = useRef(false);

  const finish = useCallback((rect: Rect | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    void sc.invoke('area:picked', rect).catch(() => {
      // Main gone — the window is about to close anyway.
    });
  }, []);

  const confirm = useCallback(
    (d: DragState | null) => {
      const rect = d ? dragRect(d) : null;
      if (rect && rect.width >= MIN_SIZE_PT && rect.height >= MIN_SIZE_PT) {
        finish(rect);
      } else {
        setDrag(null); // too small — keep picking
      }
    },
    [finish],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter') confirm(drag);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, confirm, drag]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    setMouse({ x: e.clientX, y: e.clientY });
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
  };
  const onPointerUp = (): void => {
    if (drag) confirm(drag);
  };

  const rect = drag ? dragRect(drag) : null;
  const dpr = window.devicePixelRatio || 1;
  // Physical px, even-floored — exactly what main will record.
  const physW = rect ? Math.max(0, Math.floor((rect.width * dpr) / 2) * 2) : 0;
  const physH = rect ? Math.max(0, Math.floor((rect.height * dpr) / 2) * 2) : 0;

  // Readout goes below the rect unless it would fall off-screen.
  const readoutBelow = rect ? rect.y + rect.height + 34 < window.innerHeight : true;

  return (
    <div
      className="area-picker"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {rect ? (
        <>
          {/* Dim everything around the selection (the rect itself stays clear). */}
          <div
            className="area-rect"
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          >
            <div
              className="area-readout"
              style={readoutBelow ? { top: '100%', marginTop: 8 } : { bottom: '100%', marginBottom: 8 }}
            >
              {physW} × {physH} px
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="area-dim" />
          {mouse ? (
            <>
              <div className="area-cross-v" style={{ left: mouse.x }} />
              <div className="area-cross-h" style={{ top: mouse.y }} />
            </>
          ) : null}
          <div className="area-hint">
            Drag to select an area to record — <kbd>Esc</kbd> to cancel
          </div>
        </>
      )}
    </div>
  );
}
