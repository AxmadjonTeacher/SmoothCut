import AppKit
import CryptoKit
import Foundation

private typealias CursorSeedFn = @convention(c) () -> UInt32

private func resolveCursorSeedFn() -> CursorSeedFn? {
  // RTLD_DEFAULT == UnsafeMutableRawPointer(bitPattern: -2) on Darwin.
  var symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGSCurrentCursorSeed")
  if symbol == nil,
     let handle = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY) {
    symbol = dlsym(handle, "CGSCurrentCursorSeed")
  }
  guard let symbol else { return nil }
  return unsafeBitCast(symbol, to: CursorSeedFn.self)
}

final class CursorPoller {
  private let cursorsDir: URL
  private let seedFn: CursorSeedFn?
  private var timer: Timer?
  private var lastSeed: UInt32?
  private var lastShapeId: String?
  private var tick = 0

  init(cursorsDir: String) {
    self.cursorsDir = URL(fileURLWithPath: cursorsDir)
    self.seedFn = resolveCursorSeedFn()
    try? FileManager.default.createDirectory(at: self.cursorsDir, withIntermediateDirectories: true)
  }

  /// Emits the current cursor immediately, then polls at 30 Hz. Must run on
  /// the main run loop (AppKit cursor APIs).
  func start() {
    captureCurrentCursor(force: true)
    timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
      self?.poll()
    }
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }

  private func poll() {
    if let seedFn {
      let seed = seedFn()
      guard seed != lastSeed else { return }
      lastSeed = seed
      captureCurrentCursor(force: false)
    } else {
      // No CGSCurrentCursorSeed available: hash the cursor image at 10 Hz.
      tick += 1
      guard tick % 3 == 0 else { return }
      captureCurrentCursor(force: false)
    }
  }

  private func captureCurrentCursor(force: Bool) {
    let cursor = NSCursor.currentSystem ?? NSCursor.current
    guard let tiff = cursor.image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
      return
    }
    let shapeId = Insecure.SHA1.hash(data: png).map { String(format: "%02x", $0) }.joined()
    if !force && shapeId == lastShapeId { return }
    lastShapeId = shapeId

    let fileURL = cursorsDir.appendingPathComponent("\(shapeId).png")
    if !FileManager.default.fileExists(atPath: fileURL.path) {
      try? png.write(to: fileURL)
    }
    // hotSpot is in points of the cursor image; the shared contract wants PNG
    // pixels, so scale by the image's pixel/point ratio (2x on Retina assets).
    let pointSize = cursor.image.size
    let scaleX = pointSize.width > 0 ? Double(rep.pixelsWide) / Double(pointSize.width) : 1
    let scaleY = pointSize.height > 0 ? Double(rep.pixelsHigh) / Double(pointSize.height) : 1
    emit([
      "event": "cursorShape",
      "swiftMs": monotonicMs(),
      "shapeId": shapeId,
      "hotspotX": Double(cursor.hotSpot.x) * scaleX,
      "hotspotY": Double(cursor.hotSpot.y) * scaleY,
      "w": rep.pixelsWide,
      "h": rep.pixelsHigh,
    ])
  }
}
