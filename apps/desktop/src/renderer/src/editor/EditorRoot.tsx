/**
 * Editor window root: loads the project bundle + events, seeds the store,
 * generates first-open auto-zooms, and lays out header / preview / sidebar /
 * transport / timeline.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SPRING_TUNING,
  deleteSegment,
  generateZoomSegments,
  prepareEvents,
} from '@smoothcut/engine';
import type { SpringTuning, VideoEvent } from '@smoothcut/engine';
import { parseEventsJsonl } from '@smoothcut/shared';
import type { BundleUrls, ProjectFile, RecordingMeta, StreamClocks } from '@smoothcut/shared';
import { dbToGain } from '@smoothcut/media';
import {
  applyCommand,
  editorStore,
  flushSave,
  initEditor,
  redo,
  setPickingZoom,
  setSelection,
  undo,
  useEditor,
} from './store';
import { useTracks } from './useTracks';
import { usePlayback } from './usePlayback';
import type { SyncedMedia } from './usePlayback';
import { PreviewCanvas } from './PreviewCanvas';
import { Transport } from './Transport';
import { Timeline } from './Timeline';
import { Sidebar } from './Sidebar';
import { DevAutoExport, parseDevExportSize } from './DevAutoExport';
import { ExportDialog } from './ExportDialog';
import { FolderIcon } from '../recorder/icons';
import './editor.css';

interface LoadedBundle {
  meta: RecordingMeta;
  urls: BundleUrls;
  events: VideoEvent[];
}

export default function EditorRoot({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<LoadedBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const bundle = await window.smoothcut.invoke('project:load', projectId);
        const eventsText = await window.smoothcut.invoke('project:eventsText', projectId);
        if (cancelled) return;
        const events = prepareEvents(parseEventsJsonl(eventsText), bundle.meta);
        initEditor(projectId, bundle.project);
        // First open: seed auto zooms from click clusters (unless the
        // recording was made with auto-zoom off).
        if (
          bundle.project.zoom.autoGenerate !== false &&
          bundle.project.zoom.segments.length === 0 &&
          events.some((e) => e.type === 'down')
        ) {
          const generated = generateZoomSegments(
            events,
            bundle.meta.durationMs / 1000,
            bundle.project.zoom.config,
          );
          if (generated.length > 0) {
            applyCommand((d) => {
              d.zoom.segments = generated;
            });
          }
        }
        setLoaded({ meta: bundle.meta, urls: bundle.urls, events });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    window.addEventListener('beforeunload', flushSave);
    return () => {
      window.removeEventListener('beforeunload', flushSave);
      flushSave();
    };
  }, []);

  if (error) {
    return (
      <div className="editor-fallback">
        <p>Could not open this project.</p>
        <p className="editor-fallback-detail">{error}</p>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="editor-fallback">
        <p className="editor-fallback-dim">Opening project…</p>
      </div>
    );
  }
  return <EditorShell projectId={projectId} bundle={loaded} />;
}

function deleteSelection(): void {
  const { selection, project } = editorStore.getState();
  if (!selection || !project) return;
  if (selection.kind === 'clip') {
    if (project.timeline.length <= 1) return;
    const next = deleteSegment(project.timeline, selection.id);
    applyCommand((d) => {
      d.timeline = next;
    });
  } else {
    applyCommand((d) => {
      d.zoom.segments = d.zoom.segments.filter((z) => z.id !== selection.id);
    });
  }
  setSelection(null);
}

/** A stream's t=0 position on the SOURCE timeline (screen video), seconds. */
function streamOffsetSec(clocks: StreamClocks, startMs: number | undefined): number {
  if (startMs === undefined) return 0;
  return Math.max(0, (startMs - clocks.screenFirstFrame) / 1000);
}

/** "/Users/me/Movies" → "~/Movies" for tooltips. */
function abbreviateHome(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~');
}

