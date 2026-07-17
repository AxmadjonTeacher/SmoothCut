import { describe, expect, it } from 'vitest';
import type { InputEvent, RecordingMeta } from '@smoothcut/shared';
import { prepareEvents } from './time.js';

function makeMeta(overrides?: Partial<RecordingMeta>): RecordingMeta {
  return {
    schemaVersion: 1,
    platform: 'darwin',
    createdAt: '2026-07-16T00:00:00.000Z',
    capture: {
      widthPx: 1920,
      heightPx: 1080,
      fps: 60,
      scaleFactor: 2,
      source: { kind: 'display', displayId: 'd0' },
    },
    displays: [],
    clocks: { screenFirstFrame: 1500, eventsEpoch: 1000 },
    durationMs: 10_000,
    ...overrides,
  };
}

describe('prepareEvents', () => {
  it('applies the clock formula (eventsEpoch + t - screenFirstFrame) / 1000', () => {
    const meta = makeMeta();
    const events: InputEvent[] = [{ t: 600, type: 'move', x: 0.5, y: 0.5 }];
    const out = prepareEvents(events, meta);
    expect(out).toHaveLength(1);
    expect(out[0]!.tSec).toBeCloseTo(0.1, 10);
    expect(out[0]!.type).toBe('move');
  });

  it('preserves the per-variant payload and drops t', () => {
    const meta = makeMeta();
    const events: InputEvent[] = [
      { t: 500, type: 'down', x: 0.25, y: 0.75, button: 0 },
      { t: 600, type: 'wheel', x: 0.1, y: 0.2, dx: 3, dy: -4 },
      { t: 700, type: 'key', keycode: 42 },
      {
        t: 800,
        type: 'cursorShape',
        shapeId: 'ibeam',
        hotspot: { x: 4, y: 9 },
        sizePx: { w: 18, h: 24 },
      },
    ];
    const out = prepareEvents(events, meta);
    expect(out).toHaveLength(4);
    const down = out[0]!;
    expect(down.type).toBe('down');
    if (down.type === 'down') {
      expect(down.button).toBe(0);
      expect(down.x).toBe(0.25);
    }
    expect(out.every((e) => !('t' in e))).toBe(true);
    const shape = out[3]!;
    if (shape.type === 'cursorShape') {
      expect(shape.shapeId).toBe('ibeam');
      expect(shape.hotspot).toEqual({ x: 4, y: 9 });
    }
  });

  it('sorts by tSec', () => {
    const meta = makeMeta();
    const events: InputEvent[] = [
      { t: 900, type: 'move', x: 0, y: 0 },
      { t: 100, type: 'move', x: 1, y: 1 },
      { t: 500, type: 'move', x: 0.5, y: 0.5 },
    ];
    const out = prepareEvents(events, meta);
    expect(out.map((e) => e.tSec)).toEqual([...out.map((e) => e.tSec)].sort((a, b) => a - b));
  });

  it('drops events before -0.5s and after duration + 0.5s', () => {
    const meta = makeMeta(); // offset = -500ms, duration 10s
    const events: InputEvent[] = [
      { t: -1, type: 'move', x: 0, y: 0 }, // tSec = -0.501 → dropped
      { t: 0, type: 'move', x: 0, y: 0 }, // tSec = -0.5   → kept
      { t: 11_000, type: 'move', x: 0, y: 0 }, // tSec = 10.5 → kept
      { t: 11_001, type: 'move', x: 0, y: 0 }, // tSec = 10.501 → dropped
    ];
    const out = prepareEvents(events, meta);
    expect(out).toHaveLength(2);
    expect(out[0]!.tSec).toBeCloseTo(-0.5, 10);
    expect(out[1]!.tSec).toBeCloseTo(10.5, 10);
  });

  it('handles an empty log', () => {
    expect(prepareEvents([], makeMeta())).toEqual([]);
  });
});
