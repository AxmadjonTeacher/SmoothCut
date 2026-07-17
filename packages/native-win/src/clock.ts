/**
 * Clock mapping between the addon's "nativeMs" domain
 * (QueryPerformanceCounter ms) and the main-process monotonic clock
 * (performance.timeOrigin + performance.now(), ms). The offset is fixed at
 * the "ready" handshake — same scheme as @smoothcut/native-mac's swiftMs.
 */

export function clockOffsetMs(mainMonotonicNowMs: number, readyNativeMs: number): number {
  return mainMonotonicNowMs - readyNativeMs;
}

export function nativeToMainMs(nativeMs: number, offsetMs: number): number {
  return nativeMs + offsetMs;
}

export function mainMonotonicNowMs(): number {
  return performance.timeOrigin + performance.now();
}
