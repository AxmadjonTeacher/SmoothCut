import { describe, expect, it } from 'vitest';
import type { ZoomConfig } from '@smoothcut/shared';
import type { VideoEvent } from '../time.js';
import { generateZoomSegments } from './generator.js';

const CONFIG: ZoomConfig = {
  defaultLevel: 2,
  smoothness: 0.5,
  leadSec: 0.9,
  holdSec: 1.4,
  clusterGapSec: 2.5,
};

function down(tSec: number, x = 0.5, y = 0.5): VideoEvent {
  return { tSec, type: 'down', x, y, button: 0 };
}

describe('generateZoomSegments', () => {
  it('returns nothing without clicks', () => {
    const events: VideoEvent[] = [{ tSec: 1, type: 'move', x: 0.5, y: 0.5 }];
    expect(generateZoomSegments(events, 10, CONFIG)).toEqual([]);
  });

  it('clusters clicks by gap and produces lead/hold windows', () => {
    const events = [down(1.0), down(1.5), down(5.5)];
    const segments = generateZoomSegments(events, 10, CONFIG);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.start).toBeCloseTo(0.1, 6);
    expect(segments[0]!.end).toBeCloseTo(2.9, 6);
    expect(segments[1]!.start).toBeCloseTo(4.6, 6);
    expect(segments[1]!.end).toBeCloseTo(6.9, 6);
  });

  it('fills segment metadata: id, level, follow-cursor target, auto origin', () => {
    const segments = generateZoomSegments([down(2)], 10, CONFIG);
    expect(segments).toHaveLength(1);
    const s = segments[0]!;
    expect(s.id).toBe('zoom-0');
    expect(s.level).toBe(CONFIG.defaultLevel);
    expect(s.target).toEqual({ mode: 'follow-cursor' });
    expect(s.origin).toBe('auto');
  });

  it('assigns sequential ids', () => {
    const segments = generateZoomSegments([down(1), down(6), down(12)], 20, CONFIG);
    expect(segments.map((s) => s.id)).toEqual(['zoom-0', 'zoom-1', 'zoom-2']);
  });

  it('clamps to the video bounds', () => {
    const segments = generateZoomSegments([down(0.2), down(9.9)], 10, CONFIG);
    expect(segments[0]!.start).toBe(0);
    expect(segments[segments.length - 1]!.end).toBe(10);
  });

  it('merges segments closer than 1s', () => {
    // clusters {1.0} and {4.0}: [0.1, 2.4] and [3.1, 5.4] → gap 0.7 < 1 → merged
    const segments = generateZoomSegments([down(1.0), down(4.0)], 10, CONFIG);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.start).toBeCloseTo(0.1, 6);
    expect(segments[0]!.end).toBeCloseTo(5.4, 6);
    expect(segments[0]!.id).toBe('zoom-0');
  });

  it('does not merge segments with a gap >= 1s', () => {
    // clusters {1.0} and {4.8}: [0.1, 2.4] and [3.9, 6.2] → gap 1.5 → kept apart
    const segments = generateZoomSegments([down(1.0), down(4.8)], 10, CONFIG);
    expect(segments).toHaveLength(2);
  });

  it('drops drag-select clusters (bbox diagonal > 0.6)', () => {
    const drag = [down(1.0, 0.1, 0.1), down(1.4, 0.9, 0.8)];
    expect(generateZoomSegments(drag, 10, CONFIG)).toEqual([]);
    // a tight cluster survives
    const tight = [down(1.0, 0.5, 0.5), down(1.4, 0.52, 0.55)];
    expect(generateZoomSegments(tight, 10, CONFIG)).toHaveLength(1);
  });

  it('drops drag clusters without disturbing neighboring ids', () => {
    const events = [down(1.0, 0.5, 0.5), down(6.0, 0.05, 0.05), down(6.3, 0.95, 0.95), down(12, 0.4, 0.4)];
    const segments = generateZoomSegments(events, 20, CONFIG);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.id)).toEqual(['zoom-0', 'zoom-1']);
    expect(segments[1]!.start).toBeCloseTo(11.1, 6);
  });

  it('handles unsorted click input', () => {
    const segments = generateZoomSegments([down(5.5), down(1.0), down(1.5)], 10, CONFIG);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.start).toBeCloseTo(0.1, 6);
  });
});
