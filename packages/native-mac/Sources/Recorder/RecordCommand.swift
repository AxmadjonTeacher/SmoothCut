import AVFoundation
import AppKit
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

struct CropRectConfig: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct RecordConfig: Decodable {
  let displayId: UInt32
  let windowId: UInt32?
  let cropRect: CropRectConfig?
  let fps: Int
  let outputPath: String
  let cursorsDir: String
  /// App overlay windows (webcam bubble, recording controls) to keep out of
  /// the capture — display capture only.
  let excludeWindowIds: [UInt32]?
}

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
  let frameQueue = DispatchQueue(label: "smoothcut.frames")

  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private let cursorPoller: CursorPoller
  private var stream: SCStream?
  private var statsTimer: Timer?

  private let stateLock = NSLock()
  private var readyEmitted = false
  private var sessionStarted = false
  private var stopping = false
  private var frames = 0
  private var dropped = 0
  private var firstPTS: CMTime?
  private var lastPTS: CMTime?

  init(writer: AVAssetWriter, input: AVAssetWriterInput, cursorsDir: String) {
    self.writer = writer
    self.input = input
    self.cursorPoller = CursorPoller(cursorsDir: cursorsDir)
    super.init()
  }

  func attach(stream: SCStream) {
    self.stream = stream
  }

  func emitReadyIfNeeded() {
    stateLock.lock()
    let shouldEmit = !readyEmitted
    readyEmitted = true
    stateLock.unlock()
    if shouldEmit {
      emit(["event": "ready", "swiftMs": monotonicMs()])
    }
  }

  /// Main run loop only.
  func startTimers() {
    cursorPoller.start()
    statsTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
      guard let self else { return }
      self.stateLock.lock()
      let f = self.frames
      let d = self.dropped
      self.stateLock.unlock()
      emit(["event": "stats", "frames": f, "dropped": d])
    }
  }

  // MARK: SCStreamOutput

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, sampleBuffer.isValid else { return }
    guard let attachments = (CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
            as? [[SCStreamFrameInfo: Any]])?.first,
          let statusRaw = attachments[SCStreamFrameInfo.status] as? Int,
          let status = SCFrameStatus(rawValue: statusRaw),
          status == .complete,
          CMSampleBufferGetImageBuffer(sampleBuffer) != nil else {
      return
    }

    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    if !sessionStarted {
      writer.startSession(atSourceTime: pts)
      sessionStarted = true
    }
    guard input.isReadyForMoreMediaData else {
      stateLock.lock()
      dropped += 1
      stateLock.unlock()
      return
    }
    if input.append(sampleBuffer) {
      stateLock.lock()
      frames += 1
      lastPTS = pts
      let isFirst = firstPTS == nil
      if isFirst { firstPTS = pts }
      stateLock.unlock()
      if isFirst {
        emitReadyIfNeeded()
        emit(["event": "firstFrame", "swiftMs": monotonicMs(), "ptsSec": CMTimeGetSeconds(pts)])
      }
    } else {
      stateLock.lock()
      dropped += 1
      stateLock.unlock()
      if writer.status == .failed {
        emit(["event": "error", "message": writer.error?.localizedDescription ?? "asset writer failed"])
      }
    }
  }

  // MARK: SCStreamDelegate

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    emit(["event": "error", "message": error.localizedDescription])
    DispatchQueue.main.async { self.requestStop() }
  }

  // MARK: Shutdown

  /// Main run loop only; idempotent ("stop" line, EOF, SIGTERM, stream error).
  func requestStop() {
    stateLock.lock()
    let alreadyStopping = stopping
    stopping = true
    stateLock.unlock()
    guard !alreadyStopping else { return }

    cursorPoller.stop()
    statsTimer?.invalidate()
    statsTimer = nil

    if let stream {
      stream.stopCapture { [weak self] _ in
        guard let self else { exit(0) }
        self.frameQueue.async { self.finishWriter() }
      }
    } else {
      frameQueue.async { self.finishWriter() }
    }
  }

  private func finishWriter() {
    guard sessionStarted, writer.status == .writing else {
      if writer.status == .writing {
        writer.cancelWriting()
      }
      emit(["event": "stopped", "durationMs": 0])
      exit(0)
    }
    input.markAsFinished()
    writer.finishWriting { [self] in
      stateLock.lock()
      let first = firstPTS
      let last = lastPTS
      stateLock.unlock()
      var durationMs = 0.0
      if let first, let last {
        durationMs = CMTimeGetSeconds(CMTimeSubtract(last, first)) * 1000.0
      }
      emit(["event": "stopped", "durationMs": durationMs])
      exit(0)
    }
  }
}

