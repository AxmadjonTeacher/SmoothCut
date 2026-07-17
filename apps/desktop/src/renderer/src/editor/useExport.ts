/**
 * Host side of the export flow: 'export:begin' -> spawn the worker -> write
 * MP4 chunks strictly in order (a sequential promise chain per chunk, awaiting
 * 'export:writeChunk' before the next) -> 'export:finalize'. Cancel posts
 * {type:'abort'} into the worker and calls 'export:abort'.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BundleUrls, ExportSettings, ProjectFile, RecordingMeta } from '@smoothcut/shared';
import type { VideoEvent } from '@smoothcut/engine';
import type { ExportWorkerInit, WorkerToHost } from '../export/protocol';

export type ExportPhase =
  | { phase: 'idle' }
  | {
      phase: 'running';
      framesDone: number;
      framesTotal: number;
      fpsAchieved: number;
      etaSec: number | null;
      stage: string;
    }
  | { phase: 'done'; destination: string; sizeBytes: number }
  | { phase: 'error'; message: string };

export interface ExportArgs {
  projectId: string;
  settings: ExportSettings;
  project: ProjectFile;
  meta: RecordingMeta;
  urls: BundleUrls;
  events: VideoEvent[];
}

interface Job {
  worker: Worker;
  exportId: string;
  chain: Promise<void>;
  failed: boolean;
  cancelled: boolean;
}

export interface ExportHandle {
  state: ExportPhase;
  start: (args: ExportArgs) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useExport(): ExportHandle {
  const [state, setState] = useState<ExportPhase>({ phase: 'idle' });
  const jobRef = useRef<Job | null>(null);

  const teardown = useCallback((job: Job) => {
    job.worker.terminate();
    if (jobRef.current === job) jobRef.current = null;
  }, []);

  const failJob = useCallback(
    (job: Job, message: string) => {
      if (job.failed || job.cancelled) return;
      job.failed = true;
      void job.chain
        .catch(() => undefined)
        .then(() => window.smoothcut.invoke('export:abort', job.exportId))
        .catch(() => undefined);
      teardown(job);
      setState({ phase: 'error', message });
    },
    [teardown],
  );

  const start = useCallback(
    async (args: ExportArgs) => {
      if (jobRef.current) return;
      setState({ phase: 'running', framesDone: 0, framesTotal: 0, fpsAchieved: 0, etaSec: null, stage: 'preparing' });

      let exportId: string;
      try {
        ({ exportId } = await window.smoothcut.invoke('export:begin', args.projectId, args.settings));
      } catch (error) {
        setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
        return;
      }

      const worker = new Worker(new URL('../export/exportWorker.ts', import.meta.url), {
        type: 'module',
      });
      const job: Job = { worker, exportId, chain: Promise.resolve(), failed: false, cancelled: false };
      jobRef.current = job;

      worker.onerror = (ev) => failJob(job, ev.message || 'Export worker crashed');

      worker.onmessage = (ev: MessageEvent<WorkerToHost>) => {
        const msg = ev.data;
        switch (msg.type) {
          case 'chunk': {
            job.chain = job.chain.then(async () => {
              if (job.failed || job.cancelled) return;
              try {
                await window.smoothcut.invoke('export:writeChunk', job.exportId, msg.data, msg.position);
              } catch (error) {
                failJob(job, error instanceof Error ? error.message : 'Failed writing to disk');
              }
            });
            break;
          }
          case 'progress': {
            if (job.failed || job.cancelled) break;
            const remaining = msg.framesTotal - msg.framesDone;
            setState({
              phase: 'running',
              framesDone: msg.framesDone,
              framesTotal: msg.framesTotal,
              fpsAchieved: msg.fpsAchieved,
              etaSec: msg.fpsAchieved > 0.01 ? remaining / msg.fpsAchieved : null,
              stage: msg.phase,
            });
            break;
          }
          case 'done': {
            void job.chain
              .then(async () => {
                if (job.failed || job.cancelled) return;
                const { sizeBytes } = await window.smoothcut.invoke('export:finalize', job.exportId);
                teardown(job);
                setState({ phase: 'done', destination: args.settings.destination, sizeBytes });
              })
              .catch((error: unknown) => {
                failJob(job, error instanceof Error ? error.message : 'Failed finalizing the file');
              });
            break;
          }
          case 'aborted': {
            void job.chain
              .catch(() => undefined)
              .then(() => window.smoothcut.invoke('export:abort', job.exportId))
              .catch(() => undefined);
            teardown(job);
            setState({ phase: 'idle' });
            break;
          }
          case 'error': {
            failJob(job, msg.message);
            break;
          }
          case 'log': {
            console.log(`[devharness] worker: ${msg.message}`);
            break;
          }
        }
      };

      const init: ExportWorkerInit = {
        type: 'init',
        project: args.project,
        meta: args.meta,
        urls: args.urls,
        events: args.events,
        settings: {
          width: args.settings.width,
          height: args.settings.height,
          fps: args.settings.fps,
          bitrateMbps: args.settings.bitrateMbps,
        },
      };
      worker.postMessage(init);
    },
    [failJob, teardown],
  );

  const cancel = useCallback(() => {
    const job = jobRef.current;
    if (!job) return;
    job.cancelled = true;
    job.worker.postMessage({ type: 'abort' });
    // If the worker never answers (wedged), force-abort after a grace period.
    setTimeout(() => {
      if (jobRef.current === job) {
        void window.smoothcut.invoke('export:abort', job.exportId).catch(() => undefined);
        teardown(job);
        setState({ phase: 'idle' });
      }
    }, 3000);
  }, [teardown]);

  const reset = useCallback(() => {
    if (!jobRef.current) setState({ phase: 'idle' });
  }, []);

  useEffect(
    () => () => {
      const job = jobRef.current;
      if (job) {
        job.cancelled = true;
        job.worker.terminate();
        void window.smoothcut.invoke('export:abort', job.exportId).catch(() => undefined);
        jobRef.current = null;
      }
    },
    [],
  );

  return { state, start, cancel, reset };
}
