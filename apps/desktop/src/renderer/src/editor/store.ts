/**
 * Editor state: the mutable ProjectFile plus UI state (selection, playhead).
 *
 * Every project mutation goes through `applyCommand` (immer
 * produceWithPatches) so undo/redo replays patches. Drag-style edits use the
 * gesture API: previews update the visible project without touching history,
 * the final commit lands as ONE undo entry against the pre-drag project.
 * Any committed change schedules a debounced `project:save`.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { applyPatches, enablePatches, produce, produceWithPatches } from 'immer';
import type { Patch } from 'immer';
import type { ProjectFile } from '@smoothcut/shared';
import { totalOutput } from './timelineGeom';

enablePatches();

export type Selection = { kind: 'clip'; id: string } | { kind: 'zoom'; id: string } | null;

export interface EditorState {
  projectId: string | null;
  project: ProjectFile | null;
  selection: Selection;
  /** OUTPUT-time seconds. */
  playheadSec: number;
  playing: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Zoom segment waiting for a "click the preview" fixed-target pick. */
  pickingZoomId: string | null;
}

export type CommandRecipe = (draft: ProjectFile) => void;

interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

const HISTORY_CAP = 200;
const SAVE_DEBOUNCE_MS = 1000;

export const editorStore = createStore<EditorState>(() => ({
  projectId: null,
  project: null,
  selection: null,
  playheadSec: 0,
  playing: false,
  dirty: false,
  canUndo: false,
  canRedo: false,
  pickingZoomId: null,
}));

let undoStack: HistoryEntry[] = [];
let redoStack: HistoryEntry[] = [];
let gestureBase: ProjectFile | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(editorStore, selector);
}

export function initEditor(projectId: string, project: ProjectFile): void {
  undoStack = [];
  redoStack = [];
  gestureBase = null;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  editorStore.setState({
    projectId,
    project,
    selection: null,
    playheadSec: 0,
    playing: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    pickingZoomId: null,
  });
}

// ------------------------------------------------------------------ commands

function pushHistory(entry: HistoryEntry): void {
  undoStack.push(entry);
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  redoStack = [];
}

function afterProjectChange(project: ProjectFile): void {
  const { playheadSec } = editorStore.getState();
  const total = totalOutput(project.timeline);
  if (playheadSec > total) editorStore.setState({ playheadSec: total });
  scheduleSave();
}

export function applyCommand(recipe: CommandRecipe): void {
  // A discrete command supersedes any in-flight or LEAKED gesture. Without
  // this, a gesture whose commit never fired (macOS color panel left open —
  // its 'change' only fires on close) keeps its stale base, and the next
  // slider drag silently reverts every edit made since (e.g. picking a
  // wallpaper, then Blur snapping the background to the pre-gesture gradient).
  gestureBase = null;
  const base = editorStore.getState().project;
  if (!base) return;
  const [next, patches, inversePatches] = produceWithPatches(base, recipe);
  if (patches.length === 0) return;
  pushHistory({ patches, inversePatches });
  editorStore.setState({ project: next, dirty: true, canUndo: true, canRedo: false });
  afterProjectChange(next);
}

/**
 * Gesture (drag) edits: `updateGesture` previews recipes applied to the
 * project as it was when the gesture began; `commitGesture` lands the final
 * recipe as a single undo entry. `cancelGesture` restores the base.
 */
/**
 * Marks the start of a drag gesture: the CURRENT project becomes the base all
 * updateGesture previews (and the final commit) apply to. Call this on the
 * first input of every drag so a previously leaked gesture can never donate
 * its stale base.
 */
export function beginGesture(): void {
  const { project } = editorStore.getState();
  if (project) gestureBase = project;
}

export function updateGesture(recipe: CommandRecipe): void {
  const state = editorStore.getState();
  if (!state.project) return;
  gestureBase ??= state.project;
  editorStore.setState({ project: produce(gestureBase, recipe) });
}

export function commitGesture(recipe: CommandRecipe): void {
  const base = gestureBase;
  gestureBase = null;
  if (!base) {
    applyCommand(recipe);
    return;
  }
  const [next, patches, inversePatches] = produceWithPatches(base, recipe);
  if (patches.length === 0) {
    editorStore.setState({ project: base });
    return;
  }
  pushHistory({ patches, inversePatches });
  editorStore.setState({ project: next, dirty: true, canUndo: true, canRedo: false });
  afterProjectChange(next);
}

export function cancelGesture(): void {
  const base = gestureBase;
  gestureBase = null;
  if (base) editorStore.setState({ project: base });
}

export function undo(): void {
  gestureBase = null;
  const entry = undoStack.pop();
  const { project } = editorStore.getState();
  if (!entry || !project) return;
  const prev = applyPatches(project, entry.inversePatches);
  redoStack.push(entry);
  editorStore.setState({
    project: prev,
    dirty: true,
    canUndo: undoStack.length > 0,
    canRedo: true,
  });
  afterProjectChange(prev);
}

export function redo(): void {
  gestureBase = null;
  const entry = redoStack.pop();
  const { project } = editorStore.getState();
  if (!entry || !project) return;
  const next = applyPatches(project, entry.patches);
  undoStack.push(entry);
  editorStore.setState({
    project: next,
    dirty: true,
    canUndo: true,
    canRedo: redoStack.length > 0,
  });
  afterProjectChange(next);
}

// ------------------------------------------------------------------ UI state

export function setSelection(selection: Selection): void {
  editorStore.setState({ selection });
}

export function setPlayhead(playheadSec: number): void {
  editorStore.setState({ playheadSec });
}

export function setPlaying(playing: boolean): void {
  editorStore.setState({ playing });
}

export function setPickingZoom(pickingZoomId: string | null): void {
  editorStore.setState({ pickingZoomId });
}

// ------------------------------------------------------------------ autosave

async function persist(): Promise<void> {
  const { projectId, project } = editorStore.getState();
  if (!projectId || !project) return;
  const snapshot = project;
  try {
    await window.smoothcut.invoke('project:save', projectId, snapshot);
    if (editorStore.getState().project === snapshot) {
      editorStore.setState({ dirty: false });
    }
  } catch {
    // Keep dirty; the next change reschedules a save.
  }
}

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, SAVE_DEBOUNCE_MS);
}

/** Fire the pending save immediately (beforeunload / unmount). */
export function flushSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    void persist();
  }
}
