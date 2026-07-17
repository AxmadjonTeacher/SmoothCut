/**
 * Recorder toolbar window: a compact Screen-Studio-style floating pill drawn
 * at the top of a transparent always-on-top window. Sources (display/window/
 * area) are ARMED from the pill; camera/mic/system-audio are toggles backed
 * by AppSettings device ids; the gear expands a settings panel (fps,
 * countdown, devices, auto-zoom, recent recordings) below the pill without
 * resizing the window. Everything outside the drawn UI is pointer-events:none.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_APP_SETTINGS } from '@smoothcut/shared';
import type {
  CaptureSource,
  DisplayInfo,
  PermissionsStatus,
  RecordingConfig,
  RecordingStatus,
  Rect,
  WindowInfo,
} from '@smoothcut/shared';
import { PermissionsGate } from './PermissionsGate';
import { Segmented } from './controls';
import { RecentList } from './RecentList';
import {
  cleanIpcError,
  formatDuration,
  formatHotkey,
  hotkeyParts,
  keyboardEventToAccelerator,
} from './format';
import {
  AreaIcon,
  CameraIcon,
  DisplayIcon,
  GearIcon,
  MicIcon,
  ResetIcon,
  SpeakerIcon,
  WindowIcon,
  XIcon,
} from './icons';
import './recorder.css';

type Fps = 30 | 60;
type CountdownSec = 0 | 3 | 5 | 10;

interface Sources {
  displays: DisplayInfo[];
  windows: WindowInfo[];
}

type Armed =
  | { kind: 'display'; displayId: string }
  | { kind: 'window'; windowId: string; displayId: string; appName: string; title: string }
  | { kind: 'area'; displayId: string; rect: Rect };

const sc = window.smoothcut;

interface MediaDevices {
  cameras: { id: string; label: string }[];
  mics: { id: string; label: string }[];
}

async function listMediaDevices(): Promise<MediaDevices> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const named = (list: MediaDeviceInfo[], fallback: string) =>
    list.map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
  return {
    cameras: named(devices.filter((d) => d.kind === 'videoinput'), 'Camera'),
    mics: named(
      devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'),
      'Microphone',
    ),
  };
}

/** Locally-ticking elapsed time, re-anchored on every status push from main. */
function useElapsedMs(status: RecordingStatus): number {
  const [ms, setMs] = useState(status.elapsedMs);
  useEffect(() => {
    setMs(status.elapsedMs);
    if (status.state !== 'recording') return;
    const startedAt = Date.now() - status.elapsedMs;
    const id = setInterval(() => setMs(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [status]);
  return ms;
}

function hasVisibleTitle(w: WindowInfo): boolean {
  return w.title.trim() !== '';
}

interface PillButtonProps {
  icon: React.ReactNode;
  label: string;
  ariaLabel: string;
  title?: string;
  armed?: boolean;
  off?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function PillButton({ icon, label, ariaLabel, title, armed, off, disabled, onClick }: PillButtonProps) {
  const cls = ['pill-btn', armed ? 'armed' : '', off ? 'off' : ''].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={ariaLabel}
      aria-pressed={armed ?? !off}
      title={title ?? ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="pill-btn-icon">{icon}</span>
      <span className="pill-btn-label">{label}</span>
    </button>
  );
}

export default function RecorderRoot() {
  const [perms, setPerms] = useState<PermissionsStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [sources, setSources] = useState<Sources>({ displays: [], windows: [] });
  const [armed, setArmed] = useState<Armed | null>(null);
  const [popover, setPopover] = useState<'display' | 'window' | null>(null);
  const [windowQuery, setWindowQuery] = useState('');
  const [gearOpen, setGearOpen] = useState(false);
  const [fps, setFps] = useState<Fps>(60);
  const [countdownSec, setCountdownSec] = useState<CountdownSec>(3);
  const [devices, setDevices] = useState<MediaDevices>({ cameras: [], mics: [] });
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [sysOn, setSysOn] = useState(false);
  /** SAVED device ids (AppSettings.cameraDeviceId/micDeviceId), validated. */
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
  const [autoZoom, setAutoZoom] = useState(true);
  const [status, setStatus] = useState<RecordingStatus>({ state: 'idle', elapsedMs: 0 });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** Active start/stop accelerator (Electron syntax), mirrored from settings. */
  const [hotkey, setHotkey] = useState<string>(DEFAULT_APP_SETTINGS.hotkeyToggleRecording);
  const [hotkeyCapture, setHotkeyCapture] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [recentKey, setRecentKey] = useState(0);
  const [pickingArea, setPickingArea] = useState(false);

  const elapsedMs = useElapsedMs(status);

  // Transparent window: only the pill and its panels may paint.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, []);

  // Toasts self-dismiss.
  useEffect(() => {
    if (toast === null) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const needsGate =
    sc.platform === 'darwin' &&
    perms !== null &&
    (perms.screen !== 'granted' || !perms.accessibility);

  /**
   * Screen-permission state at process start. macOS only applies a Screen
   * Recording grant to a freshly launched process, so if it flips to granted
   * mid-session we offer a relaunch instead of letting the capture fail.
   */
  const initialScreenPerm = useRef<PermissionsStatus['screen'] | null>(null);

  const refreshPerms = useCallback(async () => {
    try {
      const next = await sc.invoke('permissions:status');
      initialScreenPerm.current ??= next.screen;
      setPerms(next);
    } catch {
      // main not ready — the poll below retries
    }
  }, []);

  const needsRelaunch =
    sc.platform === 'darwin' &&
    perms?.screen === 'granted' &&
    initialScreenPerm.current !== null &&
    initialScreenPerm.current !== 'granted';

  // Initial permissions check + 2s poll while the gate is up (or first fetch failed).
  useEffect(() => {
    void refreshPerms();
  }, [refreshPerms]);
  useEffect(() => {
    if (!needsGate && perms !== null) return;
    const id = setInterval(() => {
      if (!document.hidden) void refreshPerms();
    }, 2000);
    return () => clearInterval(id);
  }, [needsGate, perms, refreshPerms]);

  const refreshSources = useCallback(async (): Promise<Sources | null> => {
    try {
      const next = await sc.invoke('sources:list');
      setSources(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  const refreshDevices = useCallback(async (): Promise<MediaDevices | null> => {
    try {
      const next = await listMediaDevices();
      setDevices(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  // One-shot init: sources + persisted settings + current recording status.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [srcs, settings, current, media] = await Promise.all([
          sc.invoke('sources:list'),
          sc.invoke('settings:get'),
          sc.invoke('recording:status'),
          listMediaDevices().catch((): MediaDevices => ({ cameras: [], mics: [] })),
        ]);
        if (cancelled) return;
        setSources(srcs);
        setStatus(current);
        setDevices(media);
        setHotkey(settings.hotkeyToggleRecording);
        setAutoZoom(settings.autoZoomEnabled);

        const cfg = settings.lastRecordingConfig;
        const camId = settings.cameraDeviceId ?? cfg?.webcam?.deviceId ?? null;
        const validCam = camId !== null && media.cameras.some((d) => d.id === camId) ? camId : null;
        setCameraDeviceId(validCam);
        const mId = settings.micDeviceId ?? cfg?.mic?.deviceId ?? null;
        const validMic = mId !== null && media.mics.some((d) => d.id === mId) ? mId : null;
        setMicDeviceId(validMic);

        if (cfg) {
          setFps(cfg.fps);
          setCountdownSec(cfg.countdownSec);
          setSysOn(cfg.systemAudio);
          setCamOn(cfg.webcam !== undefined && validCam !== null);
          setMicOn(cfg.mic !== undefined && validMic !== null);
        }
        const src = cfg?.source;
        const primary = srcs.displays.find((d) => d.isPrimary) ?? srcs.displays[0];
        if (src?.kind === 'display' && srcs.displays.some((d) => d.id === src.displayId)) {
          setArmed({ kind: 'display', displayId: src.displayId });
        } else if (src?.kind === 'window') {
          const w = srcs.windows.find((x) => x.id === src.windowId && hasVisibleTitle(x));
          if (w) {
            setArmed({ kind: 'window', windowId: w.id, displayId: w.displayId, appName: w.appName, title: w.title });
          } else if (primary) {
            setArmed({ kind: 'display', displayId: primary.id });
          }
        } else if (src?.kind === 'area' && srcs.displays.some((d) => d.id === src.displayId)) {
          setArmed({ kind: 'area', displayId: src.displayId, rect: src.rect });
        } else if (primary) {
          // First run: arm the primary display so Record works immediately.
          setArmed({ kind: 'display', displayId: primary.id });
        }
      } catch {
        // main not ready — leave defaults; the user still gets a working pill
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Recording lifecycle pushes from main.
  useEffect(() => sc.on('recording:status', setStatus), []);

  const prevStateRef = useRef<RecordingStatus['state']>('idle');
  useEffect(() => {
    if (status.state === 'finalized' && prevStateRef.current !== 'finalized') {
      setRecentKey((k) => k + 1);
    }
    if (status.state === 'failed' && prevStateRef.current !== 'failed') {
      setToast(status.error ?? 'Recording failed.');
    }
    prevStateRef.current = status.state;
  }, [status]);

  const displays = useMemo(
    () => [...sources.displays].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
    [sources.displays],
  );
  const windows = useMemo(() => sources.windows.filter(hasVisibleTitle), [sources.windows]);
  const primaryDisplayId = displays[0]?.id ?? null;

  // Close popovers on outside clicks (source buttons manage their own toggle).
  useEffect(() => {
    if (popover === null) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('.pill-popover') || t?.closest('.pill-btn')) return;
      setPopover(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [popover]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------- source arming

  const armDisplay = useCallback(async () => {
    const next = (await refreshSources()) ?? sources;
    const sorted = [...next.displays].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    if (sorted.length <= 1) {
      const only = sorted[0];
      if (only) {
        setArmed({ kind: 'display', displayId: only.id });
        setPopover(null);
      } else {
        setToast('No display found.');
      }
    } else {
      setPopover((p) => (p === 'display' ? null : 'display'));
    }
  }, [refreshSources, sources]);

  const armWindow = useCallback(() => {
    setWindowQuery('');
    setPopover((p) => (p === 'window' ? null : 'window'));
    void refreshSources();
  }, [refreshSources]);

  const armArea = useCallback(async () => {
    if (pickingArea) return;
    const displayId = (armed?.displayId ?? primaryDisplayId) as string | null;
    if (displayId === null) {
      setToast('No display found.');
      return;
    }
    setPopover(null);
    setPickingArea(true);
    try {
      const rect = await sc.invoke('sources:pickArea', displayId);
      if (rect) setArmed({ kind: 'area', displayId, rect });
    } catch (err) {
      setToast(cleanIpcError(err instanceof Error ? err.message : String(err)));
    } finally {
      setPickingArea(false);
    }
  }, [pickingArea, armed, primaryDisplayId]);

  // ------------------------------------------------------------ device toggles

  const toggleCamera = useCallback(async () => {
    if (camOn) {
      setCamOn(false);
      return;
    }
    let media = devices;
    if (media.cameras.length === 0) media = (await refreshDevices()) ?? media;
    const kept =
      cameraDeviceId !== null && media.cameras.some((c) => c.id === cameraDeviceId)
        ? cameraDeviceId
        : null;
    const id = kept ?? media.cameras[0]?.id ?? null;
    if (id === null) {
      setToast('No camera detected.');
      return;
    }
    if (id !== cameraDeviceId) {
      setCameraDeviceId(id);
      void sc.invoke('settings:set', { cameraDeviceId: id }).catch(() => {});
    }
    setCamOn(true);
  }, [camOn, devices, cameraDeviceId, refreshDevices]);

  const toggleMic = useCallback(async () => {
    if (micOn) {
      setMicOn(false);
      return;
    }
    let media = devices;
    if (media.mics.length === 0) media = (await refreshDevices()) ?? media;
    const kept =
      micDeviceId !== null && media.mics.some((m) => m.id === micDeviceId) ? micDeviceId : null;
    const id = kept ?? media.mics[0]?.id ?? null;
    if (id === null) {
      setToast('No microphone detected.');
      return;
    }
    if (id !== micDeviceId) {
      setMicDeviceId(id);
      void sc.invoke('settings:set', { micDeviceId: id }).catch(() => {});
    }
    setMicOn(true);
  }, [micOn, devices, micDeviceId, refreshDevices]);

  // ------------------------------------------------------------------- hotkey

  /**
   * Persist a new start/stop accelerator. Main tries to register it as the
   * global shortcut inside the settings:set handler; a failed registration
   * (invalid/taken) REVERTS the stored setting, so the returned settings not
   * matching what we sent is the failure signal.
   */
  const applyHotkey = useCallback(async (accelerator: string) => {
    setHotkeyError(null);
    try {
      const next = await sc.invoke('settings:set', { hotkeyToggleRecording: accelerator });
      setHotkey(next.hotkeyToggleRecording);
      if (next.hotkeyToggleRecording !== accelerator) {
        setHotkeyError('That shortcut can’t be registered — it may be in use by another app.');
      }
    } catch (err) {
      setHotkeyError(cleanIpcError(err instanceof Error ? err.message : String(err)));
    }
  }, []);

  // Closing the gear panel abandons an in-progress hotkey capture.
  useEffect(() => {
    if (!gearOpen) setHotkeyCapture(false);
  }, [gearOpen]);

  // Capture mode: the next modifier+key keydown becomes the hotkey; Esc cancels.
  useEffect(() => {
    if (!hotkeyCapture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setHotkeyCapture(false);
        return;
      }
      const accelerator = keyboardEventToAccelerator(e, sc.platform);
      if (accelerator === null) return; // bare modifier / unsupported key — keep listening
      setHotkeyCapture(false);
      void applyHotkey(accelerator);
    };
    const cancel = () => setHotkeyCapture(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', cancel);
    };
  }, [hotkeyCapture, applyHotkey]);

  // ---------------------------------------------------------------- recording

  const buildConfig = useCallback((): RecordingConfig | null => {
    if (!armed) return null;
    const source: CaptureSource =
      armed.kind === 'display'
        ? { kind: 'display', displayId: armed.displayId }
        : armed.kind === 'window'
          ? { kind: 'window', windowId: armed.windowId, displayId: armed.displayId }
          : { kind: 'area', displayId: armed.displayId, rect: armed.rect };
    return {
      source,
      fps,
      systemAudio: sysOn,
      ...(camOn && cameraDeviceId !== null ? { webcam: { deviceId: cameraDeviceId } } : {}),
      ...(micOn && micDeviceId !== null
        ? { mic: { deviceId: micDeviceId, noiseSuppression: false } }
        : {}),
      countdownSec,
      autoZoom,
    };
  }, [armed, fps, sysOn, camOn, cameraDeviceId, micOn, micDeviceId, countdownSec, autoZoom]);

  const startRecording = useCallback(async () => {
    const config = buildConfig();
    if (!config) return;
    setBusy(true);
    setToast(null);
    setPopover(null);
    setGearOpen(false);
    try {
      await sc.invoke('settings:set', { lastRecordingConfig: config });
      await sc.invoke('recording:start', config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('permission:screen')) {
        // Flip to the gate immediately; the 2s poll keeps it honest.
        setPerms((p) => (p ? { ...p, screen: 'denied' } : p));
        void refreshPerms();
      } else if (message.includes('windows-capture-not-yet-implemented')) {
        setToast('Window capture isn’t available yet — pick a display instead.');
      } else if (!message.includes('recording-cancelled')) {
        setToast(cleanIpcError(message));
      }
    } finally {
      setBusy(false);
    }
  }, [buildConfig, refreshPerms]);

  const stopRecording = useCallback(async () => {
    try {
      await sc.invoke('recording:stop');
    } catch (err) {
      setToast(cleanIpcError(err instanceof Error ? err.message : String(err)));
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    try {
      await sc.invoke('recording:cancel');
    } catch {
      // already torn down — nothing to surface
    }
  }, []);

  const isRecording = status.state === 'recording';
  const isCountdown = status.state === 'countdown';
  const isTransitional =
    status.state === 'checking-permissions' ||
    status.state === 'starting' ||
    status.state === 'stopping';
  const isIdleLike = !isRecording && !isCountdown && !isTransitional;
  const canRecord = isIdleLike && !busy && armed !== null;

  // Global hotkey: latest-state handler behind a stable subscription.
  const hotkeyRef = useRef<() => void>(() => {});
  useEffect(() => {
    hotkeyRef.current = () => {
      if (isRecording) {
        void stopRecording();
      } else if (canRecord && !needsGate) {
        void startRecording();
      }
    };
  });
  useEffect(
    () =>
      sc.on('hotkey:toggleRecording', () => {
        hotkeyRef.current();
      }),
    [],
  );

  // -------------------------------------------------------------------- render

  if (!ready || (sc.platform === 'darwin' && perms === null)) {
    return <div className="pillbar" />;
  }

  const q = windowQuery.trim().toLowerCase();
  const visibleWindows = q
    ? windows.filter((w) => `${w.appName} ${w.title}`.toLowerCase().includes(q))
    : windows;

  const areaLabel =
    armed?.kind === 'area' ? `${armed.rect.width}×${armed.rect.height}` : 'Area';
  const armedDisplay =
    armed?.kind === 'display' ? displays.find((d) => d.id === armed.displayId) : undefined;

  return (
    <div className="pillbar">
      <div className="pill">
        {needsGate && perms !== null ? (
          <PermissionsGate status={perms} />
        ) : isCountdown ? (
          <div className="pill-live">
            <span className="pill-count">
              {Math.max(1, Math.ceil(status.countdownRemaining ?? 0))}
            </span>
            <span className="pill-live-text">Recording starts…</span>
            <button type="button" className="pill-ghost" onClick={() => void cancelRecording()}>
              Cancel
            </button>
          </div>
        ) : isRecording ? (
          <div className="pill-live">
            <span className="live-dot" />
            <span className="pill-elapsed">{formatDuration(elapsedMs)}</span>
            <button
              type="button"
              className="pill-stop"
              aria-label="Stop recording"
              onClick={() => void stopRecording()}
            >
              <span className="pill-stop-square" />
            </button>
            <button type="button" className="pill-ghost" onClick={() => void cancelRecording()}>
              Cancel
            </button>
          </div>
        ) : isTransitional ? (
          <div className="pill-live">
            <span className="spinner" />
            <span className="pill-live-text">
              {status.state === 'stopping' ? 'Saving recording…' : 'Starting…'}
            </span>
            {status.state !== 'stopping' ? (
              <button type="button" className="pill-ghost" onClick={() => void cancelRecording()}>
                Cancel
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="pill-title">
              What to record?
              <span className="pill-hotkey" title="Start/stop recording shortcut">
                {formatHotkey(hotkey, sc.platform)}
              </span>
            </div>
            <div className="pill-row">
              <button
                type="button"
                className="pill-icon-btn"
                aria-label="Hide recorder"
                title="Hide"
                onClick={() => window.close()}
              >
                <XIcon />
              </button>
              <span className="pill-sep" />
              <PillButton
                icon={<DisplayIcon />}
                label="Display"
                ariaLabel="Record a display"
                title={armedDisplay ? `Recording ${armedDisplay.label || 'display'}` : 'Record a display'}
                armed={armed?.kind === 'display'}
                disabled={busy}
                onClick={() => void armDisplay()}
              />
              <PillButton
                icon={<WindowIcon />}
                label="Window"
                ariaLabel="Record a window"
                title={
                  armed?.kind === 'window'
                    ? `Recording ${armed.appName} — ${armed.title}`
                    : 'Record a window'
                }
                armed={armed?.kind === 'window'}
                disabled={busy}
                onClick={armWindow}
              />
              <PillButton
                icon={<AreaIcon />}
                label={pickingArea ? 'Picking…' : areaLabel}
                ariaLabel="Record an area"
                title="Record an area (click to select)"
                armed={armed?.kind === 'area'}
                disabled={busy || pickingArea}
                onClick={() => void armArea()}
              />
              <span className="pill-sep" />
              <PillButton
                icon={<CameraIcon off={!camOn} />}
                label="Camera"
                ariaLabel="Toggle camera"
                title={
                  camOn
                    ? `Camera on — ${devices.cameras.find((c) => c.id === cameraDeviceId)?.label ?? 'camera'}`
                    : 'Camera off'
                }
                off={!camOn}
                disabled={busy}
                onClick={() => void toggleCamera()}
              />
              <PillButton
                icon={<MicIcon off={!micOn} />}
                label="Mic"
                ariaLabel="Toggle microphone"
                title={
                  micOn
                    ? `Microphone on — ${devices.mics.find((m) => m.id === micDeviceId)?.label ?? 'microphone'}`
                    : 'Microphone off'
                }
                off={!micOn}
                disabled={busy}
                onClick={() => void toggleMic()}
              />
              <PillButton
                icon={<SpeakerIcon off={!sysOn} />}
                label="Audio"
                ariaLabel="Toggle system audio"
                title={sysOn ? 'System audio on' : 'System audio off'}
                off={!sysOn}
                disabled={busy}
                onClick={() => setSysOn((v) => !v)}
              />
              <span className="pill-sep" />
              <button
                type="button"
                className="pill-record"
                aria-label="Start recording"
                title={canRecord ? 'Start recording' : 'Choose what to record first'}
                disabled={!canRecord}
                onClick={() => void startRecording()}
              />
              <button
                type="button"
                className={gearOpen ? 'pill-icon-btn active' : 'pill-icon-btn'}
                aria-label="Recording settings"
                aria-expanded={gearOpen}
                title="Settings"
                onClick={() => {
                  setPopover(null);
                  setGearOpen((v) => !v);
                }}
              >
                <GearIcon />
              </button>
            </div>
          </>
        )}
      </div>

      {isIdleLike && !needsGate ? (
        <div className="pill-under">
          {needsRelaunch ? (
            <div className="pill-notice">
              <span>Screen Recording granted — relaunch to apply.</span>
              <button type="button" className="mini" onClick={() => void sc.invoke('app:relaunch')}>
                Relaunch
              </button>
            </div>
          ) : null}
          {toast !== null ? (
            <div className="pill-toast" role="alert">
              <span>{toast}</span>
              <button
                type="button"
                className="pill-toast-x"
                aria-label="Dismiss"
                onClick={() => setToast(null)}
              >
                ×
              </button>
            </div>
          ) : null}

          {popover === 'display' ? (
            <div className="pill-popover" role="listbox" aria-label="Displays">
              {displays.map((d) => {
                const selected = armed?.kind === 'display' && armed.displayId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? 'pop-item selected' : 'pop-item'}
                    onClick={() => {
                      setArmed({ kind: 'display', displayId: d.id });
                      setPopover(null);
                    }}
                  >
                    <span className="pop-label">{d.label || 'Display'}</span>
                    <span className="pop-sub">
                      {Math.round(d.bounds.width * d.scaleFactor)}×
                      {Math.round(d.bounds.height * d.scaleFactor)}
                      {d.isPrimary ? ' · Primary' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {popover === 'window' ? (
            <div className="pill-popover" role="listbox" aria-label="Windows">
              <input
                className="pop-search"
                type="text"
                placeholder="Search windows…"
                value={windowQuery}
                autoFocus
                spellCheck={false}
                onChange={(e) => setWindowQuery(e.target.value)}
              />
              <div className="pop-list">
                {visibleWindows.length === 0 ? <div className="pop-empty">No windows</div> : null}
                {visibleWindows.map((w) => {
                  const selected = armed?.kind === 'window' && armed.windowId === w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={selected ? 'pop-item selected' : 'pop-item'}
                      onClick={() => {
                        setArmed({
                          kind: 'window',
                          windowId: w.id,
                          displayId: w.displayId,
                          appName: w.appName,
                          title: w.title,
                        });
                        setPopover(null);
                      }}
                    >
                      <span className="pop-label">{w.appName || 'App'}</span>
                      <span className="pop-sub">{w.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className={gearOpen ? 'settings-panel open' : 'settings-panel'} aria-hidden={!gearOpen}>
            <div className="settings-inner">
              <div className="settings-cols">
                <div className="settings-field">
                  <span className="settings-label">Frame rate</span>
                  <Segmented<'30' | '60'>
                    small
                    ariaLabel="Frame rate"
                    value={String(fps) as '30' | '60'}
                    onChange={(v) => setFps(v === '60' ? 60 : 30)}
                    options={[
                      { value: '30', label: '30 fps' },
                      { value: '60', label: '60 fps' },
                    ]}
                  />
                </div>
                <div className="settings-field">
                  <span className="settings-label">Countdown</span>
                  <Segmented<'0' | '3' | '5' | '10'>
                    small
                    ariaLabel="Countdown"
                    value={String(countdownSec) as '0' | '3' | '5' | '10'}
                    onChange={(v) => setCountdownSec(Number(v) as CountdownSec)}
                    options={[
                      { value: '0', label: 'Off' },
                      { value: '3', label: '3s' },
                      { value: '5', label: '5s' },
                      { value: '10', label: '10s' },
                    ]}
                  />
                </div>
              </div>
              <div className="settings-field">
                <span className="settings-label">Camera</span>
                <select
                  value={cameraDeviceId ?? ''}
                  disabled={devices.cameras.length === 0}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCameraDeviceId(id);
                    void sc.invoke('settings:set', { cameraDeviceId: id }).catch(() => {});
                  }}
                  onFocus={() => void refreshDevices()}
                >
                  {cameraDeviceId === null ? (
                    <option value="" disabled>
                      {devices.cameras.length === 0 ? 'No cameras found' : 'Choose a camera…'}
                    </option>
                  ) : null}
                  {devices.cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-field">
                <span className="settings-label">Microphone</span>
                <select
                  value={micDeviceId ?? ''}
                  disabled={devices.mics.length === 0}
                  onChange={(e) => {
                    const id = e.target.value;
                    setMicDeviceId(id);
                    void sc.invoke('settings:set', { micDeviceId: id }).catch(() => {});
                  }}
                  onFocus={() => void refreshDevices()}
                >
                  {micDeviceId === null ? (
                    <option value="" disabled>
                      {devices.mics.length === 0 ? 'No microphones found' : 'Choose a microphone…'}
                    </option>
                  ) : null}
                  {devices.mics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="settings-field settings-toggle">
                <span className="settings-label">
                  Auto-zoom
                  <span className="settings-hint">Zoom into clicks automatically in the editor</span>
                </span>
                <input
                  type="checkbox"
                  checked={autoZoom}
                  onChange={(e) => {
                    setAutoZoom(e.target.checked);
                    void sc.invoke('settings:set', { autoZoomEnabled: e.target.checked }).catch(() => {});
                  }}
                />
              </label>
              <div className="settings-field">
                <span className="settings-label">Hotkey</span>
                <div className="hotkey-row">
                  <span className="hotkey-name">Start/stop recording</span>
                  <div className="hotkey-controls">
                    <button
                      type="button"
                      className={hotkeyCapture ? 'hotkey-btn capturing' : 'hotkey-btn'}
                      aria-label="Change the start/stop recording shortcut"
                      title={hotkeyCapture ? 'Press the new shortcut (Esc cancels)' : 'Click, then press the new shortcut'}
                      onClick={() => {
                        setHotkeyError(null);
                        setHotkeyCapture((v) => !v);
                      }}
                    >
                      {hotkeyCapture ? (
                        <span className="hotkey-hint">Press keys…</span>
                      ) : (
                        hotkeyParts(hotkey, sc.platform).map((part, i) => (
                          <kbd key={i} className="keycap">
                            {part}
                          </kbd>
                        ))
                      )}
                    </button>
                    <button
                      type="button"
                      className="hotkey-reset"
                      aria-label="Reset shortcut to default"
                      title={`Reset to ${formatHotkey(DEFAULT_APP_SETTINGS.hotkeyToggleRecording, sc.platform)}`}
                      disabled={!hotkeyCapture && hotkey === DEFAULT_APP_SETTINGS.hotkeyToggleRecording}
                      onClick={() => {
                        setHotkeyCapture(false);
                        void applyHotkey(DEFAULT_APP_SETTINGS.hotkeyToggleRecording);
                      }}
                    >
                      <ResetIcon />
                    </button>
                  </div>
                </div>
                {hotkeyError !== null ? (
                  <div className="hotkey-error" role="alert">
                    {hotkeyError}
                  </div>
                ) : null}
              </div>
              <RecentList refreshKey={recentKey} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
