/** Transport bar: play/pause, time readout, split + zoom-batch actions. */
import { useCallback } from 'react';
import { generateZoomSegments, outputToSource, splitAt } from '@smoothcut/engine';
import type { VideoEvent } from '@smoothcut/engine';
import { applyCommand, editorStore, redo, undo, useEditor } from './store';
import type { PlaybackControls } from './usePlayback';
import { formatTime, totalOutput } from './timelineGeom';
import { uniqueZoomIds } from './util';

interface TransportProps {
  controls: PlaybackControls;
  events: VideoEvent[];
  durationSec: number;
}

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="1.5" y="1" width="3.2" height="10" rx="1" fill="currentColor" />
      <rect x="7.3" y="1" width="3.2" height="10" rx="1" fill="currentColor" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M2.5 1.2 L10.8 6 L2.5 10.8 Z" fill="currentColor" />
    </svg>
  );
}

export function Transport({ controls, events, durationSec }: TransportProps) {
  const playing = useEditor((s) => s.playing);
  const playheadSec = useEditor((s) => s.playheadSec);
  const timeline = useEditor((s) => s.project?.timeline ?? null);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const total = timeline ? totalOutput(timeline) : 0;

  const onSplit = useCallback(() => {
    const { project, playheadSec: head } = editorStore.getState();
    if (!project) return;
    const tSrc = outputToSource(project.timeline, head);
    if (tSrc === null) return;
    const next = splitAt(project.timeline, tSrc);
    if (next.length !== project.timeline.length) {
      applyCommand((d) => {
        d.timeline = next;
      });
    }
  }, []);

  const onRegenerate = useCallback(() => {
    const { project } = editorStore.getState();
    if (!project) return;
    if (!window.confirm('Regenerate auto zooms? Manual zoom segments are kept.')) return;
    const manual = project.zoom.segments.filter((s) => s.origin === 'manual');
    const generated = generateZoomSegments(events, durationSec, project.zoom.config);
    const ids = uniqueZoomIds(manual, generated.length);
    const renamed = generated.map((s, i) => ({ ...s, id: ids[i] ?? s.id }));
    applyCommand((d) => {
      d.zoom.segments = [...manual, ...renamed].sort((a, b) => a.start - b.start);
    });
  }, [events, durationSec]);

  const onRemoveAll = useCallback(() => {
    const { project } = editorStore.getState();
    if (!project || project.zoom.segments.length === 0) return;
    if (!window.confirm('Remove all zoom segments?')) return;
    applyCommand((d) => {
      d.zoom.segments = [];
    });
  }, []);

  return (
    <div className="transport">
      <button
        type="button"
        className="transport-play"
        onClick={controls.toggle}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        <PlayIcon playing={playing} />
      </button>
      <span className="transport-time">
        {formatTime(Math.min(playheadSec, total))}
        <span className="transport-time-total"> / {formatTime(total)}</span>
      </span>
      <div className="transport-spacer" />
      <button type="button" onClick={onSplit} title="Split the clip at the playhead">
        Split
      </button>
      <button type="button" onClick={onRegenerate} title="Regenerate automatic zooms from clicks">
        Auto-zoom
      </button>
      <button type="button" onClick={onRemoveAll} title="Remove every zoom segment">
        Clear zooms
      </button>
      <div className="transport-sep" />
      <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Cmd+Z)">
        Undo
      </button>
      <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Shift+Cmd+Z)">
        Redo
      </button>
    </div>
  );
}
