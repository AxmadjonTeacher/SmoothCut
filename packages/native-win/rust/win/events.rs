//! Event delivery: the analogue of the mac recorder's stdout. Each call
//! receives one compact JSON object (no trailing newline — the napi callback
//! is already message-framed).

use std::sync::Arc;

pub type EventSink = Arc<dyn Fn(&str) + Send + Sync>;

pub fn emit(sink: &EventSink, value: serde_json::Value) {
  if let Ok(line) = serde_json::to_string(&value) {
    sink(&line);
  }
}
