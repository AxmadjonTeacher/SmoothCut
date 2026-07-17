/**
 * Clock mapping between the recorder's "swiftMs" domain (CLOCK_UPTIME_RAW ms)
 * and the main-process monotonic clock (performance.timeOrigin +
 * performance.now(), ms). The offset is fixed at the "ready" handshake.
 */

export function clockOffsetMs(mainMonotonicNowMs: number, readySwiftMs: number): number {
  return mainMonotonicNowMs - readySwiftMs;
}

export function swiftToMainMs(swiftMs: number, offsetMs: number): number {
  return swiftMs + offsetMs;
}

export function mainMonotonicNowMs(): number {
  return performance.timeOrigin + performance.now();
}
