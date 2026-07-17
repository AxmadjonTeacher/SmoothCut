'use client';

import { useEffect, useState } from 'react';
import { DEVELOPER_URL } from '@/lib/links';

/** True once the page has scrolled past `threshold`, updated on rAF-throttled scroll. */
function useScrolled(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;

    const update = () => {
      setScrolled(window.scrollY > threshold);
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return scrolled;
}

export function SiteHeader() {
  const scrolled = useScrolled(24);

  return (
    <div className={`site-header-wrap${scrolled ? ' scrolled' : ''}`}>
      <div className="site-header-inner">
        <a href="/" className="brand">
          <img src="/icon.png" alt="" width={28} height={28} />
          SmoothCut
        </a>
        <nav className="site-nav">
          <a href="#features">Features</a>
          <a href={DEVELOPER_URL} target="_blank" rel="noreferrer">
            Developer
          </a>
        </nav>
      </div>
    </div>
  );
}
