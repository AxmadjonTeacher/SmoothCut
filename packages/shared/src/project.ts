/**
 * Project file contract (`project.json`) — everything the editor can change.
 * All effects are derived deterministically from (recording streams +
 * events.jsonl + this file); the editor never mutates recorded media.
 *
 * Times: `ZoomSegment`/`TimelineSegment` boundaries are in SOURCE seconds
 * (positions in the raw recording), not output time. Timeline math maps
 * between the two.
 */
import { z } from 'zod';
import type { RecordingMeta } from './recording.js';

export const zoomTargetSchema = z.union([
  z.object({ mode: z.literal('follow-cursor') }),
  z.object({ mode: z.literal('fixed'), x: z.number(), y: z.number() }),
]);
export type ZoomTarget = z.infer<typeof zoomTargetSchema>;

export const zoomSegmentSchema = z.object({
  id: z.string(),
  /** Source seconds. */
  start: z.number(),
  end: z.number(),
  /** Magnification, 1.0–3.0. */
  level: z.number().min(1).max(3),
  target: zoomTargetSchema,
  /** `auto` segments are replaced by "Regenerate"; `manual` survive it. */
  origin: z.enum(['auto', 'manual']),
});
export type ZoomSegment = z.infer<typeof zoomSegmentSchema>;

export const zoomConfigSchema = z.object({
  defaultLevel: z.number().min(1).max(3),
  /** 0..1 — mapped onto spring stiffness for zoom transitions. */
  smoothness: z.number().min(0).max(1),
  /** Seconds of zoom-in lead before a click cluster. */
  leadSec: z.number().min(0).max(3),
  /** Seconds to hold after the last click in a cluster. */
  holdSec: z.number().min(0).max(5),
  /** Clicks closer than this (seconds) belong to one cluster. */
  clusterGapSec: z.number().min(0.5).max(10),
});
export type ZoomConfig = z.infer<typeof zoomConfigSchema>;

export const timelineSegmentSchema = z.object({
  id: z.string(),
  /** Source seconds; segments are ordered and non-overlapping in source time. */
  sourceStart: z.number(),
  sourceEnd: z.number(),
  speed: z.number().min(0.5).max(16),
});
export type TimelineSegment = z.infer<typeof timelineSegmentSchema>;

export const shadowStyleSchema = z.object({
  /** 0..1 overall strength; 0 disables. */
  opacity: z.number().min(0).max(1),
  blurPx: z.number().min(0).max(200),
  offsetY: z.number().min(-100).max(100),
});
export type ShadowStyle = z.infer<typeof shadowStyleSchema>;

export const CANVAS_PRESETS = {
  '16:9': { width: 3840, height: 2160 },
  '9:16': { width: 2160, height: 3840 },
  '1:1': { width: 2880, height: 2880 },
  '4:3': { width: 3200, height: 2400 },
  source: { width: 0, height: 0 }, // resolved from RecordingMeta.capture at load
} as const;
export type CanvasPreset = keyof typeof CANVAS_PRESETS;

export const backgroundStyleSchema = z.object({
  kind: z.enum(['solid', 'gradient', 'wallpaper', 'image']),
  /**
   * solid: css hex color; gradient: JSON `{angle, stops:[{color,at}]}`;
   * wallpaper: bundled wallpaper id; image: absolute path chosen by the user.
   */
  value: z.string(),
  blur: z.number().min(0).max(100),
});
export type BackgroundStyle = z.infer<typeof backgroundStyleSchema>;

export const webcamLayoutSchema = z.enum([
  'bubble-bl',
  'bubble-br',
  'bubble-tl',
  'bubble-tr',
  'pinned-left',
  'pinned-right',
  /** Free placement: centered on `webcam.position` (drag in the preview). */
  'custom',
  /** Split view: screen card left, tall webcam column right. */
  'split-right',
]);
export type WebcamLayout = z.infer<typeof webcamLayoutSchema>;

export const projectStyleSchema = z.object({
  canvas: z.object({
    preset: z.enum(['16:9', '9:16', '1:1', '4:3', 'source']),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  background: backgroundStyleSchema,
  screen: z.object({
    /** Padding as a fraction of the shorter canvas edge, 0..0.25. */
    paddingPct: z.number().min(0).max(0.25),
    cornerRadius: z.number().min(0).max(120),
    shadow: shadowStyleSchema,
  }),
  webcam: z.object({
    layout: webcamLayoutSchema,
    /** Diameter/height as a fraction of canvas height. */
    sizePct: z.number().min(0.1).max(0.5),
    cornerStyle: z.enum(['squircle', 'circle', 'rect']),
    shadow: shadowStyleSchema,
    hidden: z.boolean(),
    /** Webcam CENTER in canvas unit coords (0..1); used when layout==='custom'. */
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    /** Flip the webcam video horizontally (undefined = false). */
    mirror: z.boolean().optional(),
  }),
});
export type ProjectStyle = z.infer<typeof projectStyleSchema>;

export const cursorStyleSchema = z.object({
  /** Multiplier over the recorded cursor size. */
  size: z.number().min(0.5).max(4),
  /** 0..1 — 0 = raw positions, 1 = heaviest smoothing. */
  smoothing: z.number().min(0).max(1),
  clickRipples: z.boolean(),
  motionBlur: z.boolean(),
});
export type CursorStyle = z.infer<typeof cursorStyleSchema>;

export const audioSettingsSchema = z.object({
  micGainDb: z.number().min(-60).max(12),
  systemGainDb: z.number().min(-60).max(12),
  noiseRemoval: z.boolean(),
  normalize: z.boolean(),
});
export type AudioSettings = z.infer<typeof audioSettingsSchema>;

export const projectFileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  timeline: z.array(timelineSegmentSchema),
  zoom: z.object({
    config: zoomConfigSchema,
    segments: z.array(zoomSegmentSchema),
    /** When false, the editor never auto-generates zoom segments on first open. */
    autoGenerate: z.boolean().optional(),
  }),
  cursor: cursorStyleSchema,
  style: projectStyleSchema,
  audio: audioSettingsSchema,
});
export type ProjectFile = z.infer<typeof projectFileSchema>;

export const DEFAULT_ZOOM_CONFIG: ZoomConfig = {
  defaultLevel: 2.0,
  smoothness: 0.5,
  leadSec: 0.9,
  holdSec: 1.4,
  clusterGapSec: 2.5,
};

export function createDefaultProject(name: string, meta: RecordingMeta): ProjectFile {
  return {
    schemaVersion: 1,
    name,
    timeline: [
      {
        id: 'clip-0',
        sourceStart: 0,
        sourceEnd: meta.durationMs / 1000,
        speed: 1,
      },
    ],
    zoom: { config: DEFAULT_ZOOM_CONFIG, segments: [] },
    cursor: { size: 1.5, smoothing: 0.5, clickRipples: true, motionBlur: true },
    style: {
      canvas: { preset: '16:9', ...CANVAS_PRESETS['16:9'] },
      background: { kind: 'gradient', value: 'aurora', blur: 0 },
      screen: {
        paddingPct: 0.06,
        cornerRadius: 24,
        shadow: { opacity: 0.4, blurPx: 60, offsetY: 20 },
      },
      webcam: {
        layout: 'bubble-br',
        sizePct: 0.22,
        cornerStyle: 'squircle',
        shadow: { opacity: 0.35, blurPx: 40, offsetY: 12 },
        hidden: false,
      },
    },
    audio: { micGainDb: 0, systemGainDb: 0, noiseRemoval: false, normalize: true },
  };
}
