import type { DisplayInfo, WindowInfo } from '@smoothcut/shared';
import type { MacDisplay, MacWindow } from '@smoothcut/native-mac';
import type { WinDisplay, WinWindow } from '@smoothcut/native-win';
import { nativeMac, nativeWin } from './native.js';

// MacDisplay/MacWindow and WinDisplay/WinWindow are field-for-field identical
// (see packages/native-win/INTEGRATION.md); both map through the same shape.
// win32 ids are HMONITOR/HWND decimal strings — a different id space from
// Electron's `screen` ids, so never compare them against Electron values.

export function mapMacDisplay(d: MacDisplay | WinDisplay): DisplayInfo {
  return {
    id: d.id,
    label: d.label,
    // DisplayInfo.bounds is logical points in the OS global space.
    bounds: { x: d.originX, y: d.originY, width: d.widthPt, height: d.heightPt },
    scaleFactor: d.scaleFactor,
    isPrimary: d.isPrimary,
  };
}

export function mapMacWindow(w: MacWindow | WinWindow): WindowInfo {
  return {
    id: w.id,
    title: w.title,
    appName: w.appName,
    displayId: w.displayId,
    bounds: { x: w.x, y: w.y, width: w.width, height: w.height },
  };
}

export const mapWinDisplay: (d: WinDisplay) => DisplayInfo = mapMacDisplay;
export const mapWinWindow: (w: WinWindow) => WindowInfo = mapMacWindow;

export async function listSources(): Promise<{ displays: DisplayInfo[]; windows: WindowInfo[] }> {
  if (process.platform === 'darwin') {
    const native = await nativeMac();
    const { displays, windows } = await native.listShareableContent();
    return { displays: displays.map(mapMacDisplay), windows: windows.map(mapMacWindow) };
  }
  if (process.platform === 'win32') {
    const native = await nativeWin();
    const { displays, windows } = await native.listShareableContent();
    return { displays: displays.map(mapWinDisplay), windows: windows.map(mapWinWindow) };
  }
  throw new Error('unsupported-platform');
}
