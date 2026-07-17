import type { ReactNode } from 'react';
import { DownloadButtons } from '@/components/DownloadButtons';
import { SiteHeader } from '@/components/SiteHeader';
import { VideoDemo } from '@/components/VideoDemo';
import { REPO_URL } from '@/lib/links';

interface Feature {
  title: string;
  body: string;
  icon: ReactNode;
}

const FEATURES: Feature[] = [
  {
    title: 'Auto-zoom on clicks',
    body: 'Every click gets a smooth, automatic zoom-in. No manual keyframing, no timeline fiddling.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'A natural cursor',
    body: 'A spring-smoothed synthetic cursor replaces the jittery OS pointer, deterministically, every time.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 3l6 16 2.5-6.5L20 10 5 3z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Styled backgrounds',
    body: 'Frame your recording with a polished gradient or wallpaper background in one click.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M3 15l5-5 4 4 4-6 5 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Instant export',
    body: 'Your video streams to disk as it renders — no waiting on a progress bar for a long recording.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Completely free',
    body: 'No account, no watermark, no export limits. Ever.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path
          d="M12 21s-7.5-4.6-9.7-9.1C.6 8.4 2.2 5 5.6 5c2 0 3.4 1.2 4.4 2.6C11 6.2 12.4 5 14.4 5c3.4 0 5 3.4 3.3 6.9C19.5 16.4 12 21 12 21z"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: 'macOS & Windows',
    body: 'Native, low-overhead screen capture on both platforms — the same polished result either way.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <section className="hero wrap">
        <div className="hero-glow" />
        <span className="eyebrow">
          <strong>Free</strong>
          &nbsp;· macOS &amp; Windows
        </span>
        <h1>
          Record your screen. <span className="accent">It's automatically beautiful.</span>
        </h1>
        <p className="hero-sub">
          SmoothCut captures your screen, then deterministically adds auto-zoom on clicks, a
          smooth synthetic cursor, and a styled background — no editing required.
        </p>
        <DownloadButtons />
      </section>

      <div className="demo-shell">
        <VideoDemo />
      </div>

      <section className="section wrap" id="features">
        <div className="section-head">
          <h2>Every recording, polished automatically</h2>
          <p>Capture is just pixels and a mouse-telemetry log — everything else is deterministic post-processing.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta wrap">
        <h2>Try it in under a minute.</h2>
        <p>No sign-up. No watermark. No catch.</p>
        <DownloadButtons />
      </section>

      <footer className="site-footer wrap">
        <span>© {new Date().getFullYear()} SmoothCut</span>
        <div className="footer-links">
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
            Releases
          </a>
        </div>
      </footer>
    </>
  );
}