// Kept alive for the lifetime of the record command.
private var activeRecorder: Recorder?
private var sigtermSource: DispatchSourceSignal?

func runRecord(configJSON: String) -> Never {
  _ = NSApplication.shared

  let config: RecordConfig
  do {
    config = try JSONDecoder().decode(RecordConfig.self, from: Data(configJSON.utf8))
  } catch {
    emitErrorAndExit("invalid record config: \(error.localizedDescription)")
  }

  let content: SCShareableContent
  switch fetchShareableContent() {
  case .success(let c):
    content = c
  case .failure(let error):
    emitErrorAndExit(error.localizedDescription)
  }

  guard let display = content.displays.first(where: { $0.displayID == config.displayId }) else {
    emitErrorAndExit("display \(config.displayId) not found")
  }
  let scale = scaleFactorForDisplay(display.displayID)

  let filter: SCContentFilter
  var widthPx: Int
  var heightPx: Int
  if let windowId = config.windowId {
    guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
      emitErrorAndExit("window \(windowId) not found")
    }
    filter = SCContentFilter(desktopIndependentWindow: window)
    widthPx = Int((Double(window.frame.width) * scale).rounded())
    heightPx = Int((Double(window.frame.height) * scale).rounded())
  } else {
    let excludeIds = Set(config.excludeWindowIds ?? [])
    let excluded = content.windows.filter { excludeIds.contains($0.windowID) }
    filter = SCContentFilter(display: display, excludingWindows: excluded)
    widthPx = Int((Double(display.width) * scale).rounded())
    heightPx = Int((Double(display.height) * scale).rounded())
  }

  let configuration = SCStreamConfiguration()
  if let crop = config.cropRect {
    widthPx = Int(crop.width.rounded())
    heightPx = Int(crop.height.rounded())
    // sourceRect is in POINTS relative to the display's top-left; cropRect
    // arrives in PHYSICAL pixels, so divide by the backing scale factor.
    configuration.sourceRect = CGRect(
      x: crop.x / scale,
      y: crop.y / scale,
      width: crop.width / scale,
      height: crop.height / scale
    )
  }
  configuration.width = widthPx
  configuration.height = heightPx
  configuration.showsCursor = false
  configuration.minimumFrameInterval = CMTime(value: 1, timescale: Int32(config.fps))
  configuration.pixelFormat = kCVPixelFormatType_32BGRA
  configuration.colorSpaceName = CGColorSpace.sRGB
  configuration.queueDepth = 8

  let outputURL = URL(fileURLWithPath: config.outputPath)
  try? FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
  try? FileManager.default.removeItem(at: outputURL)

  let writer: AVAssetWriter
  do {
    writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
  } catch {
    emitErrorAndExit("cannot open output: \(error.localizedDescription)")
  }
  let bitrate = min(50_000_000, Int(0.12 * Double(widthPx * heightPx * config.fps)))
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: widthPx,
    AVVideoHeightKey: heightPx,
    AVVideoCompressionPropertiesKey: [
      AVVideoAverageBitRateKey: bitrate,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
  ])
  input.expectsMediaDataInRealTime = true
  writer.add(input)
  guard writer.startWriting() else {
    emitErrorAndExit("asset writer failed to start: \(writer.error?.localizedDescription ?? "unknown")")
  }

  let recorder = Recorder(writer: writer, input: input, cursorsDir: config.cursorsDir)
  activeRecorder = recorder
  let stream = SCStream(filter: filter, configuration: configuration, delegate: recorder)
  recorder.attach(stream: stream)
  do {
    try stream.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: recorder.frameQueue)
  } catch {
    emitErrorAndExit("addStreamOutput failed: \(error.localizedDescription)")
  }

  stream.startCapture { error in
    if let error {
      emit(["event": "error", "message": error.localizedDescription])
      exit(1)
    }
    DispatchQueue.main.async {
      recorder.emitReadyIfNeeded()
      recorder.startTimers()
    }
  }

  // stdin: "stop" (or EOF when the parent dies) triggers shutdown.
  Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
      if line.trimmingCharacters(in: .whitespaces) == "stop" {
        DispatchQueue.main.async { recorder.requestStop() }
        return
      }
    }
    DispatchQueue.main.async { recorder.requestStop() }
  }

  signal(SIGTERM, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
  source.setEventHandler { recorder.requestStop() }
  source.resume()
  sigtermSource = source

  while true {
    RunLoop.current.run(mode: .default, before: .distantFuture)
  }
}
