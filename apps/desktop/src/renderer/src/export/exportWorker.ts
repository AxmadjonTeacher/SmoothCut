/**
 * Export worker: bakes the deterministic tracks, renders every output frame
 * through the engine SceneRenderer on an OffscreenCanvas, and encodes/muxes
 * via @smoothcut/media runExport. MP4 bytes stream back to the host as
 * transferable chunks (the host writes them to disk strictly in order).
 */
import {
  CursorTrack,
  FrameTexture,
  SceneRenderer,
  ZoomTrack,
  extractRipples,
  outputToSource,
  totalOutputDuration,
} from '@smoothcut/engine';
import type { VideoEvent } from '@smoothcut/engine';
import { runExport } from '@smoothcut/media';
import type { AudioTrackInput } from '@smoothcut/media';
import type { StreamClocks } from '@smoothcut/shared';
import type { ExportWorkerInit, HostToWorker, WorkerToHost } from './protocol';

// NOTE: pixi.js is not a direct dependency of this app (pnpm isolation), so we
// cannot swap in its WebWorkerAdapter here. The engine's scene path never
// touches the DOM-only adapter methods (no Text, no canvas pool, the render
// canvas is provided), so the default adapter works inside the worker.

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const abortController = new AbortController();
let started = false;

function post(message: WorkerToHost, transfer?: Transferable[]): void {
  if (transfer) ctx.postMessage(message, transfer);
  else ctx.postMessage(message);
}

ctx.onmessage = (ev: MessageEvent<HostToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    if (started) return;
    started = true;
    void run(msg);
  } else if (msg.type === 'abort') {
    abortController.abort();
  }
};

async function loadCursorTextures(
  cursorsBase: string,
  shapeIds: readonly string[],
): Promise<Map<string, unknown>> {
  const textures = new Map<string, unknown>();
  await Promise.all(
    shapeIds.map(async (shapeId) => {
      try {
        const res = await fetch(cursorsBase + encodeURIComponent(shapeId) + '.png');
        if (!res.ok) return;
        const bitmap = await createImageBitmap(await res.blob());
        const texture = new FrameTexture().update(bitmap);
        if (texture) textures.set(shapeId, texture);
      } catch {
        // Missing cursor image: the engine draws its default arrow.
      }
    }),
  );
  return textures;
}

/** A stream's t=0 position on the SOURCE timeline (screen video), seconds. */
function streamOffsetSec(clocks: StreamClocks, startMs: number | undefined): number {
  if (startMs === undefined) return 0;
  return Math.max(0, (startMs - clocks.screenFirstFrame) / 1000);
}

async function run(init: ExportWorkerInit): Promise<void> {
  try {
    const { project, meta, urls, events, settings } = init;
    const durationSec = meta.durationMs / 1000;

    const cursorTrack = CursorTrack.bake(events, durationSec, project.cursor.smoothing);
    const zoomTrack = ZoomTrack.bake(project.zoom.segments, project.zoom.config, cursorTrack, durationSec);
    const ripples = extractRipples(events);
    post({ type: 'log', message: 'tracks baked' });

    const canvas = new OffscreenCanvas(settings.width, settings.height);
    const renderer = await SceneRenderer.create({
      canvas,
      width: settings.width,
      height: settings.height,
    });
    renderer.applyProject(project, meta);
    renderer.setTracks(cursorTrack, zoomTrack, ripples);
    post({ type: 'log', message: 'scene renderer ready' });

    const shapeIds = [
      ...new Set(events.filter((e): e is VideoEvent & { shapeId: string } => e.type === 'cursorShape').map((e) => e.shapeId)),
    ];
    const textures = await loadCursorTextures(urls.cursorsBase, shapeIds);
    renderer.setCursorTextures({ get: (shapeId) => textures.get(shapeId) ?? null });
    post({ type: 'log', message: `cursor textures loaded ${textures.size}/${shapeIds.length}` });

    const includeCamera = urls.camera !== undefined && !project.style.webcam.hidden;

    // Audio: every recorded track, placed on the source timeline by its
    // recording-time clock offset, with the project's gains. RNNoise runs on
    // the mic only (project.audio.noiseRemoval).
    const audioTracks: AudioTrackInput[] = [];
    if (urls.mic !== undefined) {
      audioTracks.push({
        url: urls.mic,
        offsetSec: streamOffsetSec(meta.clocks, meta.clocks.micStart),
        gainDb: project.audio.micGainDb,
        noiseRemoval: project.audio.noiseRemoval,
      });
    }
    if (urls.system !== undefined) {
      audioTracks.push({
        url: urls.system,
        offsetSec: streamOffsetSec(meta.clocks, meta.clocks.systemAudioStart),
        gainDb: project.audio.systemGainDb,
      });
    }
    post({
      type: 'log',
      message: `starting runExport (audio tracks: ${audioTracks.length}, camera: ${includeCamera})`,
    });

    await runExport({
      screenUrl: urls.screen,
      cameraUrl: includeCamera ? urls.camera : undefined,
      cameraOffsetSec: streamOffsetSec(meta.clocks, meta.clocks.cameraStart),
      audioTracks,
      mapOutputToSourceSec: (tOut) => outputToSource(project.timeline, tOut),
      outputDurationSec: totalOutputDuration(project.timeline),
      output: {
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        bitrateMbps: settings.bitrateMbps,
      },
      compose: (tSourceSec, screen, camera) => {
        renderer.renderFrame(tSourceSec, { screen, webcam: camera ?? undefined });
        return canvas;
      },
      audio: { normalize: project.audio.normalize },
      sink: {
        write: (chunk, position) => {
          // Copy: the incoming view may alias a buffer the muxer reuses, and
          // transferring detaches the buffer on this side.
          const copy = chunk.slice();
          post({ type: 'chunk', data: copy.buffer, position }, [copy.buffer]);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      },
      onProgress: (p) => {
        post({
          type: 'progress',
          phase: p.phase,
          framesDone: p.framesDone,
          framesTotal: p.framesTotal,
          fpsAchieved: p.fpsAchieved,
        });
      },
      signal: abortController.signal,
    });

    post({ type: 'done' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      post({ type: 'aborted' });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      post({ type: 'error', message });
    }
  }
}
