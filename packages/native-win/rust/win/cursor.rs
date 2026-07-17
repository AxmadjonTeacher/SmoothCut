//! 30 Hz cursor-shape poller (the analogue of the mac CursorPoller).
//!
//! On cursor-handle change: GetCursorInfo → CopyIcon → GetIconInfo (hotspot)
//! → DrawIconEx into a 32bpp top-down DIB → PNG → sha1 content id → write
//! `<sha1>.png` into cursorsDir if new → emit a `cursorShape` event.
//! Also doubles as the 2s `stats` ticker so we don't need a third thread.

use std::mem::size_of;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::json;
use sha1::{Digest, Sha1};
use windows::Win32::Graphics::Gdi::{
  CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC, GetDIBits,
  GetObjectW, ReleaseDC, SelectObject, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
  DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
};
use windows::Win32::UI::WindowsAndMessaging::{
  CopyIcon, DestroyIcon, DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSOR_SHOWING,
  DI_NORMAL, HCURSOR, HICON, ICONINFO,
};

use super::clock::native_now_ms;
use super::events::{emit, EventSink};
use super::recorder::SharedState;

const POLL_INTERVAL: Duration = Duration::from_millis(33);
const STATS_INTERVAL: Duration = Duration::from_secs(2);
/// Sanity bound; standard cursors are <= 256px even at high DPI.
const MAX_CURSOR_DIM: i32 = 512;

pub struct CursorPoller {
  stop: Arc<AtomicBool>,
  thread: Option<JoinHandle<()>>,
}

impl CursorPoller {
  pub fn start(cursors_dir: PathBuf, sink: EventSink, shared: Arc<SharedState>) -> Self {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let thread = std::thread::Builder::new()
      .name("smoothcut-cursor-poller".to_string())
      .spawn(move || run_poller(&cursors_dir, &sink, &shared, &stop_flag))
      .ok();
    Self { stop, thread }
  }

  pub fn stop(&self) {
    self.stop.store(true, Ordering::Relaxed);
    // Joining is best-effort; the loop wakes at most POLL_INTERVAL later.
  }
}

impl Drop for CursorPoller {
  fn drop(&mut self) {
    self.stop.store(true, Ordering::Relaxed);
    if let Some(thread) = self.thread.take() {
      let _ = thread.join();
    }
  }
}

fn run_poller(cursors_dir: &PathBuf, sink: &EventSink, shared: &SharedState, stop: &AtomicBool) {
  let _ = std::fs::create_dir_all(cursors_dir);
  // Sentinel that never matches a real handle → the current cursor is
  // captured immediately on the first tick.
  let mut last_hcursor: isize = -1;
  let mut last_shape_id = String::new();
  let mut last_stats = Instant::now();

  while !stop.load(Ordering::Relaxed) {
    poll_once(cursors_dir, sink, &mut last_hcursor, &mut last_shape_id);
    if last_stats.elapsed() >= STATS_INTERVAL {
      last_stats = Instant::now();
      emit(
        sink,
        json!({ "event": "stats", "frames": shared.frames(), "dropped": shared.dropped() }),
      );
    }
    std::thread::sleep(POLL_INTERVAL);
  }
}

fn poll_once(
  cursors_dir: &PathBuf,
  sink: &EventSink,
  last_hcursor: &mut isize,
  last_shape_id: &mut String,
) {
  let mut info = CURSORINFO { cbSize: size_of::<CURSORINFO>() as u32, ..Default::default() };
  if unsafe { GetCursorInfo(&mut info) }.is_err() {
    return;
  }
  if info.flags.0 & CURSOR_SHOWING.0 == 0 || info.hCursor.is_invalid() {
    return;
  }
  let handle_value = info.hCursor.0 as isize;
  if handle_value == *last_hcursor {
    return;
  }
  *last_hcursor = handle_value;

  let Some(image) = snapshot_cursor(info.hCursor) else {
    return;
  };
  let Some(png) = encode_png(image.width as u32, image.height as u32, &image.bgra) else {
    return;
  };
  let shape_id = sha1_hex(&png);
  if shape_id == *last_shape_id {
    return;
  }
  *last_shape_id = shape_id.clone();

  let file = cursors_dir.join(format!("{shape_id}.png"));
  if !file.exists() {
    let _ = std::fs::write(&file, &png);
  }
  emit(
    sink,
    json!({
      "event": "cursorShape",
      "nativeMs": native_now_ms(),
      "shapeId": shape_id,
      "hotspotX": image.hotspot_x,
      "hotspotY": image.hotspot_y,
      "w": image.width,
      "h": image.height,
    }),
  );
}

