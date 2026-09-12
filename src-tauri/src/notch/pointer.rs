//! Where the notch is, who may click it, and noticing a pointer arriving.
//!
//! Two problems, one rectangle.
//!
//! **Clicks.** The window covers a slab of the screen edge and the notch is a
//! sliver of it, so everywhere else has to let clicks through. That is done by
//! confining the window to a region — see `sys::window`, which also records why
//! the obvious `WS_EX_TRANSPARENT` route does not work behind a WebView2.
//!
//! **Hover.** The notch has to open when the pointer *approaches*, before any
//! click, and from outside the region there are no events to hear. So the
//! cursor is polled against the same rectangle, and the notch opens when it
//! lands inside.
//!
//! A poll rather than a mouse hook: a low-level `WH_MOUSE_LL` hook puts this
//! process in the input path of every mouse message on the desktop, and a slow
//! frame there stutters the whole system's cursor. `GetCursorPos` at 30 Hz is
//! a few microseconds of work and cannot affect anything else.
//!
//! Both of those assume the desktop is being used as a desktop. A full-screen
//! application is the case where neither assumption holds — the rectangle is
//! over something that has asked for the whole display, and the cursor inside
//! it belongs to that application rather than to a pointer. So the same poll
//! asks who owns the screen, and when the answer is not "nobody" the notch
//! stands down: no zone, no region, and no re-claiming the top of the band.
//! See `sys::foreground` for what each of those does to a game that is not
//! stood down for.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::sys::foreground;
use crate::sys::screen::{self, Rect};
use crate::sys::window;

/// How often the cursor is sampled. Fast enough that the notch opens as the
/// pointer lands rather than after it, cheap enough to be free.
const POLL_INTERVAL: Duration = Duration::from_millis(33);

/// How far outside the drawn chrome a pointer still counts as arriving, in
/// CSS pixels.
///
/// Small, and deliberately so. The notch sits on the screen edge, and the edge
/// is somewhere people put the pointer for reasons that have nothing to do
/// with it — a maximised window's sidebar, a scroll bar, a tab strip. A margin
/// wide enough to be forgiving is also wide enough to open the notch over
/// whatever they were actually reaching for, which reads as the thing opening
/// by itself. It only has to cover the shape's drop shadow: a pointer cannot
/// overshoot a target the edge of the screen is stopping it against.
const ENTER_MARGIN: f64 = 10.0;

/// How far outside it the pointer has to go before the notch counts it as
/// gone.
///
/// Wider than the way in, and that asymmetry is the point: the panel unfolds
/// under the pointer and the pointer then travels across it, so the way out
/// has to be forgiving. One margin doing both jobs has to be the wide one,
/// which is what made the way in too easy to trip. Two margins also mean
/// nothing flickers on the boundary — leaving takes more than re-crossing the
/// line that was entered.
const EXIT_MARGIN: f64 = 34.0;

/// How often the window re-claims the top of the always-on-top band. See
/// `window::raise_to_top` for what quietly takes it away.
const RAISE_EVERY: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, Default)]
struct Chrome {
    width: f64,
    height: f64,
    /// The chrome's vertical centre, from the top of the window.
    center_y: f64,
}

#[derive(Clone, Copy, Debug)]
struct Origin {
    x: i32,
    y: i32,
    scale: f64,
}

impl Default for Origin {
    fn default() -> Self {
        Self {
            x: 0,
            y: 0,
            scale: 1.0,
        }
    }
}

/// Where the notch currently is, and whether the pointer is on it.
#[derive(Default)]
pub struct HotZone {
    chrome: Mutex<Option<Chrome>>,
    origin: Mutex<Origin>,
    inside: AtomicBool,
    /// Set while a full-screen application has the notch's screen to itself.
    screen_owned: AtomicBool,
}

impl HotZone {
    pub fn new() -> Self {
        Self::default()
    }

