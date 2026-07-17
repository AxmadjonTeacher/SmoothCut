//! "nativeMs" clock domain: QueryPerformanceCounter in milliseconds. The TS
//! wrapper maps it onto the main-process monotonic clock via the "ready"
//! handshake (exactly like the mac recorder's CLOCK_UPTIME_RAW "swiftMs").

use std::sync::OnceLock;

use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

fn qpc_frequency() -> i64 {
  static FREQUENCY: OnceLock<i64> = OnceLock::new();
  *FREQUENCY.get_or_init(|| {
    let mut freq = 0i64;
    // Cannot fail on XP+.
    let _ = unsafe { QueryPerformanceFrequency(&mut freq) };
    if freq > 0 {
      freq
    } else {
      1
    }
  })
}

pub fn native_now_ms() -> f64 {
  let mut ticks = 0i64;
  let _ = unsafe { QueryPerformanceCounter(&mut ticks) };
  ticks as f64 * 1000.0 / qpc_frequency() as f64
}
