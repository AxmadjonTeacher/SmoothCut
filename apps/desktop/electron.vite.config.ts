import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@smoothcut/shared', '@smoothcut/native-mac', '@smoothcut/native-win'] })],
    resolve: {
      alias: {
        '@main': resolve(import.meta.dirname, 'src/main'),
      },
    },
    build: {
      rollupOptions: {
        external: ['uiohook-napi', 'electron'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@smoothcut/shared'] })],
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
        },
      },
    },
    worker: {
      format: 'es',
    },
  },
});
