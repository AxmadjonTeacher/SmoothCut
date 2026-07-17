import type { InputEvent, RecordingMeta } from '@smoothcut/shared';

type OnVideoTimeline<E> = E extends { t: number } ? Omit<E, 't'> & { tSec: number } : never;

/**
 * A recorded input event re-based onto the VIDEO timeline: same shape as the
 * shared `InputEvent` variants, but with `tSec` (seconds relative to the first
 * screen frame) instead of `t` (ms since `clocks.eventsEpoch`).
 */
export type VideoEvent = OnVideoTimeline<InputEvent>;

/**
 * Places every event on the video timeline using
 * `tVideoSec = (clocks.eventsEpoch + e.t - clocks.screenFirstFrame) / 1000`,
 * sorts by `tSec`, and drops events outside [-0.5s, duration + 0.5s].
 */
export function prepareEvents(events: InputEvent[], meta: RecordingMeta): VideoEvent[] {
  const durationSec = meta.durationMs / 1000;
  // Both clocks live on the shared monotonic-ms domain; their difference is a
  // constant offset from the events clock to video time zero.
  const offsetMs = meta.clocks.eventsEpoch - meta.clocks.screenFirstFrame;
  const out: VideoEvent[] = [];
  for (const e of events) {
    const tSec = (offsetMs + e.t) / 1000;
    if (tSec < -0.5 || tSec > durationSec + 0.5) continue;
    const { t: _t, ...rest } = e;
    out.push({ ...rest, tSec } as VideoEvent);
  }
  out.sort((a, b) => a.tSec - b.tSec);
  return out;
}
