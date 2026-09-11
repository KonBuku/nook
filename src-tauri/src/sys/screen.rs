//! Where the usable screen actually is.
//!
//! `GetMonitorInfoW`'s `rcWork` rather than the monitor's full bounds, so the
//! notch rests against the taskbar instead of underneath it — and follows when
//! the taskbar is moved, hidden or resized, because the working area is
//! re-read on every placement rather than measured once at launch.

use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, HMONITOR, MONITORINFO, MONITOR_DEFAULTTOPRIMARY,
};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

/// A rectangle in physical screen pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }

    /// The same rectangle, grown by `margin` on every side.
    pub fn inflated(&self, margin: i32) -> Self {
        Self {
            left: self.left - margin,
            top: self.top - margin,
            right: self.right + margin,
            bottom: self.bottom + margin,
        }
    }
}

/// The working area of the primary monitor — the screen minus the taskbar.
///
/// The primary monitor rather than whichever one the pointer is over: the notch
/// has a home, and one that moved between displays as the mouse wandered would
/// be a worse object than one that stays put.
pub fn primary_work_area() -> Option<Rect> {
    // SAFETY: `MONITORINFO` is initialised with the size field Win32 requires,
    // and the handle comes from Win32 in the line above.
    unsafe {
        let monitor: HMONITOR = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);

        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };

        GetMonitorInfoW(monitor, &mut info)
            .as_bool()
            .then_some(Rect {
                left: info.rcWork.left,
                top: info.rcWork.top,
                right: info.rcWork.right,
                bottom: info.rcWork.bottom,
            })
    }
}

/// The pointer, in physical screen pixels.
pub fn cursor_position() -> Option<(i32, i32)> {
    // SAFETY: `point` is a stack local that outlives the call.
    unsafe {
        let mut point = POINT::default();
        GetCursorPos(&mut point).ok()?;
        Some((point.x, point.y))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rect_knows_what_it_holds() {
        let rect = Rect {
            left: 10,
            top: 20,
            right: 110,
            bottom: 220,
        };
        assert_eq!(rect.width(), 100);
        assert_eq!(rect.height(), 200);
        assert!(rect.contains(10, 20));
        // Half-open, so two adjacent rects never both claim the same pixel.
        assert!(!rect.contains(110, 220));
        assert!(rect.inflated(5).contains(6, 16));
    }

    #[test]
    fn the_primary_monitor_has_a_working_area() {
        let work = primary_work_area().expect("a desktop session always has a primary monitor");
        assert!(work.width() > 0 && work.height() > 0);
    }
}
