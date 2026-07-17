//! Windows implementation: source listing, Graphics Capture recording, and
//! the 30 Hz cursor-shape poller. One process-wide registry of active
//! recordings, addressed by opaque u32 handles.

mod clock;
mod cursor;
mod events;
mod list;
mod recorder;

pub use events::EventSink;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::json;
use windows_capture::capture::CaptureControl;

use cursor::CursorPoller;
use events::emit;
use recorder::{BoxError, RecordConfig, SharedState, WinRecorder};

struct ActiveRecording {
  control: CaptureControl<WinRecorder, BoxError>,
  poller: CursorPoller,
  shared: Arc<SharedState>,
  sink: EventSink,
}

fn registry() -> &'static Mutex<HashMap<u32, ActiveRecording>> {
  static REGISTRY: OnceLock<Mutex<HashMap<u32, ActiveRecording>>> = OnceLock::new();
  REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

static NEXT_HANDLE: AtomicU32 = AtomicU32::new(1);

pub fn list_shareable_content_json() -> Result<String, String> {
  list::list_shareable_content_json()
}

pub fn start_recording(config_json: &str, sink: EventSink) -> Result<u32, String> {
  let config: RecordConfig =
    serde_json::from_str(config_json).map_err(|e| format!("invalid record config: {e}"))?;

  let started = recorder::start_capture(&config, sink.clone())?;
  // Emit `ready` before the poller starts so the first `cursorShape` is never
  // dropped by the TS wrapper's not-yet-ready guard. (The frame handler also
  // emits `ready` defensively before its first `firstFrame`.)
  recorder::emit_ready_if_needed(&started.shared, &sink);
  let poller = CursorPoller::start(
    PathBuf::from(&config.cursors_dir),
    sink.clone(),
    started.shared.clone(),
  );

  let handle = NEXT_HANDLE.fetch_add(1, Ordering::Relaxed);
  registry()
    .lock()
    .map_err(|_| "recording registry poisoned".to_string())?
    .insert(
      handle,
      ActiveRecording { control: started.control, poller, shared: started.shared, sink },
    );
  Ok(handle)
}

pub fn stop_recording(handle: u32) -> Result<f64, String> {
  let recording = registry()
    .lock()
    .map_err(|_| "recording registry poisoned".to_string())?
    .remove(&handle)
    .ok_or_else(|| format!("unknown recording handle {handle}"))?;

  recording.poller.stop();

  // Order matters: join the capture thread first (no more frames), then
  // finalize the encoder (flushes the MF transcoder and writes the moov box).
  let callback = recording.control.callback();
  let stop_err = recording.control.stop().err().map(|e| format!("capture stop failed: {e}"));
  let finish_err = callback.lock().finalize().err();

  let duration_ms = recording.shared.duration_ms();
  emit(&recording.sink, json!({ "event": "stopped", "durationMs": duration_ms }));

  if let Some(err) = finish_err {
    return Err(err);
  }
  if let Some(err) = stop_err {
    return Err(err);
  }
  Ok(duration_ms)
}
