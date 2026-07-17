/**
 * Floating in-recording control pill (?view=recording-pill): a tiny
 * always-on-top window at the top-center of the recorded display with the
 * primary Stop button, a locally-ticking elapsed clock (re-anchored on every
 * 'recording:status' push), and a subtle discard button. The window itself is
 * excluded from screen capture (see session.ts excludeWindowIds).
 */
import { useEffect, useState } from 'react';
import type { RecordingStatus } from '@smoothcut/shared';
import { formatDuration } from '../recorder/format';
import './recording.css';

const sc = window.smoothcut;

/** Locally-ticking elapsed time, re-anchored on every status push from main. */
function useElapsedMs(status: RecordingStatus): number {
  const [ms, setMs] = useState(status.elapsedMs);
  useEffect(() => {
    setMs(status.elapsedMs);
    if (status.state !== 'recording') return;
    const startedAt = Date.now() - status.elapsedMs;
    const id = setInterval(() => setMs(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [status]);
  return ms;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2.5 3.5h9M5.5 3.5V2.25h3V3.5M4 3.5l.6 8a1 1 0 0 0 1 .95h2.8a1 1 0 0 0 1-.95l.6-8M5.9 6v4M8.1 6v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function RecordingPillRoot() {
  const [status, setStatus] = useState<RecordingStatus>({ state: 'recording', elapsedMs: 0 });
  const [busy, setBusy] = useState(false);
  const elapsedMs = useElapsedMs(status);

  useEffect(() => {
    void sc
      .invoke('recording:status')
      .then(setStatus)
      .catch(() => {});
    return sc.on('recording:status', setStatus);
  }, []);

  const stopping = status.state === 'stopping' || busy;

  const stop = (): void => {
    setBusy(true);
    void sc.invoke('recording:stop').catch(() => setBusy(false));
  };
  const discard = (): void => {
    setBusy(true);
    void sc.invoke('recording:cancel').catch(() => setBusy(false));
  };

  return (
    <div className="rp-pill">
      <button
        type="button"
        className="rp-stop"
        aria-label="Stop recording"
        title="Stop and save"
        disabled={stopping}
        onClick={stop}
      >
        <span className="rp-stop-square" />
      </button>
      <span className="rp-time">
        {status.state === 'stopping' ? 'Saving…' : formatDuration(elapsedMs)}
      </span>
      <button
        type="button"
        className="rp-discard"
        aria-label="Discard recording"
        title="Discard recording"
        disabled={stopping}
        onClick={discard}
      >
        <TrashIcon />
      </button>
    </div>
  );
}
