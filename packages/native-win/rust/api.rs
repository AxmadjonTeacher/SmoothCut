//! N-API surface. Thin glue over `crate::win`; every export exists on all
//! platforms but returns Err("windows-only") off Windows.

use napi::bindgen_prelude::AsyncTask;
use napi::threadsafe_function::ThreadsafeFunction;
use napi::{Env, Error, Result, Task};
use napi_derive::napi;

/// Enumerate displays + capturable windows as a JSON string (same shape as
/// the mac recorder's `list` command output).
#[napi]
pub fn list_shareable_content() -> Result<String> {
  #[cfg(windows)]
  return crate::win::list_shareable_content_json().map_err(Error::from_reason);
  #[cfg(not(windows))]
  return Err(Error::from_reason("windows-only"));
}

/// Start a recording. `config_json` matches the mac record config
/// (`displayId`, `windowId?`, `cropRectPx?`, `fps`, `outputPath`,
/// `cursorsDir` — ids are decimal strings). `callback` receives one compact
/// JSON event object per invocation. Returns an opaque handle id for
/// `stop_recording`.
#[napi]
pub fn start_recording(
  config_json: String,
  callback: ThreadsafeFunction<String, ()>,
) -> Result<u32> {
  #[cfg(windows)]
  {
    let tsfn = std::sync::Arc::new(callback);
    let sink: crate::win::EventSink = std::sync::Arc::new(move |line: &str| {
      let _ = tsfn.call(
        Ok(line.to_string()),
        napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
      );
    });
    return crate::win::start_recording(&config_json, sink).map_err(Error::from_reason);
  }
  #[cfg(not(windows))]
  {
    let _ = (config_json, callback);
    return Err(Error::from_reason("windows-only"));
  }
}

pub struct StopRecordingTask {
  #[cfg_attr(not(windows), allow(dead_code))]
  handle: u32,
}

impl Task for StopRecordingTask {
  type Output = f64;
  type JsValue = f64;

  fn compute(&mut self) -> Result<Self::Output> {
    // Joining the capture thread and finalizing the MF encoder can take a
    // moment; `compute` runs on the libuv thread pool so the JS event loop
    // (Electron main process) stays responsive.
    #[cfg(windows)]
    return crate::win::stop_recording(self.handle).map_err(Error::from_reason);
    #[cfg(not(windows))]
    return Err(Error::from_reason("windows-only"));
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

/// Stop a recording and finalize the MP4. Resolves with durationMs
/// (last frame PTS - first frame PTS).
#[napi]
pub fn stop_recording(handle: u32) -> AsyncTask<StopRecordingTask> {
  AsyncTask::new(StopRecordingTask { handle })
}
