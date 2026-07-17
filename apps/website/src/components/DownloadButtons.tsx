'use client';

import { DOWNLOAD_LINKS } from '@/lib/links';
import { useDetectedOs } from '@/lib/useDetectedOs';

const APPLE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.365 1.43c0 1.14-.415 2.06-1.244 2.76-.83.7-1.83 1.06-3.005.97-.06-1.1.4-2.02 1.23-2.75.79-.72 1.79-1.11 2.99-1.16.02.06.03.12.03.18zM20.6 17.2c-.4.93-.88 1.79-1.44 2.6-.77 1.1-1.7 2.47-2.85 2.5-1.02.03-1.32-.66-2.75-.66s-1.78.63-2.73.68c-1.11.05-1.95-1.19-2.73-2.28-1.49-2.1-2.62-5.94-1.1-8.53.75-1.29 2.1-2.1 3.55-2.12 1.05-.02 2.04.71 2.68.71.64 0 1.84-.87 3.1-.74.53.02 2 .21 2.95 1.6-.08.05-1.76 1.03-1.74 3.06.02 2.43 2.13 3.24 2.15 3.25-.02.07-.34 1.16-1.09 2.93z" />
  </svg>
);

const WINDOWS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 5.5 10.5 4.4v7.2H3V5.5zm8.4-1.2L21 3v8.6h-9.6V4.3zM3 12.6h7.5v7.1L3 18.5v-5.9zm8.4 0H21V21l-9.6-1.4v-7z" />
  </svg>
);

/** Both platforms have real releases now — highlights whichever OS the visitor is on. */
export function DownloadButtons() {
  const os = useDetectedOs();
  const macFirst = os !== 'windows';

  const macButton = (
    <a key="mac" href={DOWNLOAD_LINKS.mac} className={`dl-btn ${macFirst ? 'primary' : ''}`}>
      {APPLE_ICON}
      <span>
        Download for Mac
        <small>Apple Silicon · macOS 13+</small>
      </span>
    </a>
  );

  const winButton = (
    <a key="win" href={DOWNLOAD_LINKS.windows} className={`dl-btn ${macFirst ? '' : 'primary'}`}>
      {WINDOWS_ICON}
      <span>
        Download for Windows
        <small>Windows 10/11 · 64-bit</small>
      </span>
    </a>
  );

  return (
    <div className="hero-actions">
      <div className="download-row">{macFirst ? [macButton, winButton] : [winButton, macButton]}</div>
      <p className="dl-meta">
        Free, no account. Built on{' '}
        <a href="https://github.com/AxmadjonTeacher/SmoothCut" target="_blank" rel="noreferrer">
          GitHub Releases
        </a>
        .
      </p>
    </div>
  );
}