    /// Told by `placement` whenever the window itself moves.
    pub fn set_origin(&self, x: i32, y: i32, scale: f64) {
        *self.origin.lock() = Origin {
            x,
            y,
            scale: if scale > 0.0 { scale } else { 1.0 },
        };
    }

    /// Told by the webview whenever the drawn chrome changes size.
    pub fn set_chrome(&self, width: f64, height: f64, center_y: f64) {
        *self.chrome.lock() = Some(Chrome {
            width,
            height,
            center_y,
        });
    }

    /// Told by the poll when a full-screen application takes the notch's
    /// screen, or hands it back. Answers whether that was news.
    fn set_screen_owned(&self, owned: bool) -> bool {
        self.screen_owned.swap(owned, Ordering::Relaxed) != owned
    }

    /// A point on the screen the notch calls home, for telling a game
    /// full-screen on this display from one full-screen on another.
    ///
    /// The window's own top-left corner: the window is pinned to the working
    /// area of the primary monitor, so its corner is on that monitor whether or
    /// not the webview has yet reported a shape to draw inside it.
    fn home(&self) -> (i32, i32) {
        let origin = *self.origin.lock();
        (origin.x, origin.y)
    }

    /// The zone in coordinates relative to the window's own top-left corner —
    /// which is what a window region is measured in.
    ///
    /// `margin` is in CSS pixels, and is scaled along with everything else.
    ///
    /// `None` while a full-screen application owns the notch's screen. That is
    /// the single place standing down is expressed, and everything downstream
    /// reads it without knowing why: the hover test finds no rectangle to be
    /// inside of, and the region falls back to the empty one it is cut to
    /// before the first frame — so the notch is neither reachable nor drawn
    /// until the screen is handed back.
    pub fn window_rect(&self, margin: f64) -> Option<Rect> {
        if self.screen_owned.load(Ordering::Relaxed) {
            return None;
        }
        let chrome = (*self.chrome.lock())?;
        let scale = self.origin.lock().scale;

        // The chrome hugs the left edge of the window, which hugs the left edge
        // of the screen, so only the vertical placement has to be worked out.
        let top = (chrome.center_y - chrome.height / 2.0) * scale;
        let margin = (margin * scale).round() as i32;

        Some(
            Rect {
                left: 0,
                top: top.round() as i32,
                right: (chrome.width * scale).round() as i32,
                bottom: (top + chrome.height * scale).round() as i32,
            }
            .inflated(margin),
        )
    }

    /// The same zone in physical screen pixels, for testing the cursor against.
    fn screen_rect(&self, margin: f64) -> Option<Rect> {
        let rect = self.window_rect(margin)?;
        let origin = *self.origin.lock();
        Some(Rect {
            left: rect.left + origin.x,
            top: rect.top + origin.y,
            right: rect.right + origin.x,
            bottom: rect.bottom + origin.y,
        })
    }

    /// Whether the pointer counts as on the notch, given where it was last
    /// time: one outside has to reach the chrome itself to get in, one already
    /// inside has the full margin to wander in before it is let go.
    fn holds(&self, x: i32, y: i32, was_inside: bool) -> bool {
        let margin = if was_inside { EXIT_MARGIN } else { ENTER_MARGIN };
        self.screen_rect(margin)
            .is_some_and(|rect| rect.contains(x, y))
    }
}

/// Confine the window to the zone, so clicks anywhere else pass through.
///
/// Called whenever either half of the zone changes — the chrome from the
/// webview, the origin from placement. Before the first call the window is
/// clipped to nothing at all, so a launch never eats a click in the moment
/// between the window appearing and the page reporting what it drew.
pub fn apply_region(app: &AppHandle, zone: &HotZone) {
    let Some(webview) = app.get_webview_window(super::WINDOW_LABEL) else {
        return;
    };
    let Some(handle) = window::hwnd_of(&webview) else {
        return;
    };

    // The wider of the two margins, so the region is never smaller than the
    // zone in force: a pointer the poll counts as inside has to be able to
    // click what it is standing on.
    let rect = zone.window_rect(EXIT_MARGIN).unwrap_or(Rect {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    });

    if !window::clip_to(handle, rect.left, rect.top, rect.right, rect.bottom) {
        tracing::warn!("couldn't confine the window to the notch");
    }
}

