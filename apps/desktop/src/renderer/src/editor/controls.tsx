/**
 * Small form controls shared by the sidebar and inspectors.
 *
 * SliderRow implements the "one undo entry per drag" contract: every input
 * event reports phase 'preview' (gesture preview), releasing the pointer (or
 * key/blur) reports 'commit'.
 */
import { useCallback, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { beginGesture } from './store';

export type SliderPhase = 'preview' | 'commit';

interface SliderRowProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display?: (v: number) => string;
  onValue: (v: number, phase: SliderPhase) => void;
}

export function SliderRow({ label, min, max, step, value, display, onValue }: SliderRowProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  const preview = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      // First input of this drag: pin the gesture base to the CURRENT
      // project, never a leftover from an earlier uncommitted gesture.
      if (dragRef.current === null) beginGesture();
      dragRef.current = v;
      setDragValue(v);
      onValue(v, 'preview');
    },
    [onValue],
  );

  const commit = useCallback(() => {
    if (dragRef.current === null) return;
    const v = dragRef.current;
    dragRef.current = null;
    setDragValue(null);
    onValue(v, 'commit');
  }, [onValue]);

  const shown = dragValue ?? value;
  return (
    <label className="control-row">
      <span className="control-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={preview}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="control-value">{display ? display(shown) : String(shown)}</span>
    </label>
  );
}

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <label className="control-row toggle-row">
      <span className="control-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          className={opt.value === value ? 'segmented-btn active' : 'segmented-btn'}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
