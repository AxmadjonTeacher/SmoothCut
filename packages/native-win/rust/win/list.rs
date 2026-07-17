//! Display + window enumeration, serialized to the same JSON shape the mac
//! recorder's `list` command prints.
//!
//! Coordinate conventions (mirrors packages/shared recording.ts):
//! - Display ids are HMONITOR values, window ids are HWND values — both as
//!   decimal strings, stable for the lifetime of a desktop session.
//! - `widthPt`/`heightPt`/`originX`/`originY` and window rects are LOGICAL
//!   POINTS: physical px divided by that monitor's effective DPI scale
//!   (`GetDpiForMonitor` / 96). Multiply by `scaleFactor` to recover exact
//!   physical px. Note this is a per-monitor division, which matches
//!   Chromium's DIP space only when monitors share a scale factor — the
//!   integration notes cover the mixed-DPI caveat.

use std::mem::size_of;

use serde::Serialize;
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{
  EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFOEXW,
  MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Threading::{
  OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
  EnumWindows, GetWindowLongW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
  IsWindowVisible, GWL_EXSTYLE, MONITORINFOF_PRIMARY, WS_EX_TOOLWINDOW,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayJson {
  id: String,
  width_pt: f64,
  height_pt: f64,
  scale_factor: f64,
  origin_x: f64,
  origin_y: f64,
  is_primary: bool,
  label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowJson {
  id: String,
  title: String,
  app_name: String,
  display_id: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
}

#[derive(Serialize)]
struct ListJson {
  displays: Vec<DisplayJson>,
  windows: Vec<WindowJson>,
}

pub fn monitor_id(hmon: HMONITOR) -> String {
  (hmon.0 as isize).to_string()
}

pub fn scale_for_monitor(hmon: HMONITOR) -> f64 {
  let mut dpi_x = 0u32;
  let mut dpi_y = 0u32;
  match unsafe { GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) } {
    Ok(()) if dpi_x > 0 => f64::from(dpi_x) / 96.0,
    _ => 1.0,
  }
}

unsafe extern "system" fn monitor_enum_proc(
  hmon: HMONITOR,
  _hdc: HDC,
  _rect: *mut RECT,
  lparam: LPARAM,
) -> BOOL {
  let monitors = unsafe { &mut *(lparam.0 as *mut Vec<HMONITOR>) };
  monitors.push(hmon);
  BOOL::from(true)
}

fn utf16_until_nul(buf: &[u16]) -> String {
  let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
  String::from_utf16_lossy(&buf[..len])
}

fn snapshot_display(hmon: HMONITOR) -> Option<DisplayJson> {
  let mut info = MONITORINFOEXW::default();
  info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
  // MONITORINFOEXW starts with MONITORINFO; the EXW cbSize makes
  // GetMonitorInfoW fill szDevice as well.
  let ok = unsafe { GetMonitorInfoW(hmon, std::ptr::addr_of_mut!(info.monitorInfo)) };
  if !ok.as_bool() {
    return None;
  }
  let rect = info.monitorInfo.rcMonitor;
  let device = utf16_until_nul(&info.szDevice);
  let scale = scale_for_monitor(hmon);

  // Physical px: prefer the current display mode (DPI-awareness independent),
  // fall back to the monitor rect.
  let monitor = windows_capture::monitor::Monitor::from_raw_hmonitor(hmon.0);
  let width_px = monitor.width().ok().filter(|&w| w > 0).unwrap_or((rect.right - rect.left).max(0) as u32);
  let height_px = monitor.height().ok().filter(|&h| h > 0).unwrap_or((rect.bottom - rect.top).max(0) as u32);
  if width_px == 0 || height_px == 0 {
    return None;
  }
  let label = monitor
    .name()
    .ok()
    .filter(|name| !name.is_empty())
    .unwrap_or(device);

  Some(DisplayJson {
    id: monitor_id(hmon),
    width_pt: f64::from(width_px) / scale,
    height_pt: f64::from(height_px) / scale,
    scale_factor: scale,
    origin_x: f64::from(rect.left) / scale,
    origin_y: f64::from(rect.top) / scale,
    is_primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
    label,
  })
}

fn process_name_for_window(hwnd: HWND) -> String {
  let mut pid = 0u32;
  unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
  if pid == 0 {
    return String::new();
  }
  let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
    return String::new();
  };
  let mut buf = [0u16; 1024];
  let mut len = buf.len() as u32;
  let result = unsafe {
    QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
  };
  let _ = unsafe { CloseHandle(process) };
  if result.is_err() || len == 0 {
    return String::new();
  }
  let path = String::from_utf16_lossy(&buf[..len as usize]);
  let base = path.rsplit(['\\', '/']).next().unwrap_or(&path);
  let name = base
    .strip_suffix(".exe")
    .or_else(|| base.strip_suffix(".EXE"))
    .unwrap_or(base);
  name.to_string()
}

fn snapshot_window(hwnd: HWND) -> Option<WindowJson> {
  if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
    return None;
  }
  let ex_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
  if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
    return None;
  }
  // Skip DWM-cloaked windows (suspended UWP apps, other virtual desktops).
  let mut cloaked = 0u32;
  let cloak_query = unsafe {
    DwmGetWindowAttribute(
      hwnd,
      DWMWA_CLOAKED,
      std::ptr::addr_of_mut!(cloaked).cast(),
      size_of::<u32>() as u32,
    )
  };
  if cloak_query.is_ok() && cloaked != 0 {
    return None;
  }

  let mut title_buf = [0u16; 512];
  let title_len = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
  if title_len <= 0 {
    return None;
  }
  let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

  let mut rect = RECT::default();
  if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
    return None;
  }
  if rect.right <= rect.left || rect.bottom <= rect.top {
    return None;
  }

  let hmon = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
  if hmon.is_invalid() {
    return None;
  }
  let scale = scale_for_monitor(hmon);

  Some(WindowJson {
    id: (hwnd.0 as isize).to_string(),
    title,
    app_name: process_name_for_window(hwnd),
    display_id: monitor_id(hmon),
    x: f64::from(rect.left) / scale,
    y: f64::from(rect.top) / scale,
    width: f64::from(rect.right - rect.left) / scale,
    height: f64::from(rect.bottom - rect.top) / scale,
  })
}

unsafe extern "system" fn window_enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
  let windows_out = unsafe { &mut *(lparam.0 as *mut Vec<WindowJson>) };
  if let Some(snapshot) = snapshot_window(hwnd) {
    windows_out.push(snapshot);
  }
  BOOL::from(true)
}

pub fn list_shareable_content_json() -> Result<String, String> {
  let mut monitors: Vec<HMONITOR> = Vec::new();
  let ok = unsafe {
    EnumDisplayMonitors(
      None,
      None,
      Some(monitor_enum_proc),
      LPARAM(std::ptr::addr_of_mut!(monitors) as isize),
    )
  };
  if !ok.as_bool() {
    return Err("EnumDisplayMonitors failed".to_string());
  }
  let displays: Vec<DisplayJson> = monitors.into_iter().filter_map(snapshot_display).collect();
  if displays.is_empty() {
    return Err("no displays found".to_string());
  }

  let mut windows_list: Vec<WindowJson> = Vec::new();
  // EnumWindows only fails if the callback returns FALSE (ours never does);
  // treat failure as "no windows" rather than a hard error.
  let _ = unsafe {
    EnumWindows(Some(window_enum_proc), LPARAM(std::ptr::addr_of_mut!(windows_list) as isize))
  };

  serde_json::to_string(&ListJson { displays, windows: windows_list })
    .map_err(|e| format!("failed to serialize shareable content: {e}"))
}