/// Re-claim the top of the always-on-top band.
pub fn raise(app: &AppHandle) {
    let Some(webview) = app.get_webview_window(super::WINDOW_LABEL) else {
        return;
    };
    let Some(handle) = window::hwnd_of(&webview) else {
        return;
    };
    window::raise_to_top(handle);
}

/// Start sampling the cursor. Runs until the process exits.
///
/// This thread also carries the topmost heartbeat. Not because the two have
/// anything to do with each other, but because it is the one thing already
/// ticking, and a second thread asleep 99.9% of the time to make one call
/// every couple of seconds is not worth its own stack.
pub fn watch(app: AppHandle, zone: Arc<HotZone>) {
    std::thread::Builder::new()
        .name("nook-pointer".into())
        .spawn(move || {
            let mut last_raise = std::time::Instant::now();

            loop {
                std::thread::sleep(POLL_INTERVAL);

                // Asked before anything else, because it decides everything
                // else. A full-screen window on another display still stops the
                // heartbeat — the claim re-orders the whole always-on-top band,
                // not one monitor's share of it — but only one on this display
                // takes the zone away.
                let fullscreen = foreground::fullscreen_monitor();
                let (home_x, home_y) = zone.home();
                let ours = fullscreen.is_some_and(|screen| screen.contains(home_x, home_y));

                if zone.set_screen_owned(ours) {
                    tracing::debug!(ours, "a full-screen application took or gave back a screen");
                    // The region is cut from the zone, and the zone has just
                    // vanished or come back. Re-cut now rather than waiting for
                    // the next thing that happens to move the notch: until it
                    // is, a click on where the notch was still lands on it.
                    apply_region(&app, &zone);
                }

                // The heartbeat, and the one thing that must not happen during
                // a game. `last_raise` is deliberately left un-advanced while
                // it is skipped, so the first tick after the game exits raises
                // at once instead of up to two seconds later.
                if fullscreen.is_none() && last_raise.elapsed() >= RAISE_EVERY {
                    last_raise = std::time::Instant::now();
                    raise(&app);
                }

                // Not skipped when stood down: `holds` is false with no zone to
                // hold anything, so a panel that was open when the game took the
                // screen is folded away by the ordinary path below.
                let Some((x, y)) = screen::cursor_position() else {
                    continue;
                };
                let was_inside = zone.inside.load(Ordering::Relaxed);
                let inside = zone.holds(x, y, was_inside);

                // Only on a change: emitting every tick would be thirty events
                // a second saying the same thing.
                if inside == was_inside {
                    continue;
                }
                zone.inside.store(inside, Ordering::Relaxed);

                tracing::debug!(inside, "pointer crossed the hot zone");
                // On the way in, before the page is told to unfold: a notch
                // that opens underneath whatever is drawn over it is worse than
                // one that stayed shut.
                if inside {
                    raise(&app);
                }
                let _ = app.emit("nook://pointer", inside);
            }
        })
        .expect("the OS can always start a thread this early in startup");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zone_at(center_y: f64) -> HotZone {
        let zone = HotZone::new();
        zone.set_origin(0, 100, 1.0);
        zone.set_chrome(70.0, 120.0, center_y);
        zone
    }

    #[test]
    fn the_region_is_the_chrome_plus_the_wider_margin() {
        let zone = zone_at(280.0);

        // Window-relative: the chrome runs from y=220 to y=340 inside the
        // window, and the margin takes it out to 186..374.
        let rect = zone
            .window_rect(EXIT_MARGIN)
            .expect("chrome has been reported");
        assert_eq!(rect.top, 220 - EXIT_MARGIN as i32);
        assert_eq!(rect.bottom, 340 + EXIT_MARGIN as i32);
        assert_eq!(rect.left, -(EXIT_MARGIN as i32));
        assert_eq!(rect.right, 70 + EXIT_MARGIN as i32);
    }

    #[test]
    fn the_screen_zone_is_the_same_rectangle_moved_by_the_window() {
        let rect = zone_at(280.0)
            .screen_rect(EXIT_MARGIN)
            .expect("chrome has been reported");
        assert_eq!(rect.top, 320 - EXIT_MARGIN as i32);
        assert_eq!(rect.bottom, 440 + EXIT_MARGIN as i32);
    }

    #[test]
    fn a_scaled_display_scales_the_zone_with_it() {
        let zone = HotZone::new();
        zone.set_origin(0, 0, 2.0);
        zone.set_chrome(70.0, 100.0, 200.0);

        let rect = zone
            .screen_rect(EXIT_MARGIN)
            .expect("chrome has been reported");
        // 150..250 in CSS pixels is 300..500 physical, plus the scaled margin.
        assert_eq!(rect.top, 300 - (EXIT_MARGIN * 2.0) as i32);
        assert_eq!(rect.bottom, 500 + (EXIT_MARGIN * 2.0) as i32);
    }

    #[test]
    fn nothing_is_hot_before_the_webview_has_drawn_anything() {
        let zone = HotZone::new();
        assert!(zone.window_rect(EXIT_MARGIN).is_none());
        assert!(zone.screen_rect(EXIT_MARGIN).is_none());
        assert!(!zone.holds(0, 0, false));
    }

    #[test]
    fn the_way_in_is_narrower_than_the_way_out() {
        // The chrome spans x=0..70 on screen; the two margins put the boundary
        // at 80 and 104.
        let zone = zone_at(280.0);
        let y = 380; // squarely within the chrome's own band

        // Coming from outside: past the enter margin is not yet arriving.
        assert!(zone.holds(75, y, false));
        assert!(!zone.holds(95, y, false));

        // Already inside: the same spot keeps the notch open.
        assert!(zone.holds(95, y, true));
        assert!(!zone.holds(110, y, true));
    }

    #[test]
    fn a_pointer_on_the_edge_beside_the_notch_is_not_on_it() {
        // Level with the notch but a comfortable window's-sidebar away from
        // it: the notch has no business opening here.
        assert!(!zone_at(280.0).holds(90, 380, false));
    }

    #[test]
    fn a_full_screen_application_takes_the_whole_zone_away() {
        let zone = zone_at(280.0);
        assert!(zone.holds(10, 380, false));

        zone.set_screen_owned(true);

        // No rectangle at all, which is both halves of standing down: a cursor
        // a game has parked on the screen edge is not a pointer on the notch,
        // and `apply_region` falls back to cutting the window to nothing, so
        // the click that cursor is about to make reaches the game.
        assert!(zone.window_rect(EXIT_MARGIN).is_none());
        assert!(!zone.holds(10, 380, true));

        // And all of it comes back the moment the game gives the screen up.
        zone.set_screen_owned(false);
        assert!(zone.holds(10, 380, false));
    }

    #[test]
    fn the_screen_changing_hands_is_news_once_and_not_thirty_times_a_second() {
        let zone = zone_at(280.0);
        assert!(zone.set_screen_owned(true));
        assert!(!zone.set_screen_owned(true));
        assert!(zone.set_screen_owned(false));
        assert!(!zone.set_screen_owned(false));
    }

    #[test]
    fn the_notch_knows_which_display_it_is_on() {
        // What a full-screen window's monitor is tested against: a game filling
        // a second display to the right holds no point of this one.
        let second_display = Rect {
            left: 1920,
            top: 0,
            right: 3840,
            bottom: 1080,
        };
        let (x, y) = zone_at(280.0).home();
        assert!(!second_display.contains(x, y));
    }
}
