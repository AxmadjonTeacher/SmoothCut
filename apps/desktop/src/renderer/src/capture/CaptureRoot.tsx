/**
 * Hidden capture window (?view=capture): records webcam / mic / system audio
 * with MediaRecorder and streams 1s webm chunks to main over IPC
 * ('capture:chunk'), which appends them to the recording bundle.
 *
 * Clock sync: each recorder's onstart time is mapped onto the MAIN process
 * monotonic clock via an offset measured over 'clock:now' round trips
 * (midpoint of the best-of-N RTT) and reported with 'capture:streamStarted'.
 * System audio arrives through getDisplayMedia — main's
 * setDisplayMediaRequestHandler answers with a screen source (whose video
 * track is discarded immediately) plus the OS loopback audio device.
 */
import { useEffect } from 'react';
import type { CaptureCommand, CaptureStreamKind, RecordingConfig } from '@smoothcut/shared';

const sc = window.smoothcut;

const CHUNK_MS = 1000;
const CLOCK_SAMPLES = 5;
const CAMERA_BITS_PER_SEC = 8_000_000;
const AUDIO_BITS_PER_SEC = 128_000;

function localNowMs(): number {
  return performance.timeOrigin + performance.now();
}

/** mainClock = localClock + offset. Midpoint method over the best round trip. */
async function measureClockOffset(): Promise<number> {
  let bestRtt = Infinity;
  let offset = 0;
  for (let i = 0; i < CLOCK_SAMPLES; i++) {
    const t0 = localNowMs();
    const mainNow = await sc.invoke('clock:now');
    const t1 = localNowMs();
    const rtt = t1 - t0;
    if (rtt < bestRtt) {
      bestRtt = rtt;
      offset = mainNow - (t0 + t1) / 2;
    }
  }
  return offset;
}

function pickMimeType(preferred: string, fallback: string): string {
  return MediaRecorder.isTypeSupported(preferred) ? preferred : fallback;
}

/** Empty deviceId (dev harness) = any device; otherwise require exactly it. */
function deviceConstraint(deviceId: string): MediaTrackConstraints {
  return deviceId === '' ? {} : { deviceId: { exact: deviceId } };
}

interface ActiveStream {
  kind: CaptureStreamKind;
  recorder: MediaRecorder;
  tracks: MediaStreamTrack[];
  stopped: Promise<void>;
  /** Resolves when every chunk produced so far has been written by main. */
  flush: () => Promise<void>;
}

function recordStream(
  kind: CaptureStreamKind,
  media: MediaStream,
  options: MediaRecorderOptions,
  clockOffsetMs: number,
): ActiveStream {
  const recorder = new MediaRecorder(media, options);
  let chain: Promise<void> = Promise.resolve();
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    const blob = event.data;
    chain = chain
      .then(async () => {
        const buffer = await blob.arrayBuffer();
        await sc.invoke('capture:chunk', kind, buffer);
      })
      .catch((err: unknown) => {
        void sc.invoke('capture:error', `${kind}: chunk write failed: ${String(err)}`);
      });
  };
  recorder.onstart = () => {
    void sc.invoke('capture:streamStarted', kind, clockOffsetMs + localNowMs());
  };
  recorder.onerror = (event) => {
    const message = (event as unknown as { error?: DOMException }).error?.message ?? 'unknown';
    void sc.invoke('capture:error', `${kind}: recorder error: ${message}`);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(CHUNK_MS);
  return { kind, recorder, tracks: media.getTracks(), stopped, flush: () => chain };
}

async function openCamera(config: NonNullable<RecordingConfig['webcam']>): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      ...deviceConstraint(config.deviceId),
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
  });
}

async function openMic(config: NonNullable<RecordingConfig['mic']>): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...deviceConstraint(config.deviceId),
      echoCancellation: false,
      noiseSuppression: config.noiseSuppression,
      autoGainControl: false,
    },
  });
}

async function openSystemAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  // Only the loopback audio matters — the mandatory video track is discarded.
  for (const track of display.getVideoTracks()) track.stop();
  const audioTracks = display.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new Error('system audio loopback unavailable on this platform');
  }
  return new MediaStream(audioTracks);
}

async function startStreams(config: RecordingConfig, clockOffsetMs: number): Promise<ActiveStream[]> {
  const starters: Promise<ActiveStream>[] = [];
  if (config.webcam) {
    const webcam = config.webcam;
    starters.push(
      openCamera(webcam).then((media) =>
        recordStream(
          'camera',
          media,
          {
            mimeType: pickMimeType('video/webm;codecs=vp9', 'video/webm'),
            videoBitsPerSecond: CAMERA_BITS_PER_SEC,
          },
          clockOffsetMs,
        ),
      ),
    );
  }
  if (config.mic) {
    const mic = config.mic;
    starters.push(
      openMic(mic).then((media) =>
        recordStream(
          'mic',
          media,
          {
            mimeType: pickMimeType('audio/webm;codecs=opus', 'audio/webm'),
            audioBitsPerSecond: AUDIO_BITS_PER_SEC,
          },
          clockOffsetMs,
        ),
      ),
    );
  }
  if (config.systemAudio) {
    starters.push(
      openSystemAudio().then((media) =>
        recordStream(
          'system',
          media,
          {
            mimeType: pickMimeType('audio/webm;codecs=opus', 'audio/webm'),
            audioBitsPerSecond: AUDIO_BITS_PER_SEC,
          },
          clockOffsetMs,
        ),
      ),
    );
  }
  const settled = await Promise.allSettled(starters);
  const active: ActiveStream[] = [];
  const failures: string[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') active.push(result.value);
    else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }
  if (failures.length > 0) {
    // All-or-nothing: a partially-started session should fail loudly rather
    // than silently drop a stream the user asked for.
    stopStreams(active);
    throw new Error(failures.join('; '));
  }
  return active;
}

function stopStreams(active: ActiveStream[]): void {
  for (const stream of active) {
    try {
      if (stream.recorder.state !== 'inactive') stream.recorder.stop();
    } catch {
      // Recorder already gone.
    }
  }
}

async function stopAndFlush(active: ActiveStream[]): Promise<void> {
  stopStreams(active);
  // dataavailable (final chunk) fires before stop, so awaiting stopped then
  // flush() covers every chunk.
  await Promise.all(active.map((s) => s.stopped));
  for (const stream of active) {
    for (const track of stream.tracks) track.stop();
  }
  await Promise.all(active.map((s) => s.flush()));
}

export default function CaptureRoot() {
  useEffect(() => {
    let active: ActiveStream[] = [];
    let started = false;
    // Commands are serialized so a stop can never overtake an in-flight start.
    let queue: Promise<void> = Promise.resolve();

    const handle = async (command: CaptureCommand): Promise<void> => {
      if (command.kind === 'start') {
        if (started) return;
        started = true;
        try {
          const clockOffsetMs = await measureClockOffset();
          active = await startStreams(command.config, clockOffsetMs);
        } catch (err) {
          void sc.invoke('capture:error', err instanceof Error ? err.message : String(err));
        }
      } else if (command.kind === 'stop') {
        const streams = active;
        active = [];
        await stopAndFlush(streams);
        await sc.invoke('capture:allStopped');
      } else {
        const streams = active;
        active = [];
        stopStreams(streams);
        for (const stream of streams) {
          for (const track of stream.tracks) track.stop();
        }
      }
    };

    const unsubscribe = sc.on('capture:command', (command) => {
      queue = queue.then(() => handle(command)).catch(() => {});
    });
    void sc.invoke('capture:ready');
    return () => {
      unsubscribe();
      stopStreams(active);
    };
  }, []);

  return null;
}
