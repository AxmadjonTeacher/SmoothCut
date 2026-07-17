//! Windows.Graphics.Capture recording via the windows-capture crate, encoded
//! to H.264 MP4 with its built-in Media Foundation `VideoEncoder`.
//!
//! Mirrors the mac recorder's semantics:
//! - cursor is NOT composited into the video (`CursorCaptureSettings::WithoutCursor`);
//! - yellow capture border suppressed where the OS allows it;
//! - `firstFrame` is emitted with the native clock at the first encoded frame;
//! - durationMs = last frame PTS - first frame PTS.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{
  AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
  ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
  GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use super::clock::native_now_ms;
use super::events::{emit, EventSink};

pub type BoxError = Box<dyn std::error::Error + Send + Sync>;

/// 100ns ticks (Graphics.Capture SystemRelativeTime / QPC domain) per ms.
const TICKS_PER_MS: f64 = 10_000.0;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordConfig {
  pub display_id: String,
  #[serde(default)]
  pub window_id: Option<String>,
  #[serde(default)]
  pub crop_rect_px: Option<CropRectPx>,
  pub fps: u32,
  pub output_path: String,
  pub cursors_dir: String,
}

#[derive(Deserialize)]
pub struct CropRectPx {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

/// Integer crop in frame physical px, already clamped and even-sized.
#[derive(Clone, Copy)]
pub struct CropPx {
  pub x: u32,
  pub y: u32,
  pub width: u32,
  pub height: u32,
}

/// Counters shared between the capture thread, the cursor/stats poller, and
/// stop_recording.
pub struct SharedState {
  ready_emitted: AtomicBool,
  frames: AtomicU64,
  dropped: AtomicU64,
  /// -1 = no frame yet. 100ns ticks.
  first_ts_ticks: AtomicI64,
  last_ts_ticks: AtomicI64,
}

impl SharedState {
  fn new() -> Self {
    Self {
      ready_emitted: AtomicBool::new(false),
      frames: AtomicU64::new(0),
      dropped: AtomicU64::new(0),
      first_ts_ticks: AtomicI64::new(-1),
      last_ts_ticks: AtomicI64::new(-1),
    }
  }

  pub fn frames(&self) -> u64 {
    self.frames.load(Ordering::Relaxed)
  }

  pub fn dropped(&self) -> u64 {
    self.dropped.load(Ordering::Relaxed)
  }

  pub fn duration_ms(&self) -> f64 {
    let first = self.first_ts_ticks.load(Ordering::Relaxed);
    let last = self.last_ts_ticks.load(Ordering::Relaxed);
    if first < 0 || last < first {
      0.0
    } else {
      (last - first) as f64 / TICKS_PER_MS
    }
  }
}

/// Emits `ready` exactly once (raced by start_recording and the first frame).
pub fn emit_ready_if_needed(shared: &SharedState, sink: &EventSink) {
  if !shared.ready_emitted.swap(true, Ordering::SeqCst) {
    emit(sink, json!({ "event": "ready", "nativeMs": native_now_ms() }));
  }
}

pub struct RecorderFlags {
  width: u32,
  height: u32,
  fps: u32,
  output_path: String,
  crop: Option<CropPx>,
  shared: Arc<SharedState>,
  sink: EventSink,
}

pub struct WinRecorder {
  encoder: Option<VideoEncoder>,
  crop: Option<CropPx>,
  shared: Arc<SharedState>,
  sink: EventSink,
  /// Scratch for de-padded cropped frames (reused across frames).
  scratch: Vec<u8>,
}

impl GraphicsCaptureApiHandler for WinRecorder {
  type Flags = RecorderFlags;
  type Error = BoxError;

  fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
    let flags = ctx.flags;
    let encoder = VideoEncoder::new(
      VideoSettingsBuilder::new(flags.width, flags.height)
        .frame_rate(flags.fps)
        .bitrate(bitrate_for(flags.width, flags.height, flags.fps)),
      AudioSettingsBuilder::default().disabled(true),
      ContainerSettingsBuilder::default(),
      &flags.output_path,
    )?;
    Ok(Self {
      encoder: Some(encoder),
      crop: flags.crop,
      shared: flags.shared,
      sink: flags.sink,
      scratch: Vec::new(),
    })
  }

  fn on_frame_arrived(
    &mut self,
    frame: &mut Frame,
    _capture_control: InternalCaptureControl,
  ) -> Result<(), Self::Error> {
    let Some(encoder) = self.encoder.as_mut() else {
      return Ok(());
    };
    let ts_ticks = frame.timestamp()?.Duration;

    let sent = if let Some(crop) = self.crop {
      let frame_buffer =
        frame.buffer_crop(crop.x, crop.y, crop.x + crop.width, crop.y + crop.height)?;
      let frame_size = (crop.width * crop.height * 4) as usize;
      // Pre-size the scratch vec: as_nopadding_buffer only writes into it
      // when the mapped rows are padded, and it slices by frame_size.
      if self.scratch.len() < frame_size {
        self.scratch.resize(frame_size, 0);
      }
      let packed = frame_buffer.as_nopadding_buffer(&mut self.scratch);
      encoder.send_frame_buffer(packed, ts_ticks)
    } else {
      encoder.send_frame(frame)
    };

    match sent {
      Ok(()) => {
        let previous_frames = self.shared.frames.fetch_add(1, Ordering::Relaxed);
        self.shared.last_ts_ticks.store(ts_ticks, Ordering::Relaxed);
        if previous_frames == 0 {
          self.shared.first_ts_ticks.store(ts_ticks, Ordering::Relaxed);
          emit_ready_if_needed(&self.shared, &self.sink);
          emit(
            &self.sink,
            json!({
              "event": "firstFrame",
              "nativeMs": native_now_ms(),
              "ptsSec": ts_ticks as f64 / 10_000_000.0,
            }),
          );
        }
        Ok(())
      }
      Err(e) => {
        self.shared.dropped.fetch_add(1, Ordering::Relaxed);
        emit(&self.sink, json!({ "event": "error", "message": format!("video encoder failed: {e}") }));
        Err(Box::new(e))
      }
    }
  }

