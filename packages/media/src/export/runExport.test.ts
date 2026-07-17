import { describe, expect, it } from 'vitest';
import { iterateOutputFrames, totalOutputFrames } from './runExport.js';

interface SpeedSegment {
  sourceStart: number;
  sourceEnd: number;
  speed: number;
}

/** Output timeline = concatenation of source segments, each shrunk by its speed. */
function segmentMapper(segments: SpeedSegment[]): (tOut: number) => number | null {
  return (tOut) => {
    let outCursor = 0;
    for (const segment of segments) {
      const outDuration = (segment.sourceEnd - segment.sourceStart) / segment.speed;
      if (tOut < outCursor + outDuration) {
        return segment.sourceStart + (tOut - outCursor) * segment.speed;
      }
      outCursor += outDuration;
    }
    return null;
  };
}

describe('totalOutputFrames', () => {
  it('rounds duration * fps', () => {
    expect(totalOutputFrames(2, 30)).toBe(60);
    expect(totalOutputFrames(1.5, 60)).toBe(90);
    expect(totalOutputFrames(0, 60)).toBe(0);
  });

  it('never returns a negative count', () => {
    expect(totalOutputFrames(-1, 30)).toBe(0);
  });
});

describe('iterateOutputFrames', () => {
  it('maps every frame at 1x speed', () => {
    const plans = [...iterateOutputFrames((t) => t, 0.5, 30)];
    expect(plans.length).toBe(15);
    expect(plans[0]).toEqual({ frameIndex: 0, tOutputSec: 0, tSourceSec: 0 });
    expect(plans[9]?.tOutputSec).toBeCloseTo(0.3, 9);
    expect(plans[9]?.tSourceSec).toBeCloseTo(0.3, 9);
  });

  it('yields null source times inside cuts', () => {
    // Source [0,1) and [2,3) kept, the middle second removed.
    const map = segmentMapper([
      { sourceStart: 0, sourceEnd: 1, speed: 1 },
      { sourceStart: 2, sourceEnd: 3, speed: 1 },
    ]);
    const plans = [...iterateOutputFrames(map, 2, 10)];
    expect(plans.length).toBe(20);
    expect(plans[5]?.tSourceSec).toBeCloseTo(0.5, 9);
    // First frame after the cut jumps to source t=2.
    expect(plans[10]?.tSourceSec).toBeCloseTo(2, 9);
    expect(plans[19]?.tSourceSec).toBeCloseTo(2.9, 9);
  });

  it('skips frames past the mapped region (trailing cut)', () => {
    const map = segmentMapper([{ sourceStart: 0, sourceEnd: 1, speed: 1 }]);
    const plans = [...iterateOutputFrames(map, 1.5, 10)];
    expect(plans.length).toBe(15);
    expect(plans[9]?.tSourceSec).toBeCloseTo(0.9, 9);
    for (const plan of plans.slice(10)) {
      expect(plan.tSourceSec).toBeNull();
    }
  });

  it('advances source time faster through speed segments', () => {
    // 1s at 1x, then 2s of source at 2x (1s of output) → 2s output total.
    const map = segmentMapper([
      { sourceStart: 0, sourceEnd: 1, speed: 1 },
      { sourceStart: 1, sourceEnd: 3, speed: 2 },
    ]);
    const plans = [...iterateOutputFrames(map, 2, 10)];
    expect(plans.length).toBe(20);
    expect(plans[5]?.tSourceSec).toBeCloseTo(0.5, 9);
    expect(plans[10]?.tSourceSec).toBeCloseTo(1, 9);
    expect(plans[15]?.tSourceSec).toBeCloseTo(2, 9);
    expect(plans[19]?.tSourceSec).toBeCloseTo(2.8, 9);
  });

  it('repeats source times for slow-motion segments', () => {
    // 0.5s of source at 0.5x → 1s of output; consecutive frames advance by half.
    const map = segmentMapper([{ sourceStart: 0, sourceEnd: 0.5, speed: 0.5 }]);
    const plans = [...iterateOutputFrames(map, 1, 10)];
    expect(plans.length).toBe(10);
    expect(plans[2]?.tSourceSec).toBeCloseTo(0.1, 9);
    expect(plans[3]?.tSourceSec).toBeCloseTo(0.15, 9);
  });

  it('indexes output frames on the fps grid', () => {
    const plans = [...iterateOutputFrames((t) => t, 1, 60)];
    for (const plan of plans) {
      expect(plan.tOutputSec).toBeCloseTo(plan.frameIndex / 60, 12);
    }
  });
});
