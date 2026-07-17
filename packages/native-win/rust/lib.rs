//! SmoothCut Windows native capture addon.
//!
//! Mirrors the macOS `smoothcut-recorder` binary's contract, but as an
//! in-process napi addon: `list_shareable_content` returns the same JSON
//! shape the Swift `list` command prints, and `start_recording` streams the
//! same JSON-line events (`ready` / `firstFrame` / `cursorShape` / `stats` /
//! `stopped` / `error`) through a threadsafe callback — with the mac
//! protocol's `swiftMs` field renamed to `nativeMs` (QueryPerformanceCounter
//! milliseconds).
//!
//! All platform code is `#[cfg(windows)]`; on other platforms the napi
//! exports still exist but fail with "windows-only" so the crate always
//! passes `cargo check` on macOS/Linux hosts.

#[cfg(windows)]
pub mod win;

#[cfg(feature = "napi")]
mod api;
