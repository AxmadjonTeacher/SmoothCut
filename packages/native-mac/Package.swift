// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "smoothcut-recorder",
  platforms: [.macOS(.v13)],
  products: [
    .executable(name: "smoothcut-recorder", targets: ["Recorder"]),
  ],
  targets: [
    .executableTarget(
      name: "Recorder",
      path: "Sources/Recorder",
      linkerSettings: [
        .linkedFramework("ScreenCaptureKit"),
        .linkedFramework("AVFoundation"),
        .linkedFramework("AppKit"),
        .linkedFramework("CoreGraphics"),
      ]
    ),
  ]
)