struct CursorImage {
  bgra: Vec<u8>,
  width: i32,
  height: i32,
  hotspot_x: u32,
  hotspot_y: u32,
}

fn snapshot_cursor(hcursor: HCURSOR) -> Option<CursorImage> {
  // Copy first: the live cursor handle is owned by the system and can be
  // destroyed under us.
  let hicon = unsafe { CopyIcon(HICON(hcursor.0)) }.ok()?;
  let image = icon_to_image(hicon);
  let _ = unsafe { DestroyIcon(hicon) };
  image
}

fn icon_to_image(hicon: HICON) -> Option<CursorImage> {
  let mut info = ICONINFO::default();
  if unsafe { GetIconInfo(hicon, &mut info) }.is_err() {
    return None;
  }
  // GetIconInfo hands us ownership of both bitmaps.
  let image = render_icon(hicon, &info);
  if !info.hbmColor.is_invalid() {
    let _ = unsafe { DeleteObject(info.hbmColor.into()) };
  }
  if !info.hbmMask.is_invalid() {
    let _ = unsafe { DeleteObject(info.hbmMask.into()) };
  }
  image
}

struct ReleasedDc(HDC);
impl Drop for ReleasedDc {
  fn drop(&mut self) {
    unsafe { ReleaseDC(None, self.0) };
  }
}

struct DeletedDc(HDC);
impl Drop for DeletedDc {
  fn drop(&mut self) {
    let _ = unsafe { DeleteDC(self.0) };
  }
}

struct DeletedObject(HGDIOBJ);
impl Drop for DeletedObject {
  fn drop(&mut self) {
    let _ = unsafe { DeleteObject(self.0) };
  }
}

