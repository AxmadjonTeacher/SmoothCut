/**
 * Dev harness hook: when the editor window is opened with ?devExport=<path>,
 * run an export to that path automatically and report via console markers the
 * main-process harness watches ("[devharness] export-done/-error"). Inactive
 * in normal use — the param is only set by main/devHarness.ts.
 */
import { useEffect, useRef } from 'react';
import type { BundleUrls, ProjectFile, RecordingMeta } from '@smoothcut/shared';
import type { VideoEvent } from '@smoothcut/engine';
import { openVideo, probeExportSupport } from '@smoothcut/media';
import { useExport } from './useExport';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

/** Page-context probe of the demux path, to bisect page-vs-worker failures. */
async function probeDemux(urls: BundleUrls): Promise<void> {
  const support = await withTimeout(probeExportSupport(), 10_000, 'probeExportSupport');
  console.log(`[devharness] probe support ${JSON.stringify(support)}`);
  const t0 = performance.now();
  const video = await withTimeout(openVideo(urls.screen), 10_000, 'openVideo');
  console.log(
    `[devharness] probe openVideo ${video.width}x${video.height} dur=${video.durationSec.toFixed(2)} in ${(performance.now() - t0).toFixed(0)}ms`,
  );
  const frame = await withTimeout(video.cursor.getFrameAt(1.0), 10_000, 'getFrameAt');
  console.log(`[devharness] probe frame@1s ${frame ? `${frame.codedWidth}x${frame.codedHeight}` : 'null'}`);
  frame?.close();
  await video.cursor.close();
}

export interface DevExportSize {
  width: number;
  height: number;
  fps: 30 | 60;
}

/** "3840x2160@30" (SMOOTHCUT_DEV_EXPORT_SIZE) → size, or null when malformed. */
export function parseDevExportSize(raw: string): DevExportSize | null {
  const match = /^(\d+)x(\d+)@(30|60)$/.exec(raw.trim());
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 2 || height < 2) return null;
  return { width, height, fps: match[3] === '60' ? 60 : 30 };
}

interface Props {
  projectId: string;
  destination: string;
  /** Optional override from ?devExportSize=WxH@fps (default 1920x1080@30). */
  size?: DevExportSize | undefined;
  project: ProjectFile;
  meta: RecordingMeta;
  urls: BundleUrls;
  events: VideoEvent[];
}

export function DevAutoExport({ projectId, destination, size, project, meta, urls, events }: Props) {
  const { state, start } = useExport();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const settings = {
      width: size?.width ?? 1920,
      height: size?.height ?? 1080,
      fps: size?.fps ?? 30,
      bitrateMbps: 8,
      destination,
    };
    console.log(
      `[devharness] export-start ${settings.width}x${settings.height}@${settings.fps}`,
    );
    void probeDemux(urls).catch((e: unknown) =>
      console.log(`[devharness] probe-error ${e instanceof Error ? e.message : String(e)}`),
    );
    void start({ projectId, settings, project, meta, urls, events });
  }, [start, projectId, destination, size, project, meta, urls, events]);

  useEffect(() => {
    if (state.phase === 'done') console.log(`[devharness] export-done ${state.destination}`);
    if (state.phase === 'error') console.log(`[devharness] export-error ${state.message}`);
    if (state.phase === 'running' && state.framesDone % 60 === 0 && state.framesDone > 0) {
      console.log(`[devharness] export-progress ${state.framesDone}/${state.framesTotal} (${state.stage})`);
    }
  }, [state]);

  return null;
}
