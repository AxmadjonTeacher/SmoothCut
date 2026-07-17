import { shell, systemPreferences } from 'electron';
import type { PermissionKind, PermissionsStatus, PermissionState } from '@smoothcut/shared';
import { nativeMac } from './native.js';

const SETTINGS_DEEP_LINKS: Record<PermissionKind, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
};

function mapMediaStatus(status: string): PermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'not-determined') return 'not-determined';
  return 'denied';
}

async function screenStatus(): Promise<PermissionState> {
  if (process.platform !== 'darwin') return 'granted';
  const native = await nativeMac();
  return native.checkScreenPermission();
}

export async function getPermissionsStatus(): Promise<PermissionsStatus> {
  const darwin = process.platform === 'darwin';
  return {
    screen: await screenStatus(),
    accessibility: darwin ? systemPreferences.isTrustedAccessibilityClient(false) : true,
    microphone: mapMediaStatus(systemPreferences.getMediaAccessStatus('microphone')),
    camera: mapMediaStatus(systemPreferences.getMediaAccessStatus('camera')),
  };
}

/**
 * Trigger the OS prompt (or TCC registration) and report the CURRENT state.
 * macOS screen/accessibility grants only take effect after an app restart, so
 * the return value reflects now, not the user's eventual choice.
 */
export async function requestPermission(kind: PermissionKind): Promise<boolean> {
  if (process.platform !== 'darwin') {
    if (kind === 'microphone' || kind === 'camera') {
      return systemPreferences.getMediaAccessStatus(kind) === 'granted';
    }
    return true;
  }
  switch (kind) {
    case 'screen': {
      const native = await nativeMac();
      await native.requestScreenPermission();
      return (await native.checkScreenPermission()) === 'granted';
    }
    case 'accessibility':
      return systemPreferences.isTrustedAccessibilityClient(true);
    case 'microphone':
    case 'camera':
      return systemPreferences.askForMediaAccess(kind);
  }
}

export async function openPermissionSettings(kind: PermissionKind): Promise<void> {
  if (process.platform !== 'darwin') return;
  await shell.openExternal(SETTINGS_DEEP_LINKS[kind]);
}
