/**
 * Headless-ish dev harness for end-to-end verification, gated entirely behind
 * env vars (never active in normal runs):
 *
 *   SMOOTHCUT_DEV_RECORD_SEC=<n>   record the primary display for n seconds,
 *                                  print "[devharness] finalized <id> <dir>",
 *                                  then quit.
 *   SMOOTHCUT_DEV_OPEN=<projectId> open the editor for a project on launch.
 *   SMOOTHCUT_DEV_EXPORT=<path>    with DEV_OPEN: auto-export to <path> (the
 *                                  editor's DevAutoExport picks it up via the
 *                                  devExport query param), then quit.
 *   SMOOTHCUT_DEV_SHOT=<pngPath>   with DEV_OPEN: screenshot the editor window.
 *   SMOOTHCUT_DEV_AUDIO=1          with RECORD_SEC: capture system audio.
 *   SMOOTHCUT_DEV_MIC=1            with RECORD_SEC: capture the default mic.
 *   SMOOTHCUT_DEV_WEBCAM=1         with RECORD_SEC: capture the default camera.
 *   SMOOTHCUT_DEV_AREA="x,y,w,h"   with RECORD_SEC: area capture on the primary
 *                                  display (PHYSICAL px, display-relative).
 *   SMOOTHCUT_DEV_COUNTDOWN=3|5|10 with RECORD_SEC: use a countdown; with
 *                                  DEV_SHOT, screenshots the countdown overlay
 *                                  window mid-countdown.
 *   SMOOTHCUT_DEV_EXPORT_SIZE=3840x2160@30
 *                                  with DEV_EXPORT: export resolution/fps
 *                                  (default 1920x1080@30).
 *   SMOOTHCUT_DEV_PANEL_SHOT=<png> screenshot the recorder panel, then quit.
 *                                  Runs SMOOTHCUT_DEV_EVAL in the panel first
 *                                  (if set), waits SMOOTHCUT_DEV_SETTLE_MS
 *                                  (default 500), and also shoots any other
 *                                  open window to <png base>-w<n>.png.
 *   SMOOTHCUT_DEV_WIN_INFO=1       with PANEL_SHOT: log each extra window's
 *                                  bounds + renderer inner size/dpr, plus the
 *                                  system display list (overlay coverage
 *                                  assertions).
 *   SMOOTHCUT_DEV_AUTOZOOM=0|1     with RECORD_SEC: set RecordingConfig.autoZoom.
 *   SMOOTHCUT_DEV_FAKE_PICK_DIR=<dir>
 *                                  'export:pickDirectory' returns <dir> without
 *                                  opening a dialog (headless round-trips).
 *   SMOOTHCUT_DEV_RECORDER=1       with RECORD_SEC: open the recorder toolbar
 *                                  through the real show/hide wiring before
 *                                  recording, and log per-window visibility
 *                                  ("[devharness] windows <label> …") before,
 *                                  during, and after the recording.
 *   SMOOTHCUT_DEV_CANCEL=1         with RECORD_SEC: cancel instead of stop
 *                                  (no project is written).
 *   SMOOTHCUT_DEV_EDITOR_ON_FINALIZE=1
 *                                  let a finalized harness recording open the
 *                                  editor window like a normal run would.
 *   SMOOTHCUT_DEV_HOTKEY_PROBE=1   log every global-shortcut registration
 *                                  attempt (accelerator, active, isRegistered).
 *
 *   RECORD_SEC + SMOOTHCUT_DEV_SHOT without a countdown screenshots every open
 *   window mid-recording (<png>, then <png base>-w<n>.png) — bubble/pill checks.
 */
import { writeFile } from 'node:fs/promises';
import { app, screen, BrowserWindow } from 'electron';
import type { Rect } from '@smoothcut/shared';
import type { RecordingSession } from './recording/session.js';
import { listSources } from './sources.js';
import { createEditorWindow, createRecorderWindow } from './windows/factory.js';

