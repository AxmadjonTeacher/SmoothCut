import CoreGraphics
import Foundation

let arguments = CommandLine.arguments
let command = arguments.count > 1 ? arguments[1] : ""

switch command {
case "list":
  runList()

case "check-permission":
  print(CGPreflightScreenCaptureAccess() ? #"{"status":"granted"}"# : #"{"status":"denied"}"#)
  exit(0)

case "request-permission":
  let granted = CGRequestScreenCaptureAccess()
  print(granted ? #"{"granted":true}"# : #"{"granted":false}"#)
  exit(0)

case "record":
  guard arguments.count > 2 else {
    FileHandle.standardError.write(Data("record requires a JSON config argument\n".utf8))
    exit(2)
  }
  runRecord(configJSON: arguments[2])

default:
  FileHandle.standardError.write(
    Data("usage: smoothcut-recorder <list|check-permission|request-permission|record>\n".utf8))
  exit(2)
}
