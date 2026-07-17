/**
 * The shared "monotonic ms" clock every stream is timestamped on:
 * main-process performance.timeOrigin + performance.now(). All native
 * recorder callbacks already report on this clock.
 */
export function nowMonotonicMs(): number {
  return performance.timeOrigin + performance.now();
}
