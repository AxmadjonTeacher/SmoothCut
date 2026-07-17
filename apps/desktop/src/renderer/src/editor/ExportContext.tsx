/**
 * Owns the export job (Worker + IPC chunk chain) at the editor-window level,
 * separate from ExportDialog's mount state, so the job survives the dialog
 * closing — it only tears down with the window itself (useExport's own
 * unmount-cleanup effect). ExportDialog and the header status pill both read
 * this context; neither owns the job.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useExport } from './useExport';
import type { ExportHandle } from './useExport';

interface ExportContextValue extends ExportHandle {
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

const ExportContext = createContext<ExportContextValue | null>(null);

export function ExportProvider({ children }: { children: ReactNode }) {
  const exportHandle = useExport();
  const [dialogOpen, setDialogOpen] = useState(false);

  const dialogOpenRef = useRef(dialogOpen);
  dialogOpenRef.current = dialogOpen;
  const prevPhaseRef = useRef(exportHandle.state.phase);

  // Fire a native notification exactly once per running -> done/error edge,
  // and only when the dialog wasn't open to see it happen live.
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = exportHandle.state.phase;
    if (prevPhase !== 'running') return;
    const state = exportHandle.state;
    if (state.phase !== 'done' && state.phase !== 'error') return;
    if (dialogOpenRef.current) return;
    const result =
      state.phase === 'done'
        ? { ok: true as const, destination: state.destination, sizeBytes: state.sizeBytes }
        : { ok: false as const, message: state.message };
    void window.smoothcut.invoke('notify:exportFinished', result).catch(() => undefined);
  }, [exportHandle.state]);

  useEffect(() => window.smoothcut.on('export:reopenDialog', () => setDialogOpen(true)), []);

  const value: ExportContextValue = {
    ...exportHandle,
    dialogOpen,
    openDialog: () => setDialogOpen(true),
    closeDialog: () => setDialogOpen(false),
  };

  return <ExportContext.Provider value={value}>{children}</ExportContext.Provider>;
}

export function useExportContext(): ExportContextValue {
  const ctx = useContext(ExportContext);
  if (!ctx) throw new Error('useExportContext must be used within an ExportProvider');
  return ctx;
}
