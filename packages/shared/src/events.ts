/**
 * Input-event log contract (`recording/events.jsonl` — one JSON object per line,
 * streamed to disk during recording so a crash never loses telemetry).
 *
 * - `t` is milliseconds since `RecordingMeta.clocks.eventsEpoch`.
 * - `x`/`y` are UNIT coordinates (0..1) relative to the capture rect,
 *   DPI-normalized at write time. Values may fall outside 0..1 when the
 *   pointer leaves the capture area — consumers must clamp where relevant.
 * - `cursorShape` events reference `recording/cursors/<shapeId>.png`;
 *   `hotspot` is in pixels of that image.
 */

export type MouseButton = 0 | 1 | 2;

export interface MoveEvent {
  t: number;
  type: 'move';
  x: number;
  y: number;
}

export interface ButtonEvent {
  t: number;
  type: 'down' | 'up';
  x: number;
  y: number;
  button: MouseButton;
}

export interface WheelEvent {
  t: number;
  type: 'wheel';
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface KeyEvent {
  t: number;
  type: 'key';
  keycode: number;
}

export interface CursorShapeEvent {
  t: number;
  type: 'cursorShape';
  shapeId: string;
  hotspot: { x: number; y: number };
  sizePx: { w: number; h: number };
}

export type InputEvent = MoveEvent | ButtonEvent | WheelEvent | KeyEvent | CursorShapeEvent;

export function serializeEvent(event: InputEvent): string {
  return JSON.stringify(event);
}

/** Parse a full events.jsonl payload. Skips malformed lines (e.g. a torn final line after a crash). */
export function parseEventsJsonl(text: string): InputEvent[] {
  const events: InputEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as InputEvent;
      if (typeof parsed.t === 'number' && typeof parsed.type === 'string') {
        events.push(parsed);
      }
    } catch {
      // torn line — ignore
    }
  }
  return events;
}

export function isPointerEvent(e: InputEvent): e is MoveEvent | ButtonEvent | WheelEvent {
  return e.type === 'move' || e.type === 'down' || e.type === 'up' || e.type === 'wheel';
}
