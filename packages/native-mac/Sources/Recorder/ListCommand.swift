import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

struct DisplayJSON: Encodable {
  let id: String
  let widthPt: Double
  let heightPt: Double
  let scaleFactor: Double
  let originX: Double
  let originY: Double
  let isPrimary: Bool
  let label: String
}

struct WindowJSON: Encodable {
  let id: String
  let title: String
  let appName: String
  let displayId: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct ListJSON: Encodable {
  let displays: [DisplayJSON]
  let windows: [WindowJSON]
}

func scaleFactorForDisplay(_ displayID: CGDirectDisplayID) -> Double {
  for screen in NSScreen.screens {
    if let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
       number.uint32Value == displayID {
      return Double(screen.backingScaleFactor)
    }
  }
  if let mode = CGDisplayCopyDisplayMode(displayID), mode.width > 0 {
    return Double(mode.pixelWidth) / Double(mode.width)
  }
  return 1
}

private func labelForDisplay(_ displayID: CGDirectDisplayID) -> String {
  for screen in NSScreen.screens {
    if let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
       number.uint32Value == displayID {
      return screen.localizedName
    }
  }
  return "Display \(displayID)"
}

func fetchShareableContent() -> Result<SCShareableContent, Error> {
  let semaphore = DispatchSemaphore(value: 0)
  var content: SCShareableContent?
  var failure: Error?
  SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { c, e in
    content = c
    failure = e
    semaphore.signal()
  }
  semaphore.wait()
  if let content {
    return .success(content)
  }
  return .failure(failure ?? NSError(
    domain: "smoothcut", code: 1,
    userInfo: [NSLocalizedDescriptionKey: "shareable content unavailable"]
  ))
}

func runList() -> Never {
  _ = NSApplication.shared
  let content: SCShareableContent
  switch fetchShareableContent() {
  case .success(let c):
    content = c
  case .failure(let error):
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
  }

  let mainID = CGMainDisplayID()
  let displays = content.displays.map { display in
    DisplayJSON(
      id: String(display.displayID),
      widthPt: Double(display.width),
      heightPt: Double(display.height),
      scaleFactor: scaleFactorForDisplay(display.displayID),
      originX: Double(display.frame.origin.x),
      originY: Double(display.frame.origin.y),
      isPrimary: display.displayID == mainID,
      label: labelForDisplay(display.displayID)
    )
  }

  let windows = content.windows.map { window -> WindowJSON in
    let mid = CGPoint(x: window.frame.midX, y: window.frame.midY)
    let owner = content.displays.first { $0.frame.contains(mid) } ?? content.displays.first
    return WindowJSON(
      id: String(window.windowID),
      title: window.title ?? "",
      appName: window.owningApplication?.applicationName ?? "",
      displayId: owner.map { String($0.displayID) } ?? "",
      x: Double(window.frame.origin.x),
      y: Double(window.frame.origin.y),
      width: Double(window.frame.width),
      height: Double(window.frame.height)
    )
  }

  let encoder = JSONEncoder()
  guard let data = try? encoder.encode(ListJSON(displays: displays, windows: windows)),
        let json = String(data: data, encoding: .utf8) else {
    FileHandle.standardError.write(Data("failed to encode list JSON\n".utf8))
    exit(1)
  }
  print(json)
  exit(0)
}