/** Header button: pick the default export folder (persisted in settings). */
function ExportFolderButton() {
  const [dir, setDir] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.smoothcut
      .invoke('settings:get')
      .then((s) => {
        if (!cancelled) setDir(s.exportDefaults.directory ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = useCallback(async () => {
    try {
      const picked = await window.smoothcut.invoke('export:pickDirectory');
      if (picked !== null) setDir(picked);
    } catch {
      // dialog failed — keep the current folder
    }
  }, []);

  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Choose export folder"
      title={`Save exports to: ${dir !== null ? abbreviateHome(dir) : 'Downloads'}`}
      onClick={() => void pick()}
    >
      <FolderIcon />
    </button>
  );
}

function EditorShell({ projectId, bundle }: { projectId: string; bundle: LoadedBundle }) {
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const pickingZoomId = useEditor((s) => s.pickingZoomId);

  const [tuning, setTuning] = useState<SpringTuning>(DEFAULT_SPRING_TUNING);
  const [exportOpen, setExportOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camRef = useRef<HTMLVideoElement | null>(null);
  const micRef = useRef<HTMLAudioElement | null>(null);
  const sysRef = useRef<HTMLAudioElement | null>(null);

  const { meta, urls, events } = bundle;
  const durationSec = meta.durationMs / 1000;
  const clocks = meta.clocks;
  const camOffsetSec = streamOffsetSec(clocks, clocks.cameraStart);
  const micOffsetSec = streamOffsetSec(clocks, clocks.micStart);
  const sysOffsetSec = streamOffsetSec(clocks, clocks.systemAudioStart);

  const getSynced = useCallback((): SyncedMedia[] => {
    const synced: SyncedMedia[] = [];
    if (camRef.current) synced.push({ el: camRef.current, offsetSec: camOffsetSec });
    if (micRef.current) synced.push({ el: micRef.current, offsetSec: micOffsetSec });
    if (sysRef.current) synced.push({ el: sysRef.current, offsetSec: sysOffsetSec });
    return synced;
  }, [camOffsetSec, micOffsetSec, sysOffsetSec]);
  const controls = usePlayback(videoRef, getSynced);

  // Preview volumes follow the project's audio gains (dB → linear, 0..1).
  const micGainDb = project?.audio.micGainDb ?? 0;
  const systemGainDb = project?.audio.systemGainDb ?? 0;
  useEffect(() => {
    if (micRef.current) micRef.current.volume = Math.min(1, Math.max(0, dbToGain(micGainDb)));
  }, [micGainDb]);
  useEffect(() => {
    if (sysRef.current) sysRef.current.volume = Math.min(1, Math.max(0, dbToGain(systemGainDb)));
  }, [systemGainDb]);

  const zoomSegments = project?.zoom.segments;
  const zoomConfig = project?.zoom.config;
  const smoothing = project?.cursor.smoothing ?? 0.5;
  const tracks = useTracks(
    events,
    durationSec,
    smoothing,
    tuning,
    zoomSegments ?? [],
    zoomConfig ?? { defaultLevel: 2, smoothness: 0.5, leadSec: 0.9, holdSec: 1.4, clusterGapSec: 2.5 },
  );

  const shapeIds = useMemo(
    () => [...new Set(events.filter((e) => e.type === 'cursorShape').map((e) => e.shapeId))],
    [events],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true;
      const isTextField = tag === 'TEXTAREA' || (tag === 'INPUT' && (target as HTMLInputElement).type === 'text');

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (isTextField) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === 'Escape') {
        setPickingZoom(null);
        return;
      }
      if (typing) return;
      if (e.code === 'Space') {
        e.preventDefault();
        controls.toggle();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controls]);

  const onPickTarget = useCallback((x: number, y: number) => {
    const { pickingZoomId: picking } = editorStore.getState();
    if (!picking) return;
    applyCommand((d) => {
      const z = d.zoom.segments.find((s) => s.id === picking);
      if (z) {
        z.target = { mode: 'fixed', x, y };
        z.origin = 'manual';
      }
    });
    setPickingZoom(null);
  }, []);

  const commitName = useCallback(() => {
    if (nameDraft !== null) {
      const trimmed = nameDraft.trim();
      const { project: current } = editorStore.getState();
      if (trimmed && current && trimmed !== current.name) {
        applyCommand((d) => {
          d.name = trimmed;
        });
      }
    }
    setNameDraft(null);
  }, [nameDraft]);

  if (!project) return null;

  return (
    <div className="editor-root">
      <header className="editor-header">
        <input
          className="editor-name"
          value={nameDraft ?? project.name}
          onChange={(e) => setNameDraft(e.target.value)}
          onFocus={() => setNameDraft(project.name)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setNameDraft(null);
              (e.target as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
        />
        <ExportFolderButton />
        {dirty ? <span className="editor-dirty" title="Unsaved changes">●</span> : null}
        <div className="editor-header-spacer" />
        <button type="button" className="primary" onClick={() => setExportOpen(true)}>
          Export
        </button>
      </header>

      <div className="editor-main">
        <PreviewCanvas
          project={project}
          meta={meta}
          urls={urls}
          cursorTrack={tracks.cursorTrack}
          zoomTrack={tracks.zoomTrack}
          ripples={tracks.ripples}
          shapeIds={shapeIds}
          videoRef={videoRef}
          camRef={camRef}
          camOffsetSec={camOffsetSec}
          picking={pickingZoomId !== null}
          onPickTarget={onPickTarget}
        />
        <Sidebar project={project} meta={meta} hasCamera={urls.camera !== undefined} tuning={tuning} onTuning={setTuning} />
      </div>

      {urls.mic ? <audio ref={micRef} src={urls.mic} crossOrigin="anonymous" preload="auto" /> : null}
      {urls.system ? (
        <audio ref={sysRef} src={urls.system} crossOrigin="anonymous" preload="auto" />
      ) : null}

      <div className="editor-bottom">
        <Transport controls={controls} events={events} durationSec={durationSec} />
        <Timeline project={project} durationSec={durationSec} controls={controls} />
      </div>

      {exportOpen ? (
        <ExportDialog
          projectId={projectId}
          project={project}
          meta={meta}
          urls={urls}
          events={events}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

      {devExportPath ? (
        <DevAutoExport
          projectId={projectId}
          destination={devExportPath}
          size={devExportSize ?? undefined}
          project={project}
          meta={meta}
          urls={urls}
          events={events}
        />
      ) : null}
    </div>
  );
}

const devExportPath = new URLSearchParams(window.location.search).get('devExport');
const devExportSizeRaw = new URLSearchParams(window.location.search).get('devExportSize');
const devExportSize = devExportSizeRaw ? parseDevExportSize(devExportSizeRaw) : null;
