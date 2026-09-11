//! Where the notch window goes.
//!
//! The window is a fixed, transparent slab pinned to the left edge of the
//! working area; the notch itself is drawn inside it by the webview. Sizing it
//! once and letting CSS move the chrome around inside it — rather than
//! resizing the window as the notch opens — is what keeps the open animation
//! smooth: a window that resizes every frame is a window the compositor
//! re-lays-out every frame.
//!
//! It is big enough to hold the notch at its tallest, and click-through
//! everywhere the chrome is not, so the slack costs nothing.

use crate::model::Placement;
use crate::sys::screen::{self, Rect};

/// The window's logical size, in CSS pixels.
///
/// Width: the open panel is 226 CSS px across (the design frame's 600px at the
/// 44pt-ring scale), and the rest is room for its shadow and for the pointer to
/// travel without falling out of the hot zone.
pub const WINDOW_WIDTH: f64 = 300.0;
/// Height: the tallest the panel gets — ring, four limit windows, the rule, and
/// five session rows — with slack for the open animation's overshoot.
pub const WINDOW_HEIGHT: f64 = 560.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Geometry {
    /// Physical screen pixels, which is what the window manager wants.
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    /// Logical CSS pixels, which is what the webview wants.
    pub placement: Placement,
}

/// Work out where the window sits for a given anchor and DPI scale.
///
/// `anchor_fraction` is how far down the working area the notch's centre wants
/// to be. The window is then clamped into the working area, which is why the
/// anchor is reported back separately: near the bottom of a short screen the
/// window cannot be centred on the anchor, and the webview has to draw the
/// notch off-centre rather than have it drift up the screen.
pub fn compute(anchor_fraction: f64, scale: f64) -> Option<Geometry> {
    let work = screen::primary_work_area()?;
    Some(within(work, anchor_fraction, scale))
}

/// The placement arithmetic, with the screen passed in so it can be tested.
pub fn within(work: Rect, anchor_fraction: f64, scale: f64) -> Geometry {
    let scale = if scale > 0.0 { scale } else { 1.0 };

    // Never taller than the screen it is on: a 560pt window on a 768px laptop
    // display at 150% would hang off both ends, and the clamp below would then
    // have nowhere to put it.
    let height = ((WINDOW_HEIGHT * scale).round() as i32).min(work.height());
    let width = ((WINDOW_WIDTH * scale).round() as i32).min(work.width());

    let anchor_fraction = anchor_fraction.clamp(0.0, 1.0);
    let anchor = work.top + (work.height() as f64 * anchor_fraction).round() as i32;

    let x = work.left;
    let y = (anchor - height / 2).clamp(work.top, work.bottom - height);

    Geometry {
        x,
        y,
        width,
        height,
        placement: Placement {
            anchor_y: (anchor - y) as f64 / scale,
            window_width: width as f64 / scale,
            window_height: height as f64 / scale,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1080p screen with a 48px taskbar along the bottom.
    fn laptop() -> Rect {
        Rect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1032,
        }
    }

    #[test]
    fn it_pins_to_the_left_edge_of_the_working_area() {
        let placed = within(laptop(), 0.72, 1.0);
        assert_eq!(placed.x, 0);
    }

    #[test]
    fn it_follows_a_taskbar_on_the_left() {
        let docked = Rect {
            left: 62,
            ..laptop()
        };
        assert_eq!(within(docked, 0.72, 1.0).x, 62);
    }

    #[test]
    fn the_anchor_sits_where_the_fraction_asks() {
        let placed = within(laptop(), 0.5, 1.0);
        // Centred on the anchor, so the anchor is halfway down the window.
        assert_eq!(placed.placement.anchor_y, placed.placement.window_height / 2.0);
    }

    #[test]
    fn near_the_bottom_the_window_clamps_and_the_anchor_moves_inside_it() {
        let placed = within(laptop(), 0.98, 1.0);
        // Flush with the bottom of the working area, not past it.
        assert_eq!(placed.y + placed.height, 1032);
        // And the notch is drawn low inside the window rather than dragged up
        // to its middle.
        assert!(placed.placement.anchor_y > placed.placement.window_height / 2.0);
        assert!(placed.placement.anchor_y <= placed.placement.window_height);
    }

    #[test]
    fn a_scaled_display_gets_physical_pixels_and_logical_placement() {
        let scaled = Rect {
            left: 0,
            top: 0,
            right: 2880,
            bottom: 1548,
        };
        let placed = within(scaled, 0.72, 1.5);
        assert_eq!(placed.width, (WINDOW_WIDTH * 1.5).round() as i32);
        // The webview still thinks in CSS pixels, so its numbers are unscaled.
        assert_eq!(placed.placement.window_width, WINDOW_WIDTH);
    }

    #[test]
    fn a_screen_shorter_than_the_window_still_gets_one_that_fits() {
        let short = Rect {
            left: 0,
            top: 0,
            right: 1280,
            bottom: 400,
        };
        let placed = within(short, 0.72, 1.0);
        assert_eq!(placed.height, 400);
        assert_eq!(placed.y, 0);
    }
}
