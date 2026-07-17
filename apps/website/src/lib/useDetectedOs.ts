'use client';

import { useEffect, useState } from 'react';

export type DetectedOs = 'mac' | 'windows' | 'other';

function detectOs(): DetectedOs {
  const platform = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (platform.includes('mac')) return 'mac';
  if (platform.includes('win')) return 'windows';
  return 'other';
}

/** Returns null during SSR/before hydration, then the detected OS on mount. */
export function useDetectedOs(): DetectedOs | null {
  const [os, setOs] = useState<DetectedOs | null>(null);

  useEffect(() => {
    setOs(detectOs());
  }, []);

  return os;
}
