import Foundation

/// "swiftMs" clock domain: CLOCK_UPTIME_RAW in milliseconds. The TS wrapper
/// maps it onto the main-process monotonic clock via the "ready" handshake.
func monotonicMs() -> Double {
  Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) / 1_000_000.0
}

private let emitQueue = DispatchQueue(label: "smoothcut.emit")

/// One compact JSON object per line on stdout, written unbuffered and
/// serialized so lines from different queues never interleave.
func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
  emitQueue.sync {
    var line = data
    line.append(0x0A)
    line.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      guard let base = raw.baseAddress else { return }
      var offset = 0
      while offset < raw.count {
        let n = write(1, base.advanced(by: offset), raw.count - offset)
        if n <= 0 { break }
        offset += n
      }
    }
  }
}

func emitErrorAndExit(_ message: String) -> Never {
  emit(["event": "error", "message": message])
  exit(1)
}
