//! Whether another application currently has a screen to itself.
//!
//! Nook is a topmost overlay that re-claims the top of the always-on-top band
//! on a heartbeat, and polls the cursor against a rectangle on the screen edge.
//! Both of those are wrong while a game is full-screen, and each is wrong in
//! its own way.
//!
//! **The z-order claim evicts the game.** A `SetWindowPos(HWND_TOPMOST)` from
//! any process re-orders the always-on-top band, and a window arriving above a
//! display an exclusive full-screen swap chain owns is exactly the event that
//! makes Windows take that display back off it — the game drops to windowed or
//! minimises, and comes back a moment later when it re-acquires. Every two
//! seconds, which is the heartbeat's period. It is not the notch being drawn
//! that does this; it is the claim being re-made.
//!
//! **The cursor is not the pointer.** A game that captures the mouse reads raw
//! input and leaves the system cursor parked wherever Windows last put it —
//! frequently against a screen edge, because that is where a clipped cursor
//! ends up. `GetCursorPos` reports that parked position as happily as a real
//! one, so aiming in-game reads as a pointer sitting on the notch: the panel
//! unfolds over the game, and the region underneath it swallows the next click
//! instead of letting the game shoot with it.
//!
//! So the notch asks who owns the screen, and stands down when the answer is
//! not "nobody". See `notch::pointer::watch`, which is the only caller.

use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONULL,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowLongPtrW, GetWindowRect,
    IsIconic, IsWindowVisible, GWL_STYLE, WS_CAPTION,
};

use super::screen::Rect;

/// The bounds of the monitor a full-screen foreground application is covering,
/// or `None` when the desktop is being used normally.
///
/// The full bounds rather than the working area, and the frame as well as the
/// geometry — see `covers` and `has_a_caption` for what each of those two
/// rules out on its own.
///
/// Asked of the foreground window alone. A full-screen window that is not the
/// one being used — an alt-tabbed game, a video left running on a second
/// display — has already given up the display it was holding, and is no reason
/// for the notch to make itself scarce.
pub fn fullscreen_monitor() -> Option<Rect> {
    // SAFETY: every handle here comes from Win32 in the same block, and the
    // two out-parameters are stack locals that outlive their calls.
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.is_invalid() {
            return None;
        }

        // The desktop itself covers the screen and is always somebody's
        // foreground window between one app and the next. Both handles are
        // checked because they are different windows: `GetShellWindow` is
        // Explorer's `Progman`, `GetDesktopWindow` the root of the hierarchy.
        if foreground == GetShellWindow() || foreground == GetDesktopWindow() {
            return None;
        }

        if !IsWindowVisible(foreground).as_bool() || IsIconic(foreground).as_bool() {
            return None;
        }

        if has_a_caption(GetWindowLongPtrW(foreground, GWL_STYLE)) {
            return None;
        }

        let mut bounds = RECT::default();
        GetWindowRect(foreground, &mut bounds).ok()?;

        let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTONULL);
        if monitor.is_invalid() {
            return None;
        }

        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }

        let screen = Rect {
            left: info.rcMonitor.left,
            top: info.rcMonitor.top,
            right: info.rcMonitor.right,
            bottom: info.rcMonitor.bottom,
        };
        covers(from_win32(bounds), screen).then_some(screen)
    }
}

/// Does `window` leave none of `screen` showing?
///
/// The monitor's full bounds, which is most of what separates a full-screen
/// window from a merely maximised one: a maximised window stops at the
/// taskbar, and even an auto-hidden taskbar keeps a sliver of the display for
/// itself so there is something left to reveal it from.
///
/// `>=` rather than `==`: a full-screen window is routinely a pixel or two
/// larger than the display it is on, and a border-thickness overhang is not a
/// different kind of window.
fn covers(window: Rect, screen: Rect) -> bool {
    window.left <= screen.left
        && window.top <= screen.top
        && window.right >= screen.right
        && window.bottom >= screen.bottom
}

/// Is this a window that still has its title bar?
///
/// The other half of the test, and the half that covers where the geometry is
/// not enough. A maximised window fills the *working* area — but on a display
/// with no taskbar on it, which is any second monitor with "show taskbar on all
/// displays" switched off, the working area is the whole display. A maximised
/// browser there covers the monitor exactly, and would otherwise read as a
/// game.
///
/// What tells them apart is the frame, because going full-screen means giving
/// it up: DXGI strips a window to `WS_POPUP` on the way into exclusive
/// full-screen, a borderless-window game never had a frame to begin with, and
/// F11 in a browser or a video player takes the caption off. A window still
/// wearing its title bar has not asked for the display, however large somebody
/// has dragged it.
fn has_a_caption(style: isize) -> bool {
    let caption = WS_CAPTION.0 as isize;
    style & caption == caption
}

fn from_win32(rect: RECT) -> Rect {
    Rect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1080p display with a 48px taskbar along the bottom.
    const SCREEN: Rect = Rect {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
    };

    #[test]
    fn a_window_the_size_of_the_display_is_full_screen() {
        assert!(covers(SCREEN, SCREEN));
    }

    #[test]
    fn a_maximised_window_stops_at_the_taskbar_and_is_not() {
        let maximised = Rect {
            bottom: 1032,
            ..SCREEN
        };
        assert!(!covers(maximised, SCREEN));
    }

    #[test]
    fn an_auto_hidden_taskbars_last_sliver_is_still_not_full_screen() {
        // Windows keeps a maximised window a pixel short of an auto-hidden
        // taskbar, so there is something left to reveal it from.
        assert!(!covers(
            Rect {
                bottom: 1079,
                ..SCREEN
            },
            SCREEN
        ));
    }

    #[test]
    fn a_window_hanging_over_the_edges_is_full_screen_anyway() {
        let overhanging = Rect {
            left: -1,
            top: -1,
            right: 1921,
            bottom: 1081,
        };
        assert!(covers(overhanging, SCREEN));
    }

    #[test]
    fn a_display_is_judged_against_itself_and_not_the_desktop() {
        // A second display to the right of the first. A game full-screen on it
        // covers it, and covers nothing of the primary.
        let second = Rect {
            left: 1920,
            top: 0,
            right: 3840,
            bottom: 1080,
        };
        assert!(covers(second, second));
        assert!(!covers(second, SCREEN));
    }

    #[test]
    fn a_maximised_window_still_wearing_its_title_bar_is_not_full_screen() {
        use windows::Win32::UI::WindowsAndMessaging::{WS_THICKFRAME, WS_VISIBLE};
        assert!(has_a_caption(
            (WS_CAPTION | WS_THICKFRAME | WS_VISIBLE).0 as isize
        ));
    }

    #[test]
    fn a_window_stripped_to_a_popup_has_given_its_frame_up() {
        use windows::Win32::UI::WindowsAndMessaging::{WS_POPUP, WS_VISIBLE};
        assert!(!has_a_caption((WS_POPUP | WS_VISIBLE).0 as isize));
    }

    #[test]
    fn asking_the_real_desktop_answers_rather_than_faulting() {
        // Whatever is in the foreground under a test runner — the shell, a
        // console, nothing at all — the query has to come back with an answer
        // instead of tripping over a handle it was not expecting.
        let _ = fullscreen_monitor();
    }
}
