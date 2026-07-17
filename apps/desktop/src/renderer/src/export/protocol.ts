/** Messages between the editor window and the export worker (types only). */
import type { BundleUrls, ProjectFile, RecordingMeta } from '@smoothcut/shared';
import type { VideoEvent } from '@smoothcut/engine';

export interface ExportRenderSettings {
  width: number;
  height: number;
  fps: 30 | 60;
  bitrateMbps: number;
}

export interface ExportWorkerInit {
  type: 'init';
  project: ProjectFile;
  meta: RecordingMeta;
  urls: BundleUrls;
  /** Prepared VideoEvents (plain objects, structured-cloneable). */
  events: VideoEvent[];
  settings: ExportRenderSettings;
}

export type HostToWorker = ExportWorkerInit | { type: 'abort' };

export type WorkerToHost =
  | { type: 'chunk'; data: ArrayBuffer; position: number | null }
  | {
      type: 'progress';
      phase: string;
      framesDone: number;
      framesTotal: number;
      fpsAchieved: number;
    }
  | { type: 'done' }
  | { type: 'aborted' }
  | { type: 'error'; message: string }
  /** Milestone breadcrumbs for diagnosing stalls (surfaced on the page console). */
  | { type: 'log'; message: string };