const RECORD_SEC = process.env.SMOOTHCUT_DEV_RECORD_SEC;
const OPEN_ID = process.env.SMOOTHCUT_DEV_OPEN;
const EXPORT_PATH = process.env.SMOOTHCUT_DEV_EXPORT;
const EXPORT_SIZE = process.env.SMOOTHCUT_DEV_EXPORT_SIZE;
const SHOT_PATH = process.env.SMOOTHCUT_DEV_SHOT;
const PANEL_SHOT_PATH = process.env.SMOOTHCUT_DEV_PANEL_SHOT;
/** Record-mode stream toggles: system audio / first mic / first camera. */
const DEV_AUDIO = process.env.SMOOTHCUT_DEV_AUDIO === '1';
const DEV_MIC = process.env.SMOOTHCUT_DEV_MIC === '1';
const DEV_WEBCAM = process.env.SMOOTHCUT_DEV_WEBCAM === '1';
const DEV_AREA = process.env.SMOOTHCUT_DEV_AREA;
const DEV_COUNTDOWN = process.env.SMOOTHCUT_DEV_COUNTDOWN;
const DEV_RECORDER = process.env.SMOOTHCUT_DEV_RECORDER === '1';
const DEV_CANCEL = process.env.SMOOTHCUT_DEV_CANCEL === '1';
const DEV_EDITOR_ON_FINALIZE = process.env.SMOOTHCUT_DEV_EDITOR_ON_FINALIZE === '1';

function parseCountdownSec(raw: string | undefined): 0 | 3 | 5 | 10 {
  return raw === '3' ? 3 : raw === '5' ? 5 : raw === '10' ? 10 : 0;
}

export function devHarnessActive(): boolean {
  return Boolean(RECORD_SEC || OPEN_ID || PANEL_SHOT_PATH);
}

/** Harness recordings normally suppress the editor; this flag re-enables it. */
export function devEditorOnFinalize(): boolean {
  return DEV_EDITOR_ON_FINALIZE;
}

