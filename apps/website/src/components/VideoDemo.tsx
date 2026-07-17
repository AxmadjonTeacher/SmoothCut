'use client';

import { useState } from 'react';

const PLAY_ICON = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13l11-6.5-11-6.5z" />
  </svg>
);

/**
 * Drop the real product demo at public/demo.mp4 (record one with SmoothCut
 * itself) and public/demo-poster.png — this stays a clean gradient
 * placeholder with no fake footage until then.
 */
export function VideoDemo() {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="demo-frame">
      {playing ? (
        <video src="/demo.mp4" controls autoPlay poster="/demo-poster.png" />
      ) : (
        <button
          type="button"
          className="demo-placeholder"
          onClick={() => setPlaying(true)}
          aria-label="Play demo video"
        >
          <span className="demo-play">{PLAY_ICON}</span>
          <span className="demo-placeholder-label">Watch SmoothCut in action</span>
        </button>
      )}
    </div>
  );
}
