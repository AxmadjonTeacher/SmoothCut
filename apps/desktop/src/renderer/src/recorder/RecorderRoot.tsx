/**
 * Recorder panel window (420x560): permissions gate, source picker, record
 * lifecycle, and the recent-recordings list. All state flows through the typed
 * `window.smoothcut` IPC bridge; the main process owns the actual capture.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Dropdown, Segmented } from './controls';
import { RecentList } from './RecentList';
import { cleanIpcError, formatDuration, formatHotkey } from './format';
import './recorder.css';

type SourceKind = 'display' | 'window' | 'area';
type Fps = 30 | 60;
type CountdownSec = 0 | 3 | 5 | 10;

interface Sources {
  displays: DisplayInfo[];
  windows: WindowInfo[];
}

const sc = window.smoothcut;

const NONE_ID = '__none__';

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

export default function RecorderRoot() {
  const [perms, setPerms] = useState<PermissionsStatus | null>(null);
  const [sources, setSources] = useState<Sources>({ displays: [], windows: [] });
  const [sourceKind, setSourceKind] = useState<SourceKind>('display');
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<string | null>(null);
  /** Remembered capture area per display id (physical px, display-relative). */
  const [areas, setAreas] = useState<Record<string, Rect>>({});
  const [pickingArea, setPickingArea] = useState(false);
  const [fps, setFps] = useState<Fps>(60);
  const [countdownSec, setCountdownSec] = useState<CountdownSec>(3);
  const [devices, setDevices] = useState<MediaDevices>({ cameras: [], mics: [] });
  const [webcamId, setWebcamId] = useState<string | null>(null);
  const [micId, setMicId] = useState<string | null>(null);
  const [systemAudio, setSystemAudio] = useState(false);
  const [status, setStatus] = useState<RecordingStatus>({ state: 'idle', elapsedMs: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [hotkeyLabel, setHotkeyLabel] = useState<string | null>(null);
  const [recentKey, setRecentKey] = useState(0);
  const [ready, setReady] = useState(false);

  const elapsedMs = useElapsedMs(status);

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
        setHotkeyLabel(formatHotkey(settings.hotkeyToggleRecording, sc.platform));
        const primary = srcs.displays.find((d) => d.isPrimary) ?? srcs.displays[0];
        const cfg = settings.lastRecordingConfig;
        if (cfg) {
          setFps(cfg.fps);
          setCountdownSec(cfg.countdownSec);
          setSystemAudio(cfg.systemAudio);
          if (cfg.webcam && media.cameras.some((d) => d.id === cfg.webcam?.deviceId)) {
            setWebcamId(cfg.webcam.deviceId);
          }
          if (cfg.mic && media.mics.some((d) => d.id === cfg.mic?.deviceId)) {
            setMicId(cfg.mic.deviceId);
          }
        }
        // Remembered areas, seeded with the last config's rect as a fallback.
        const remembered = { ...settings.rememberedAreas };
        if (cfg?.source.kind === 'area' && !remembered[cfg.source.displayId]) {
          remembered[cfg.source.displayId] = cfg.source.rect;
        }
        setAreas(remembered);
        const src = cfg?.source;
        if (src?.kind === 'display' && srcs.displays.some((d) => d.id === src.displayId)) {
          setSourceKind('display');
          setDisplayId(src.displayId);
        } else if (
          src?.kind === 'window' &&
          srcs.windows.some((w) => w.id === src.windowId && hasVisibleTitle(w))
        ) {
          setSourceKind('window');
          setWindowId(src.windowId);
          setDisplayId(primary?.id ?? null);
        } else if (src?.kind === 'area' && srcs.displays.some((d) => d.id === src.displayId)) {
          setSourceKind('area');
          setDisplayId(src.displayId);
        } else {
          setSourceKind('display');
          setDisplayId(primary?.id ?? null);
        }
      } catch {
        // main not ready — leave defaults; the user still gets a working panel
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
      setError(status.error ?? 'Recording failed.');
    }
    prevStateRef.current = status.state;
  }, [status]);

  const displays = useMemo(
    () => [...sources.displays].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
    [sources.displays],
  );
  const windows = useMemo(() => sources.windows.filter(hasVisibleTitle), [sources.windows]);

  const selectedDisplay = displays.find((d) => d.id === displayId) ?? null;
  const selectedWindow = windows.find((w) => w.id === windowId) ?? null;

  const displayItems = useMemo(
    () =>
      displays.map((d) => ({
        id: d.id,
        label: d.label || 'Display',
        sublabel: `${Math.round(d.bounds.width * d.scaleFactor)}×${Math.round(
          d.bounds.height * d.scaleFactor,
        )}${d.isPrimary ? ' · Primary' : ''}`,
      })),
    [displays],
  );
  const windowItems = useMemo(
    () => windows.map((w) => ({ id: w.id, label: w.appName || 'App', sublabel: w.title })),
    [windows],
  );
  const cameraItems = useMemo(
    () => [{ id: NONE_ID, label: 'No camera' }, ...devices.cameras.map((d) => ({ id: d.id, label: d.label }))],
    [devices.cameras],
  );
  const micItems = useMemo(
    () => [{ id: NONE_ID, label: 'No microphone' }, ...devices.mics.map((d) => ({ id: d.id, label: d.label }))],
    [devices.mics],
  );

  const selectedArea = selectedDisplay ? (areas[selectedDisplay.id] ?? null) : null;

  const buildConfig = useCallback((): RecordingConfig | null => {
    let source: CaptureSource | null = null;
    if (sourceKind === 'display' && selectedDisplay) {
      source = { kind: 'display', displayId: selectedDisplay.id };
    } else if (sourceKind === 'window' && selectedWindow) {
      source = { kind: 'window', windowId: selectedWindow.id, displayId: selectedWindow.displayId };
    } else if (sourceKind === 'area' && selectedDisplay && selectedArea) {
      source = { kind: 'area', displayId: selectedDisplay.id, rect: selectedArea };
    }
    if (!source) return null;
    return {
      source,
      fps,
      systemAudio,
      ...(webcamId !== null ? { webcam: { deviceId: webcamId } } : {}),
      ...(micId !== null ? { mic: { deviceId: micId, noiseSuppression: false } } : {}),
      countdownSec,
    };
  }, [sourceKind, selectedDisplay, selectedWindow, selectedArea, fps, countdownSec, systemAudio, webcamId, micId]);

  const pickAreaNow = useCallback(async () => {
    const display = selectedDisplay;
    if (!display || pickingArea) return;
    setPickingArea(true);
    try {
      const rect = await sc.invoke('sources:pickArea', display.id);
      if (rect) setAreas((prev) => ({ ...prev, [display.id]: rect }));
    } catch (err) {
      setError(cleanIpcError(err instanceof Error ? err.message : String(err)));
    } finally {
      setPickingArea(false);
    }
  }, [selectedDisplay, pickingArea]);

  const startRecording = useCallback(async () => {
    const config = buildConfig();
    if (!config) return;
    setBusy(true);
    setError(null);
    setWarning(null);
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
        setWarning('Window capture isn’t available yet — pick a screen instead.');
      } else {
        setError(cleanIpcError(message));
      }
    } finally {
      setBusy(false);
    }
  }, [buildConfig, refreshPerms]);

  const stopRecording = useCallback(async () => {
    try {
      await sc.invoke('recording:stop');
    } catch (err) {
      setError(cleanIpcError(err instanceof Error ? err.message : String(err)));
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
  const canRecord = isIdleLike && !busy && buildConfig() !== null;

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

  const handleKindChange = (kind: SourceKind) => {
    setSourceKind(kind);
    void refreshSources().then((next) => {
      if (!next) return;
      setWindowId((id) =>
        id && next.windows.some((w) => w.id === id && hasVisibleTitle(w)) ? id : null,
      );
      setDisplayId((id) => {
        if (id && next.displays.some((d) => d.id === id)) return id;
        const primary = next.displays.find((d) => d.isPrimary) ?? next.displays[0];
        return primary?.id ?? null;
      });
    });
  };

  if (!ready || (sc.platform === 'darwin' && perms === null)) {
    return <div className="recorder loading" />;
  }
  if (needsGate && perms !== null) {
    return <PermissionsGate status={perms} />;
  }

  const controlsDisabled = !isIdleLike || busy;

  return (
    <div className="recorder">
      <header className="rec-header">
        <span className="logo-dot" />
        <span className="app-name">SmoothCut</span>
        {hotkeyLabel ? (
          <span className="hotkey-hint" title="Start / stop recording">
            {hotkeyLabel}
          </span>
        ) : null}
      </header>

      {needsRelaunch ? (
        <div className="banner warn">
          <span className="banner-text">
            Screen Recording was granted — macOS applies it after a relaunch.
          </span>
          <button
            type="button"
            className="mini"
            onClick={() => void sc.invoke('app:relaunch')}
          >
            Relaunch SmoothCut
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="banner error">
          <span className="banner-text">{error}</span>
          <button
            type="button"
            className="banner-dismiss"
            aria-label="Dismiss"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      {warning ? (
        <div className="banner warn">
          <span className="banner-text">{warning}</span>
          <button
            type="button"
            className="banner-dismiss"
            aria-label="Dismiss"
            onClick={() => setWarning(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="rec-main">
        <Segmented<SourceKind>
          ariaLabel="Capture source type"
          value={sourceKind}
          onChange={handleKindChange}
          disabled={controlsDisabled}
          options={[
            { value: 'display', label: 'Screen' },
            { value: 'window', label: 'Window' },
            { value: 'area', label: 'Area' },
          ]}
        />

        {sourceKind === 'window' ? (
          <Dropdown
            items={windowItems}
            selectedId={windowId}
            placeholder="Choose a window…"
            searchable
            searchPlaceholder="Search windows…"
            disabled={controlsDisabled}
            onSelect={setWindowId}
            onOpen={() => void refreshSources()}
          />
        ) : (
          <Dropdown
            items={displayItems}
            selectedId={displayId}
            placeholder="Choose a screen…"
            disabled={controlsDisabled}
            onSelect={setDisplayId}
            onOpen={() => void refreshSources()}
          />
        )}

        {sourceKind === 'area' ? (
          <div className="area-row">
            {selectedArea ? (
              <span className="area-chip" title="Capture area (physical pixels)">
                {selectedArea.width}×{selectedArea.height} px
              </span>
            ) : (
              <span className="area-chip empty">No area selected</span>
            )}
            <button
              type="button"
              className="mini"
              disabled={controlsDisabled || pickingArea || !selectedDisplay}
              onClick={() => void pickAreaNow()}
            >
              {pickingArea ? 'Picking…' : selectedArea ? 'Re-pick' : 'Select area…'}
            </button>
          </div>
        ) : null}

        <div className="options-row">
          <div className="opt">
            <span className="opt-label">Frame rate</span>
            <Segmented<'30' | '60'>
              small
              ariaLabel="Frame rate"
              value={String(fps) as '30' | '60'}
              onChange={(v) => setFps(v === '60' ? 60 : 30)}
              disabled={controlsDisabled}
              options={[
                { value: '30', label: '30 fps' },
                { value: '60', label: '60 fps' },
              ]}
            />
          </div>
          <div className="opt">
            <span className="opt-label">Countdown</span>
            <Segmented<'0' | '3' | '5' | '10'>
              small
              ariaLabel="Countdown"
              value={String(countdownSec) as '0' | '3' | '5' | '10'}
              onChange={(v) => setCountdownSec(Number(v) as CountdownSec)}
              disabled={controlsDisabled}
              options={[
                { value: '0', label: 'Off' },
                { value: '3', label: '3s' },
                { value: '5', label: '5s' },
                { value: '10', label: '10s' },
              ]}
            />
          </div>
        </div>

        <div className="opt">
          <span className="opt-label">Camera</span>
          <Dropdown
            items={cameraItems}
            selectedId={webcamId ?? NONE_ID}
            placeholder="No camera"
            disabled={controlsDisabled}
            onSelect={(id) => setWebcamId(id === NONE_ID ? null : id)}
            onOpen={() => void refreshDevices()}
          />
        </div>
        <div className="opt">
          <span className="opt-label">Microphone</span>
          <Dropdown
            items={micItems}
            selectedId={micId ?? NONE_ID}
            placeholder="No microphone"
            disabled={controlsDisabled}
            onSelect={(id) => setMicId(id === NONE_ID ? null : id)}
            onOpen={() => void refreshDevices()}
          />
        </div>
        <div className="opt">
          <span className="opt-label">System audio</span>
          <Segmented<'off' | 'on'>
            small
            ariaLabel="System audio"
            value={systemAudio ? 'on' : 'off'}
            onChange={(v) => setSystemAudio(v === 'on')}
            disabled={controlsDisabled}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
          />
        </div>

        <div className="record-area">
          {isRecording ? (
            <div className="live">
              <div className="live-timer">
                <span className="live-dot" />
                {formatDuration(elapsedMs)}
              </div>
              <button
                type="button"
                className="stop-btn"
                aria-label="Stop recording"
                onClick={() => void stopRecording()}
              >
                <span className="stop-icon" />
              </button>
              <button type="button" className="ghost" onClick={() => void cancelRecording()}>
                Cancel
              </button>
            </div>
          ) : isTransitional ? (
            <div className="transitional">
              <span className="spinner" />
              <span>{status.state === 'stopping' ? 'Saving recording…' : 'Starting…'}</span>
            </div>
          ) : (
            <div className="idle-area">
              <button
                type="button"
                className="record-btn"
                aria-label="Start recording"
                disabled={!canRecord}
                onClick={() => void startRecording()}
              />
              <span className="record-hint">
                {canRecord
                  ? `Record ${sourceKind === 'window' ? 'window' : sourceKind === 'area' ? 'area' : 'screen'}`
                  : sourceKind === 'window'
                    ? 'Choose a window to record'
                    : sourceKind === 'area'
                      ? 'Select an area to record'
                      : 'Choose a screen to record'}
              </span>
            </div>
          )}
        </div>
      </div>

      <RecentList refreshKey={recentKey} />

      {isCountdown ? (
        <div className="countdown-overlay">
          <div
            key={Math.max(1, Math.ceil(status.countdownRemaining ?? 0))}
            className="countdown-num"
          >
            {Math.max(1, Math.ceil(status.countdownRemaining ?? 0))}
          </div>
          <button type="button" className="ghost" onClick={() => void cancelRecording()}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
