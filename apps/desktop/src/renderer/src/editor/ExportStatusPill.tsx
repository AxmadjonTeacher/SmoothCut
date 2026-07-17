/** Compact header indicator for a backgrounded export (dialog closed). */
import type { ExportPhase } from './useExport';
import { formatEta } from './util';

interface ExportStatusPillProps {
  state: Extract<ExportPhase, { phase: 'running' | 'done' | 'error' }>;
  onClick: () => void;
  onDismiss: () => void;
}

export function ExportStatusPill({ state, onClick, onDismiss }: ExportStatusPillProps) {
  if (state.phase === 'running') {
    const pct =
      state.framesTotal > 0 ? Math.min(100, (state.framesDone / state.framesTotal) * 100) : 0;
    return (
      <button type="button" className="export-status-pill running" onClick={onClick}>
        <span className="export-status-pill-fill" style={{ width: `${pct}%` }} />
        <span className="export-status-pill-label">
          Exporting… {Math.round(pct)}%
          {state.etaSec !== null ? ` · ETA ${formatEta(state.etaSec)}` : ''}
        </span>
      </button>
    );
  }

  const done = state.phase === 'done';
  return (
    <span className={`export-status-pill ${done ? 'done' : 'error'}`}>
      <button type="button" className="export-status-pill-label" onClick={onClick}>
        {done ? 'Export complete' : 'Export failed'}
      </button>
      <button
        type="button"
        className="export-status-pill-dismiss"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
      >
        ×
      </button>
    </span>
  );
}
