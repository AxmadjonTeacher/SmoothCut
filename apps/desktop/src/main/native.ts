/**
 * Lazy accessors for @smoothcut/native-mac and @smoothcut/native-win. Dynamic
 * imports keep the bundler from statically checking named exports against the
 * placeholder packages and keep each platform's code off the other's path.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type * as NativeMac from '@smoothcut/native-mac';
import type * as NativeWin from '@smoothcut/native-win';

let cached: Promise<typeof NativeMac> | undefined;

export function nativeMac(): Promise<typeof NativeMac> {
  // The wrapper resolves the Swift binary relative to its own module URL,
  // which the bundler destroys — point it at the real location instead.
  if (!process.env.SMOOTHCUT_RECORDER_BIN) {
    if (app.isPackaged) {
      process.env.SMOOTHCUT_RECORDER_BIN = join(process.resourcesPath, 'bin', 'smoothcut-recorder');
    } else {
      // Dev: resolve through node's resolver to the workspace package (src/index.ts → ../bin).
      const require = createRequire(import.meta.url);
      const pkgEntry = require.resolve('@smoothcut/native-mac');
      process.env.SMOOTHCUT_RECORDER_BIN = join(dirname(pkgEntry), '..', 'bin', 'smoothcut-recorder');
    }
  }
  cached ??= import('@smoothcut/native-mac');
  return cached;
}

let cachedWin: Promise<typeof NativeWin> | undefined;

export function nativeWin(): Promise<typeof NativeWin> {
  // Same pattern as SMOOTHCUT_RECORDER_BIN above: the wrapper loads the .node
  // addon from SMOOTHCUT_WIN_ADDON (absolute path, so no asar-unpack games),
  // falling back to a path relative to its own module URL that the bundler
  // destroys — always set the override here.
  if (!process.env.SMOOTHCUT_WIN_ADDON) {
    const nodeFile = `smoothcut-native-win.win32-${process.arch}-msvc.node`;
    if (app.isPackaged) {
      process.env.SMOOTHCUT_WIN_ADDON = join(process.resourcesPath, 'bin', nodeFile);
    } else {
      // Dev: resolve through node's resolver to the workspace package (src/index.ts → ..).
      const require = createRequire(import.meta.url);
      const pkgEntry = require.resolve('@smoothcut/native-win');
      process.env.SMOOTHCUT_WIN_ADDON = join(dirname(pkgEntry), '..', nodeFile);
    }
  }
  cachedWin ??= import('@smoothcut/native-win');
  return cachedWin;
}
