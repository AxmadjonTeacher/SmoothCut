/**
 * Typed view of the smoothcut-native-win event protocol (one JSON object per
 * napi callback invocation). Identical to the mac recorder's stdout protocol
 * except the native clock field is `nativeMs` (QueryPerformanceCounter ms)
 * instead of `swiftMs`.
 */

export interface ReadyEvent {
  event: 'ready';
  nativeMs: number;
}

export interface FirstFrameEvent {
  event: 'firstFrame';
  nativeMs: number;
  ptsSec: number;
}

export interface CursorShapeEvent {
  event: 'cursorShape';
  nativeMs: number;
  shapeId: string;
  hotspotX: number;
  hotspotY: number;
  w: number;
  h: number;
}

export interface StatsEvent {
  event: 'stats';
  frames: number;
  dropped: number;
}

export interface StoppedEvent {
  event: 'stopped';
  durationMs: number;
}

export interface RecorderErrorEvent {
  event: 'error';
  message: string;
}

export type RecorderEvent =
  | ReadyEvent
  | FirstFrameEvent
  | CursorShapeEvent
  | StatsEvent
  | StoppedEvent
  | RecorderErrorEvent;

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Parse one event line. Invalid JSON, unknown events, and malformed payloads all yield null. */
export function parseRecorderLine(line: string): RecorderEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  switch (obj['event']) {
    case 'ready':
      return num(obj['nativeMs']) ? { event: 'ready', nativeMs: obj['nativeMs'] } : null;
    case 'firstFrame':
      return num(obj['nativeMs']) && num(obj['ptsSec'])
        ? { event: 'firstFrame', nativeMs: obj['nativeMs'], ptsSec: obj['ptsSec'] }
        : null;
    case 'cursorShape':
      return num(obj['nativeMs']) &&
        typeof obj['shapeId'] === 'string' &&
        num(obj['hotspotX']) &&
        num(obj['hotspotY']) &&
        num(obj['w']) &&
        num(obj['h'])
        ? {
            event: 'cursorShape',
            nativeMs: obj['nativeMs'],
            shapeId: obj['shapeId'],
            hotspotX: obj['hotspotX'],
            hotspotY: obj['hotspotY'],
            w: obj['w'],
            h: obj['h'],
          }
        : null;
    case 'stats':
      return num(obj['frames']) && num(obj['dropped'])
        ? { event: 'stats', frames: obj['frames'], dropped: obj['dropped'] }
        : null;
    case 'stopped':
      return num(obj['durationMs']) ? { event: 'stopped', durationMs: obj['durationMs'] } : null;
    case 'error':
      return typeof obj['message'] === 'string' ? { event: 'error', message: obj['message'] } : null;
    default:
      return null;
  }
}
