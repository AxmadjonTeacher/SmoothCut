/**
 * Click-through countdown overlay (?view=countdown): a transparent
 * always-on-top window on the capture display, opened by the recording
 * session during the countdown and closed when recording starts (or the
 * countdown is cancelled). Purely presentational — it follows the
 * 'recording:status' pushes and never handles input (the window has
 * setIgnoreMouseEvents(true)).
 */
import { useEffect, useState } from 'react';
import './countdown.css';

const sc = window.smoothcut;

const RING_R = 84;
const RING_C = 2 * Math.PI * RING_R;

export default function CountdownRoot() {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    // Transparent window — the page must not paint a background.
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, []);

  useEffect(() => {
    let disposed = false;
    void sc
      .invoke('recording:status')
      .then((s) => {
        if (!disposed && s.state === 'countdown' && s.countdownRemaining !== undefined) {
          setRemaining(s.countdownRemaining);
        }
      })
      .catch(() => {});
    const off = sc.on('recording:status', (s) => {
      if (s.state === 'countdown' && s.countdownRemaining !== undefined) {
        setRemaining(s.countdownRemaining);
      }
    });
    return () => {
      disposed = true;
      off();
    };
  }, []);

  if (remaining === null) return null;
  const num = Math.max(1, Math.ceil(remaining));

  return (
    <div className="cd-overlay">
      <div className="cd-badge">
        <svg className="cd-ring" width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
          <circle className="cd-ring-track" cx="100" cy="100" r={RING_R} />
          <circle
            key={num}
            className="cd-ring-fill"
            cx="100"
            cy="100"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={0}
            style={{ ['--ring-c' as never]: `${RING_C}px` }}
          />
        </svg>
        <div key={`n${num}`} className="cd-num">
          {num}
        </div>
        <div className="cd-label">starting…</div>
      </div>
    </div>
  );
}
