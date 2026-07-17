#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
swift build -c release
mkdir -p bin
cp .build/release/smoothcut-recorder bin/
