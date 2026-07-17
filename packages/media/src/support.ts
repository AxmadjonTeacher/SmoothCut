/**
 * Export capability probing and H.264 codec-string selection.
 *
 * Codec strings follow `avc1.PPCCLL`: PP = 0x64 (High profile), CC = 0x00
 * (no constraint flags), LL = level_idc (level number * 10, in hex). Level
 * selection follows ITU-T H.264 Table A-1 limits on macroblocks per frame
 * (MaxFS) and macroblocks per second (MaxMBPS).
 */

export interface ExportSupport {
  h264_4k60: boolean;
  h264_4k30: boolean;
  h264_1080p60: boolean;
  aac: boolean;
  opus: boolean;
}

interface AvcLevel {
  levelIdc: number;
  maxMacroblocksPerFrame: number;
  maxMacroblocksPerSecond: number;
}

// Subset of ITU-T H.264 Table A-1, ascending. 4.1 is omitted (same FS/MBPS
// limits as 4.0). Captures smaller than level 3.0 limits still get 3.0.
const AVC_LEVELS: readonly AvcLevel[] = [
  { levelIdc: 30, maxMacroblocksPerFrame: 1620, maxMacroblocksPerSecond: 40500 },
  { levelIdc: 31, maxMacroblocksPerFrame: 3600, maxMacroblocksPerSecond: 108000 },
  { levelIdc: 32, maxMacroblocksPerFrame: 5120, maxMacroblocksPerSecond: 216000 },
  { levelIdc: 40, maxMacroblocksPerFrame: 8192, maxMacroblocksPerSecond: 245760 },
  { levelIdc: 42, maxMacroblocksPerFrame: 8704, maxMacroblocksPerSecond: 522240 },
  { levelIdc: 50, maxMacroblocksPerFrame: 22080, maxMacroblocksPerSecond: 589824 },
  { levelIdc: 51, maxMacroblocksPerFrame: 36864, maxMacroblocksPerSecond: 983040 },
  { levelIdc: 52, maxMacroblocksPerFrame: 36864, maxMacroblocksPerSecond: 2073600 },
  { levelIdc: 60, maxMacroblocksPerFrame: 139264, maxMacroblocksPerSecond: 4177920 },
  { levelIdc: 61, maxMacroblocksPerFrame: 139264, maxMacroblocksPerSecond: 8355840 },
  { levelIdc: 62, maxMacroblocksPerFrame: 139264, maxMacroblocksPerSecond: 16711680 },
];

/**
 * Picks the lowest High-profile AVC level whose Table A-1 limits fit the given
 * dimensions and frame rate: 4K60 -> 5.2, 4K30 -> 5.1, 1080p60 -> 4.2.
 * Inputs beyond level 6.2 clamp to 6.2.
 */
export function pickAvcCodecString(width: number, height: number, fps: number): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const macroblocksPerSecond = macroblocks * fps;
  let picked = AVC_LEVELS[AVC_LEVELS.length - 1];
  for (const level of AVC_LEVELS) {
    if (
      macroblocks <= level.maxMacroblocksPerFrame &&
      macroblocksPerSecond <= level.maxMacroblocksPerSecond
    ) {
      picked = level;
      break;
    }
  }
  const levelHex = (picked?.levelIdc ?? 62).toString(16).padStart(2, '0');
  return `avc1.6400${levelHex}`;
}

async function probeVideo(width: number, height: number, fps: number, bitrate: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    const result = await VideoEncoder.isConfigSupported({
      codec: pickAvcCodecString(width, height, fps),
      width,
      height,
      bitrate,
      framerate: fps,
    });
    return result.supported === true;
  } catch {
    return false;
  }
}

async function probeAudio(codec: string): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const result = await AudioEncoder.isConfigSupported({
      codec,
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 192_000,
    });
    return result.supported === true;
  } catch {
    return false;
  }
}

export async function probeExportSupport(): Promise<ExportSupport> {
  const [h264_4k60, h264_4k30, h264_1080p60, aac, opus] = await Promise.all([
    probeVideo(3840, 2160, 60, 25_000_000),
    probeVideo(3840, 2160, 30, 20_000_000),
    probeVideo(1920, 1080, 60, 12_000_000),
    probeAudio('mp4a.40.2'),
    probeAudio('opus'),
  ]);
  return { h264_4k60, h264_4k30, h264_1080p60, aac, opus };
}