fn render_icon(hicon: HICON, info: &ICONINFO) -> Option<CursorImage> {
  // Dimensions: color cursors carry them on hbmColor; monochrome cursors use
  // a double-height hbmMask (AND mask stacked on the XOR mask).
  let is_mono = info.hbmColor.is_invalid();
  let measured: HBITMAP = if is_mono { info.hbmMask } else { info.hbmColor };
  let mut bitmap = BITMAP::default();
  let got = unsafe {
    GetObjectW(
      measured.into(),
      size_of::<BITMAP>() as i32,
      Some(std::ptr::addr_of_mut!(bitmap).cast()),
    )
  };
  if got == 0 {
    return None;
  }
  let width = bitmap.bmWidth;
  let height = if is_mono { bitmap.bmHeight / 2 } else { bitmap.bmHeight };
  if width <= 0 || height <= 0 || width > MAX_CURSOR_DIM || height > MAX_CURSOR_DIM {
    return None;
  }

  let screen_dc = unsafe { GetDC(None) };
  if screen_dc.is_invalid() {
    return None;
  }
  let _screen_dc_guard = ReleasedDc(screen_dc);
  let mem_dc = unsafe { CreateCompatibleDC(Some(screen_dc)) };
  if mem_dc.is_invalid() {
    return None;
  }
  let _mem_dc_guard = DeletedDc(mem_dc);

  let bmi = BITMAPINFO {
    bmiHeader: BITMAPINFOHEADER {
      biSize: size_of::<BITMAPINFOHEADER>() as u32,
      biWidth: width,
      biHeight: -height, // top-down
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB.0,
      ..Default::default()
    },
    ..Default::default()
  };
  let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
  let dib =
    unsafe { CreateDIBSection(Some(mem_dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0) }.ok()?;
  if bits.is_null() {
    let _ = unsafe { DeleteObject(dib.into()) };
    return None;
  }
  let _dib_guard = DeletedObject(dib.into());

  let byte_len = (width as usize) * (height as usize) * 4;
  // CreateDIBSection memory is not guaranteed zeroed.
  unsafe { std::ptr::write_bytes(bits.cast::<u8>(), 0, byte_len) };

  let previous = unsafe { SelectObject(mem_dc, dib.into()) };
  let drawn =
    unsafe { DrawIconEx(mem_dc, 0, 0, hicon, width, height, 0, None, DI_NORMAL) }.is_ok();
  let _ = unsafe { GdiFlush() };
  let mut bgra = vec![0u8; byte_len];
  if drawn {
    unsafe { std::ptr::copy_nonoverlapping(bits.cast::<u8>(), bgra.as_mut_ptr(), byte_len) };
  }
  // If DrawIconEx produced no alpha at all (classic AND/XOR cursors), derive
  // it from the AND mask before the DCs go away.
  let mask_opaque = if drawn && bgra.chunks_exact(4).all(|px| px[3] == 0) {
    read_and_mask(mem_dc, info.hbmMask, width, height, is_mono)
  } else {
    None
  };
  unsafe { SelectObject(mem_dc, previous) };
  if !drawn {
    return None;
  }

  if bgra.chunks_exact(4).all(|px| px[3] == 0) {
    match mask_opaque {
      Some(opaque) => {
        for (px, is_opaque) in bgra.chunks_exact_mut(4).zip(opaque) {
          // AND=0 → opaque; AND=1 with a non-black XOR color is an inversion
          // pixel, which PNG can't express — render it opaque instead.
          px[3] = if is_opaque || px[0] != 0 || px[1] != 0 || px[2] != 0 { 255 } else { 0 };
        }
      }
      None => {
        for px in bgra.chunks_exact_mut(4) {
          if px[0] != 0 || px[1] != 0 || px[2] != 0 {
            px[3] = 255;
          }
        }
      }
    }
  }

  Some(CursorImage {
    bgra,
    width,
    height,
    hotspot_x: info.xHotspot,
    hotspot_y: info.yHotspot,
  })
}

/// Reads the AND mask (top `height` rows of hbmMask) as 32bpp; returns
/// per-pixel "opaque" flags (mask black = opaque).
fn read_and_mask(
  hdc: HDC,
  hbm_mask: HBITMAP,
  width: i32,
  height: i32,
  is_mono: bool,
) -> Option<Vec<bool>> {
  if hbm_mask.is_invalid() {
    return None;
  }
  let full_height = if is_mono { height * 2 } else { height };
  let mut bmi = BITMAPINFO {
    bmiHeader: BITMAPINFOHEADER {
      biSize: size_of::<BITMAPINFOHEADER>() as u32,
      biWidth: width,
      biHeight: -full_height, // top-down
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB.0,
      ..Default::default()
    },
    ..Default::default()
  };
  let mut buf = vec![0u8; (width as usize) * (full_height as usize) * 4];
  let scanned = unsafe {
    GetDIBits(
      hdc,
      hbm_mask,
      0,
      full_height as u32,
      Some(buf.as_mut_ptr().cast()),
      &mut bmi,
      DIB_RGB_COLORS,
    )
  };
  if scanned == 0 {
    return None;
  }
  let and_rows = &buf[..(width as usize) * (height as usize) * 4];
  Some(and_rows.chunks_exact(4).map(|px| px[0] == 0).collect())
}

fn encode_png(width: u32, height: u32, bgra: &[u8]) -> Option<Vec<u8>> {
  let mut rgba = bgra.to_vec();
  for px in rgba.chunks_exact_mut(4) {
    px.swap(0, 2);
  }
  let mut out = Vec::new();
  {
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().ok()?;
    writer.write_image_data(&rgba).ok()?;
  }
  Some(out)
}

fn sha1_hex(data: &[u8]) -> String {
  use std::fmt::Write as _;
  let digest = Sha1::digest(data);
  let mut hex = String::with_capacity(40);
  for byte in digest {
    let _ = write!(hex, "{byte:02x}");
  }
  hex
}
