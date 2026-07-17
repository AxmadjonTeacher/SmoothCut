import type { SmoothcutApi } from '@smoothcut/shared';

declare global {
  interface Window {
    smoothcut: SmoothcutApi;
  }
}

export {};