  fn on_closed(&mut self) -> Result<(), Self::Error> {
    // Mirrors the mac stream-stopped-with-error path: surface the error and
    // let the session tear the recording down.
    emit(&self.sink, json!({ "event": "error", "message": "capture item closed" }));
    Ok(())
  }
}

impl WinRecorder {
  /// Must be called after the capture thread has been joined; finishes the
  /// MF transcode so the MP4 gets its moov box.
  pub fn finalize(&mut self) -> Result<(), String> {
    if let Some(encoder) = self.encoder.take() {
      encoder.finish().map_err(|e| format!("failed to finalize encoder: {e}"))?;
    }
    Ok(())
  }
}

pub struct StartedRecording {
  pub control: CaptureControl<WinRecorder, BoxError>,
  pub shared: Arc<SharedState>,
}

fn bitrate_for(width: u32, height: u32, fps: u32) -> u32 {
  // ~0.1 bit per pixel per frame; 2560x1440@60 ≈ 22 Mbps.
  let raw = u64::from(width) * u64::from(height) * u64::from(fps) / 10;
  raw.clamp(4_000_000, 40_000_000) as u32
}

/// H.264 wants even dimensions; round down (min 2).
fn even_dim(v: u32) -> u32 {
  (v & !1).max(2)
}

fn parse_raw_handle(id: &str, what: &str) -> Result<*mut c_void, String> {
  let value: isize = id.parse().map_err(|_| format!("invalid {what}: {id}"))?;
  Ok(value as *mut c_void)
}

fn resolve_crop(crop: &CropRectPx, item_w: u32, item_h: u32) -> Result<CropPx, String> {
  let x = crop.x.round().max(0.0) as u32;
  let y = crop.y.round().max(0.0) as u32;
  if x >= item_w || y >= item_h {
    return Err("cropRectPx is outside the capture item".to_string());
  }
  let width = (crop.width.round().max(0.0) as u32).min(item_w - x);
  let height = (crop.height.round().max(0.0) as u32).min(item_h - y);
  let width = even_dim(width.min(item_w - x));
  let height = even_dim(height.min(item_h - y));
  if x + width > item_w || y + height > item_h {
    return Err("cropRectPx is outside the capture item".to_string());
  }
  Ok(CropPx { x, y, width, height })
}

fn spawn_capture<T>(
  item: T,
  flags: RecorderFlags,
) -> Result<CaptureControl<WinRecorder, BoxError>, String>
where
  T: TryInto<GraphicsCaptureItemType> + Send + 'static,
{
  let settings = Settings::new(
    item,
    CursorCaptureSettings::WithoutCursor,
    DrawBorderSettings::WithoutBorder,
    SecondaryWindowSettings::Default,
    MinimumUpdateIntervalSettings::Default,
    DirtyRegionSettings::Default,
    ColorFormat::Bgra8,
    flags,
  );
  WinRecorder::start_free_threaded(settings).map_err(|e| format!("failed to start capture: {e}"))
}

pub fn start_capture(config: &RecordConfig, sink: EventSink) -> Result<StartedRecording, String> {
  if config.fps == 0 {
    return Err("fps must be > 0".to_string());
  }
  let shared = Arc::new(SharedState::new());

  if let Some(window_id) = &config.window_id {
    let window = Window::from_raw_hwnd(parse_raw_handle(window_id, "windowId")?);
    if !window.is_valid() {
      return Err(format!("window {window_id} not found"));
    }
    let item_w = u32::try_from(window.width().map_err(|e| format!("window size unavailable: {e}"))?)
      .map_err(|_| "window has invalid width".to_string())?;
    let item_h =
      u32::try_from(window.height().map_err(|e| format!("window size unavailable: {e}"))?)
        .map_err(|_| "window has invalid height".to_string())?;
    let crop = config.crop_rect_px.as_ref().map(|c| resolve_crop(c, item_w, item_h)).transpose()?;
    let (width, height) = match crop {
      Some(c) => (c.width, c.height),
      None => (even_dim(item_w), even_dim(item_h)),
    };
    let control = spawn_capture(
      window,
      RecorderFlags {
        width,
        height,
        fps: config.fps,
        output_path: config.output_path.clone(),
        crop,
        shared: shared.clone(),
        sink,
      },
    )?;
    return Ok(StartedRecording { control, shared });
  }

  let monitor = Monitor::from_raw_hmonitor(parse_raw_handle(&config.display_id, "displayId")?);
  let item_w = monitor.width().map_err(|e| format!("display {} not found: {e}", config.display_id))?;
  let item_h = monitor.height().map_err(|e| format!("display {} not found: {e}", config.display_id))?;
  let crop = config.crop_rect_px.as_ref().map(|c| resolve_crop(c, item_w, item_h)).transpose()?;
  let (width, height) = match crop {
    Some(c) => (c.width, c.height),
    None => (even_dim(item_w), even_dim(item_h)),
  };
  let control = spawn_capture(
    monitor,
    RecorderFlags {
      width,
      height,
      fps: config.fps,
      output_path: config.output_path.clone(),
      crop,
      shared: shared.clone(),
      sink,
    },
  )?;
  Ok(StartedRecording { control, shared })
}
