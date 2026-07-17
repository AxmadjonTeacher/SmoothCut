import { describe, expect, it } from 'vitest';
import { clockOffsetMs, swiftToMainMs } from './clock.js';

describe('clock offset math', () => {
  it('offset maps the ready swiftMs exactly onto the main clock instant', () => {
    const mainNow = 1_700_000_123_456.789;
    const readySwiftMs = 98_765.432;
    const offset = clockOffsetMs(mainNow, readySwiftMs);
    expect(swiftToMainMs(readySwiftMs, offset)).toBeCloseTo(mainNow, 6);
  });

  it('preserves durations between swift timestamps', () => {
    const mainNow = 5_000_000;
    const readySwiftMs = 1_000;
    const offset = clockOffsetMs(mainNow, readySwiftMs);
    const laterSwiftMs = 1_016.6667;
    expect(swiftToMainMs(laterSwiftMs, offset) - swiftToMainMs(readySwiftMs, offset)).toBeCloseTo(
      16.6667,
      6,
    );
  });

  it('handles a swift clock that started before the main process', () => {
    // swiftMs is machine uptime, which can be far larger than the offset target.
    const mainNow = 10_000;
    const readySwiftMs = 9_999_999;
    const offset = clockOffsetMs(mainNow, readySwiftMs);
    expect(offset).toBeLessThan(0);
    expect(swiftToMainMs(10_000_499, offset)).toBeCloseTo(10_500, 6);
  });
});