/** "x,y,w,h" (physical px) → Rect, or null when malformed. */
function parseAreaRect(raw: string): Rect | null {
  const parts = raw.split(',').map((p) => Number(p.trim()));
  const [x, y, width, height] = parts;
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  if (x === undefined || y === undefined || width === undefined || height === undefined) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function log(message: string): void {
  process.stdout.write(`[devharness] ${message}\n`);
}

async function screenshot(win: BrowserWindow, path: string): Promise<void> {
  const image = await win.webContents.capturePage();
  await writeFile(path, image.toPNG());
  log(`shot ${path}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await sleep(100);
  }
  return cond();
}

/** Window kind from its renderer URL's ?view= (the recorder loads without one). */
function windowView(win: BrowserWindow): string {
  try {
    const view = new URL(win.webContents.getURL()).searchParams.get('view');
    return view ?? 'recorder';
  } catch {
    return 'unknown';
  }
}

/** "[devharness] windows <label> recorder:hidden editor:visible …" probe line. */
function logWindows(label: string): void {
  const parts = BrowserWindow.getAllWindows()
    .filter((w) => !w.isDestroyed())
    .map((w) => `${windowView(w)}:${w.isVisible() ? 'visible' : 'hidden'}`);
  log(`windows ${label} ${parts.length > 0 ? parts.join(' ') : 'none'}`);
}

export interface DevHarnessHooks {
  /** Open the recorder toolbar through the app's real show/hide wiring. */
  openRecorder: () => void;
}

export function maybeStartDevHarness(
  session: RecordingSession,
  bundleDirOf: (id: string) => string,
  hooks: DevHarnessHooks,
): void {
  // Surface every window's console (incl. the hidden capture window).
  if (process.env.SMOOTHCUT_DEV_VERBOSE === '1') {
    app.on('browser-window-created', (_evt, win) => {
      win.webContents.on('console-message', (details) => {
        const text =
          typeof details === 'object' && 'message' in details ? details.message : String(details);
        process.stdout.write(`[console] ${text}\n`);
      });
    });
  }

  if (PANEL_SHOT_PATH) {
    // Recorder-panel screenshot mode: open the panel, let it settle, run the
    // optional SMOOTHCUT_DEV_EVAL js (e.g. to switch tabs), wait
    // SMOOTHCUT_DEV_SETTLE_MS (default 500), shoot the panel — plus any other
    // window (e.g. the area-picker overlay) to <path>-w<n>.png — then quit.
    const win = createRecorderWindow();
    const settleMs = Number(process.env.SMOOTHCUT_DEV_SETTLE_MS ?? 500);
    setTimeout(() => {
      void (async () => {
        const evalJs = process.env.SMOOTHCUT_DEV_EVAL;
        if (evalJs) {
          try {
            const result: unknown = await win.webContents.executeJavaScript(evalJs);
            log(`eval ${JSON.stringify(result)}`);
          } catch (e) {
            log(`eval-error ${String(e)}`);
          }
        }
        await new Promise((r) => setTimeout(r, settleMs));
        await screenshot(win, PANEL_SHOT_PATH).catch((e: unknown) => log(`shot-error ${String(e)}`));
        const winInfo = process.env.SMOOTHCUT_DEV_WIN_INFO === '1';
        if (winInfo) {
          log(`displays ${JSON.stringify(screen.getAllDisplays().map((d) => d.bounds))}`);
        }
        let n = 0;
        for (const other of BrowserWindow.getAllWindows()) {
          if (other === win || other.isDestroyed()) continue;
          n += 1;
          if (winInfo) {
            const inner: unknown = await other.webContents
              .executeJavaScript(
                '({w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio})',
              )
              .catch(() => null);
            log(`win-info w${n} bounds=${JSON.stringify(other.getBounds())} inner=${JSON.stringify(inner)}`);
          }
          const path = PANEL_SHOT_PATH.replace(/\.png$/, `-w${n}.png`);
          await screenshot(other, path).catch((e: unknown) => log(`shot-error ${String(e)}`));
        }
        setTimeout(() => app.quit(), 500);
      })();
    }, 5000);
    return;
  }

  if (RECORD_SEC) {
    const seconds = Number(RECORD_SEC);
    void (async () => {
      try {
        if (DEV_RECORDER) {
          // Toolbar-flow probe: open the recorder toolbar first so the
          // hide-while-recording / restore-on-cancel wiring is exercised.
          hooks.openRecorder();
          await waitFor(
            () => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible()),
            8000,
          );
          logWindows('pre-record');
        }
        await new Promise((r) => setTimeout(r, 1500));
        const { displays } = await listSources();
        const primary = displays.find((d) => d.isPrimary) ?? displays[0];
        if (!primary) throw new Error('no displays (screen locked?)');
        const areaRect = DEV_AREA ? parseAreaRect(DEV_AREA) : null;
        if (DEV_AREA && !areaRect) throw new Error(`bad SMOOTHCUT_DEV_AREA: ${DEV_AREA}`);
        const countdownSec = parseCountdownSec(DEV_COUNTDOWN);
        if (countdownSec > 0 && SHOT_PATH) {
          // Catch the countdown overlay (the only window) mid-countdown.
          setTimeout(() => {
            const overlay = BrowserWindow.getAllWindows()[0];
            if (overlay) void screenshot(overlay, SHOT_PATH).catch(() => undefined);
          }, 1600);
        }
        // Empty deviceId = "any device" (the capture window drops the
        // deviceId constraint) — main cannot enumerate media devices.
        const autoZoomRaw = process.env.SMOOTHCUT_DEV_AUTOZOOM;
        const { projectId } = await session.start({
          source: areaRect
            ? { kind: 'area', displayId: primary.id, rect: areaRect }
            : { kind: 'display', displayId: primary.id },
          fps: 60,
          systemAudio: DEV_AUDIO,
          ...(DEV_MIC ? { mic: { deviceId: '', noiseSuppression: false } } : {}),
          ...(DEV_WEBCAM ? { webcam: { deviceId: '' } } : {}),
          countdownSec,
          ...(autoZoomRaw !== undefined ? { autoZoom: autoZoomRaw === '1' } : {}),
        });
        if (SHOT_PATH && countdownSec === 0) {
          // Mid-recording: shoot every open window (bubble, recording pill, …).
          setTimeout(() => {
            void (async () => {
              let n = 0;
              for (const w of BrowserWindow.getAllWindows()) {
                if (w.isDestroyed()) continue;
                const path = n === 0 ? SHOT_PATH : SHOT_PATH.replace(/\.png$/, `-w${n}.png`);
                n += 1;
                await screenshot(w, path).catch((e: unknown) => log(`shot-error ${String(e)}`));
              }
            })();
          }, Math.max(500, (seconds * 1000) / 2));
        }
        if (DEV_RECORDER) logWindows('recording');
        await new Promise((r) => setTimeout(r, seconds * 1000));
        if (DEV_CANCEL) {
          await session.cancel();
          log(`cancelled ${projectId}`);
          if (DEV_RECORDER) {
            // Restore-on-cancel is synchronous with the status push, but give
            // the window server a beat before probing.
            await sleep(1000);
            logWindows('after-cancel');
          }
        } else {
          await session.stop();
          log(`finalized ${projectId} ${bundleDirOf(projectId)}`);
          if (DEV_RECORDER) {
            // Let the editor window (if DEV_EDITOR_ON_FINALIZE) reach ready-to-show.
            await waitFor(
              () =>
                BrowserWindow.getAllWindows().some(
                  (w) => !w.isDestroyed() && windowView(w) === 'editor' && w.isVisible(),
                ),
              DEV_EDITOR_ON_FINALIZE ? 15_000 : 1,
            );
            logWindows('after-finalize');
          }
        }
      } catch (error) {
        log(`record-error ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      setTimeout(() => app.quit(), 1500);
    })();
    return;
  }

  if (OPEN_ID) {
    void (async () => {
      await new Promise((r) => setTimeout(r, 500));
      const win = createEditorWindow(
        OPEN_ID,
        EXPORT_PATH
          ? { devExport: EXPORT_PATH, ...(EXPORT_SIZE ? { devExportSize: EXPORT_SIZE } : {}) }
          : {},
      );
      let done = false;
      win.webContents.on('console-message', (details) => {
        const text = typeof details === 'object' && 'message' in details ? details.message : String(details);
        if (process.env.SMOOTHCUT_DEV_VERBOSE === '1') process.stdout.write(`[console] ${text}\n`);
        if (!text.includes('[devharness]')) return;
        process.stdout.write(`${text}\n`);
        if (text.includes('export-done') || text.includes('export-error')) {
          done = true;
          void (async () => {
            if (SHOT_PATH) await screenshot(win, SHOT_PATH).catch(() => undefined);
            setTimeout(() => app.quit(), 500);
          })();
        }
      });
      // Editor-only screenshot mode: no export requested, shoot after settle.
      if (!EXPORT_PATH && SHOT_PATH) {
        setTimeout(() => {
          void (async () => {
            const evalJs = process.env.SMOOTHCUT_DEV_EVAL;
            if (evalJs) {
              try {
                const result: unknown = await win.webContents.executeJavaScript(evalJs);
                log(`eval ${JSON.stringify(result)}`);
              } catch (e) {
                log(`eval-error ${String(e)}`);
              }
              // Let the UI repaint whatever the eval changed before shooting.
              await new Promise((r) => setTimeout(r, Number(process.env.SMOOTHCUT_DEV_SETTLE_MS ?? 500)));
            }
            await screenshot(win, SHOT_PATH).catch((e: unknown) => log(`shot-error ${String(e)}`));
            setTimeout(() => app.quit(), 500);
          })();
        }, 6000);
      }
      // Watchdog so a wedged export can't hang the harness forever.
      setTimeout(() => {
        if (!done && EXPORT_PATH) {
          log('export-timeout');
          process.exitCode = 1;
          void (async () => {
            if (SHOT_PATH) await screenshot(win, SHOT_PATH).catch(() => undefined);
            app.quit();
          })();
        }
      }, 120_000);
    })();
  }
}
