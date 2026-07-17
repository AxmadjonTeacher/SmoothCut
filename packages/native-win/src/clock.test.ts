import { describe, expect, it } from 'vitest';
import { clockOffsetMs, nativeToMainMs } from './clock.js';

describe('clock offset math', () => {
  it('offset maps the ready nativeMs exactly onto the main clock instant', () => {
    const mainNow = 1_700_000_123_456.789;
    const readyNativeMs = 98_765.432;
    const offset = clockOffsetMs(mainNow, readyNativeMs);
    expect(nativeToMainMs(readyNativeMs, offset)).toBeCloseTo(mainNow, 6);
  });

  it('preserves durations between native timestamps', () => {
    const mainNow = 5_000_000;
    const readyNativeMs = 1_000;
    const offset = clockOffsetMs(mainNow, readyNativeMs);
    const laterNativeMs = 1_016.6667;
    expect(nativeToMainMs(laterNativeMs, offset) - nativeToMainMs(readyNativeMs, offset)).toBeCloseTo(
      16.6667,
      6,
    );
  });

  it('handles a QPC clock that started before the main process', () => {
    // nativeMs is machine uptime, which can be far larger than the offset target.
    const mainNow = 10_000;
    const readyNativeMs = 9_999_999;
    const offset = clockOffsetMs(mainNow, readyNativeMs);
    expect(offset).toBeLessThan(0);
    expect(nativeToMainMs(10_000_499, offset)).toBeCloseTo(10_500, 6);
  });
});
