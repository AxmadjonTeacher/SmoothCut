/** Export modal: resolution/fps/quality/destination + progress + result. */
import { useEffect, useMemo, useState } from 'react';
import type { BundleUrls, ProjectFile, RecordingMeta } from '@smoothcut/shared';
import type { VideoEvent } from '@smoothcut/engine';
import { probeExportSupport } from '@smoothcut/media';
import type { ExportSupport } from '@smoothcut/media';
import { useExport } from './useExport';
import { formatBytes, formatEta, resolutionTiers, resolveCanvasSize } from './util';
import type { ResolutionTier } from './util';

const QUALITY_OPTIONS = [
  { label: 'Good · 8 Mbps', bitrateMbps: 8 },
  { label: 'High · 12 Mbps', bitrateMbps: 12 },
  { label: 'Ultra · 20 Mbps', bitrateMbps: 20 },
];

const UNSUPPORTED_4K = 'This machine’s H.264 encoder doesn’t support 4K output.';
const UNSUPPORTED_4K60 = 'This machine’s H.264 encoder doesn’t support 4K at 60 fps — use 30 fps.';

/** ~4K tiers need the encoder's 4K capability bits. */
function is4kTier(tier: ResolutionTier): boolean {
  return Math.min(tier.width, tier.height) >= 2000;
}

interface ExportDialogProps {
  projectId: string;
  project: ProjectFile;
  meta: RecordingMeta;
  urls: BundleUrls;
  events: VideoEvent[];
  onClose: () => void;
}

export function ExportDialog({ projectId, project, meta, urls, events, onClose }: ExportDialogProps) {
  const { state, start, cancel, reset } = useExport();

  const canvas = resolveCanvasSize(project, meta);
  const tiers = useMemo(() => resolutionTiers(canvas.width, canvas.height), [canvas.width, canvas.height]);

  const [tierIdx, setTierIdx] = useState(0);
  const [fps, setFps] = useState<30 | 60>(60);
  const [bitrateMbps, setBitrateMbps] = useState(12);
  const [destination, setDestination] = useState<string | null>(null);
  const [support, setSupport] = useState<ExportSupport | null>(null);

  // Probe WebCodecs encoder capabilities once; until it lands nothing is gated.
  useEffect(() => {
    let cancelled = false;
    void probeExportSupport()
      .then((s) => {
        if (!cancelled) setSupport(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTier = tiers[tierIdx] ?? tiers[0] ?? null;
  const no4k = support !== null && !support.h264_4k30 && !support.h264_4k60;
  const no4k60 = support !== null && !support.h264_4k60;
  const selected4k = selectedTier !== null && is4kTier(selectedTier);

  // If the selection lands on an unsupported combination, degrade it.
  useEffect(() => {
    if (selected4k && no4k) setTierIdx(0);
    else if (selected4k && no4k60 && fps === 60) setFps(30);
  }, [selected4k, no4k, no4k60, fps]);

  const running = state.phase === 'running';

  const pickDestination = async (): Promise<string | null> => {
    const picked = await window.smoothcut.invoke('export:pickDestination', `${project.name}.mp4`);
    if (picked) setDestination(picked);
    return picked;
  };

  const onExport = async (): Promise<void> => {
    const tier = selectedTier;
    if (!tier) return;
    let dest = destination;
    if (!dest) dest = await pickDestination();
    if (!dest) return;
    await start({
      projectId,
      project,
      meta,
      urls,
      events,
      settings: { width: tier.width, height: tier.height, fps, bitrateMbps, destination: dest },
    });
  };

  const close = (): void => {
    if (running) return;
    reset();
    onClose();
  };

  const progressPct =
    state.phase === 'running' && state.framesTotal > 0
      ? Math.min(100, (state.framesDone / state.framesTotal) * 100)
      : 0;

  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h2>Export video</h2>

        {state.phase === 'idle' ? (
          <>
            <label className="control-row">
              <span className="control-label">Resolution</span>
              <select
                value={tierIdx}
                onChange={(e) => setTierIdx(Number(e.target.value))}
                title={no4k ? UNSUPPORTED_4K : undefined}
              >
                {tiers.map((t, i) => {
                  const gated = is4kTier(t) && no4k;
                  return (
                    <option key={t.label} value={i} disabled={gated} title={gated ? UNSUPPORTED_4K : undefined}>
                      {t.label} · {t.width}x{t.height}
                      {gated ? ' (unsupported)' : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="control-row">
              <span className="control-label">Frame rate</span>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value) === 30 ? 30 : 60)}
                title={selected4k && no4k60 ? UNSUPPORTED_4K60 : undefined}
              >
                <option value={30}>30 fps</option>
                <option value={60} disabled={selected4k && no4k60}>
                  60 fps{selected4k && no4k60 ? ' (unsupported at 4K)' : ''}
                </option>
              </select>
            </label>
            {selected4k && no4k60 ? <p className="export-note">{UNSUPPORTED_4K60}</p> : null}
            <label className="control-row">
              <span className="control-label">Quality</span>
              <select value={bitrateMbps} onChange={(e) => setBitrateMbps(Number(e.target.value))}>
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q.bitrateMbps} value={q.bitrateMbps}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="control-row">
              <span className="control-label">Save to</span>
              <button type="button" className="export-dest" onClick={() => void pickDestination()}>
                {destination ?? 'Choose…'}
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={() => void onExport()}>
                Export
              </button>
            </div>
          </>
        ) : null}

        {state.phase === 'running' ? (
          <>
            <div className="export-progress-track">
              <div className="export-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="export-progress-stats">
              {state.framesTotal > 0 ? (
                <span>
                  {state.framesDone}/{state.framesTotal} frames · {state.fpsAchieved.toFixed(1)} fps
                  {state.etaSec !== null ? ` · ETA ${formatEta(state.etaSec)}` : ''}
                </span>
              ) : (
                <span>Preparing…</span>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="danger" onClick={cancel}>
                Cancel export
              </button>
            </div>
          </>
        ) : null}

        {state.phase === 'done' ? (
          <>
            <p className="export-done">
              Export complete{state.sizeBytes > 0 ? ` · ${formatBytes(state.sizeBytes)}` : ''}.
            </p>
            <p className="export-dest-path">{state.destination}</p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => void window.smoothcut.invoke('shell:showItemInFolder', state.destination)}
              >
                {window.smoothcut.platform === 'darwin' ? 'Show in Finder' : 'Show in folder'}
              </button>
              <button type="button" onClick={reset}>
                Export another
              </button>
              <button type="button" className="primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        ) : null}

        {state.phase === 'error' ? (
          <>
            <p className="export-error">Export failed: {state.message}</p>
            <div className="modal-actions">
              <button type="button" onClick={reset}>
                Try again
              </button>
              <button type="button" onClick={close}>
                Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
