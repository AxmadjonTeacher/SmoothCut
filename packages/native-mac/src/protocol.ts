/** Typed view of the smoothcut-recorder stdout protocol (one JSON per line). */

export interface ReadyEvent {
  event: 'ready';
  swiftMs: number;
}

export interface FirstFrameEvent {
  event: 'firstFrame';
  swiftMs: number;
  ptsSec: number;
}

export interface CursorShapeEvent {
  event: 'cursorShape';
  swiftMs: number;
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

/** Parse one stdout line. Torn/invalid JSON, unknown events, and malformed payloads all yield null. */
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
      return num(obj['swiftMs']) ? { event: 'ready', swiftMs: obj['swiftMs'] } : null;
    case 'firstFrame':
      return num(obj['swiftMs']) && num(obj['ptsSec'])
        ? { event: 'firstFrame', swiftMs: obj['swiftMs'], ptsSec: obj['ptsSec'] }
        : null;
    case 'cursorShape':
      return num(obj['swiftMs']) &&
        typeof obj['shapeId'] === 'string' &&
        num(obj['hotspotX']) &&
        num(obj['hotspotY']) &&
        num(obj['w']) &&
        num(obj['h'])
        ? {
            event: 'cursorShape',
            swiftMs: obj['swiftMs'],
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

/** Reassembles complete lines from arbitrarily-chunked stream data. */
export function createLineSplitter(onLine: (line: string) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let buffer = '';
  return {
    push(chunk: string): void {
      buffer += chunk;
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        onLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
      }
    },
    flush(): void {
      if (buffer) {
        onLine(buffer);
        buffer = '';
      }
    },
  };
}
