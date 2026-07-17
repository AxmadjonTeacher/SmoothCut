/**
 * System tray: record toggle, recorder panel, recent projects, quit. The idle
 * icon is a macOS template image (filled rounded square with a punched-out
 * dot); while recording the dot turns red (non-template so the color renders).
 * Icons are tiny generated PNGs embedded as base64 (16px + 32px @2x).
 */
import { app, nativeImage, Menu, Tray } from 'electron';
import type { NativeImage } from 'electron';
import type { RecordingStatus } from '@smoothcut/shared';
import type { ProjectStore } from './project/store.js';

const IDLE_16 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWUlEQVR42mNgGGwgj4GB4Q4DA8N/HPgOVA1Ozf+JxFgNuUOCAXewGYCu6AIDA0MxFF/AIo/XAJAGViQ5ViyG4DWgGIt8MV0NoNgLZAUixdFIcUKiOCkPDAAAKi1wIQxHzUoAAAAASUVORK5CYII=';
const IDLE_32 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAo0lEQVR42u2WwQ2AIAxF351lHMGZuDkJe3FnFKMXTDxhq6klyk96IfntS6ClMDTU1gQkoAArsAljrZ5Uc9zSoih4FYtncTXEZFD8CNF1JEOAJAEohgBFAqB57bmGpjsuJUkUgXDyhHom8T4GmBve2RogCvzREiAI/MEKICsGWf4kgPsVdPEI3dvwlUHkPordPyP379h9IXFfybpYSrtYy4f+oR2rZcK4AcWQPgAAAABJRU5ErkJggg==';
const REC_16 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAa0lEQVR42mNgGFSgvr4+r76+/k59ff1/HBgkl4dP838icR42A+6QYMAdbAagKJqXVzDrll/QPBAGsdHl8RoA0vDUw/fXUw/f/1D8C90QvAaAbEXSDMYgMfoZQLEXyA1EiqORsoREcVIeMAAAmLVPrHOIBpYAAAAASUVORK5CYII=';
const REC_32 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA10lEQVR42u2WQQrDIBBFcySP4cYbdFm8Q1b/BK49Rw8QcpIsvUG2wWKZRQlUJwl2pHXggwTMf46jzjD06JEJAAqAB7AA2ABEpjaak+aqs+bjAcOSRknzYxCU9lhJigPgKwJ4DsBSEWDhAHCqfQJgH3d7S0pj+lY8HRyA0k9s0MYFbdagTSSlsSOQ7PyrAMl8fjPeay5BXAGYaOWxIJfbjisAdpf2T1pzWTgNkIqNYf4SFeaPAYhvQQtFKH4Mv3YRiV/F4o+R+HMs25CIt2RNNKVNtOU9/iaerzc17DoAFX4AAAAASUVORK5CYII=';

function buildIcon(base16: string, base32: string, template: boolean): NativeImage {
  const image = nativeImage.createFromBuffer(Buffer.from(base16, 'base64'));
  image.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(base32, 'base64') });
  image.setTemplateImage(template);
  return image;
}

export interface AppTrayDeps {
  projects: ProjectStore;
  toggleRecording: () => void;
  openRecorder: () => void;
  openEditor: (projectId: string) => void;
}

const RECENT_LIMIT = 5;

export class AppTray {
  private readonly deps: AppTrayDeps;
  private tray: Tray | undefined;
  private readonly idleIcon = buildIcon(IDLE_16, IDLE_32, true);
  private readonly recordingIcon = buildIcon(REC_16, REC_32, false);
  private lastState: RecordingStatus['state'] = 'idle';

  constructor(deps: AppTrayDeps) {
    this.deps = deps;
  }

  create(): void {
    if (this.tray) return;
    this.tray = new Tray(this.idleIcon);
    this.tray.setToolTip('SmoothCut');
    void this.rebuildMenu();
  }

  /** Called on every recording-status push; only state CHANGES rebuild the menu. */
  onStatus(status: RecordingStatus): void {
    if (!this.tray || status.state === this.lastState) return;
    this.lastState = status.state;
    this.tray.setImage(status.state === 'recording' ? this.recordingIcon : this.idleIcon);
    void this.rebuildMenu();
  }

  /** Refresh the recent-projects submenu (e.g. after a recording finalizes). */
  refresh(): void {
    if (this.tray) void this.rebuildMenu();
  }

  private async rebuildMenu(): Promise<void> {
    const tray = this.tray;
    if (!tray) return;
    const recording = this.lastState === 'recording';
    const busy =
      this.lastState === 'countdown' ||
      this.lastState === 'starting' ||
      this.lastState === 'stopping' ||
      this.lastState === 'checking-permissions';
    const recents = await this.deps.projects.list().catch(() => []);
    if (!this.tray) return; // destroyed while listing

    const menu = Menu.buildFromTemplate([
      {
        label: recording ? 'Stop Recording' : 'Start Recording',
        enabled: !busy,
        click: () => this.deps.toggleRecording(),
      },
      { label: 'Open Recorder', click: () => this.deps.openRecorder() },
      {
        label: 'Recent Projects',
        submenu:
          recents.length === 0
            ? [{ label: 'No recordings yet', enabled: false }]
            : recents.slice(0, RECENT_LIMIT).map((p) => ({
                label: p.name,
                click: () => this.deps.openEditor(p.id),
              })),
      },
      { type: 'separator' },
      { label: 'Quit SmoothCut', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
  }
}
