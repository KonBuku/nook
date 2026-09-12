//! Making a window exist only where the notch is drawn.
//!
//! The window covers a slab of the screen edge; the notch is a sliver of it.
//! Everywhere else has to let clicks through, or the app silently eats them.
//!
//! The obvious answer — `WS_EX_TRANSPARENT`, which is what Tauri's
//! `set_ignore_cursor_events` sets — does not work here, and the reason is
//! worth writing down. WebView2 hosts its content in a child window
//! (`Chrome_RenderWidgetHostHWND`) that belongs to **msedgewebview2.exe**, a
//! different process. Clearing the style on our own top-level window leaves
//! that child's alone, `SetWindowLong` across a process boundary is refused,
//! and the click lands on the child and falls through to whatever is behind.
//! Tauri's call returns `Ok`; the window simply stays transparent to clicks.
//!
//! A window region does work, because it is enforced by the window manager
//! above all of that: the region clips the window and every child of it, in
//! painting *and* in hit-testing, regardless of who owns which HWND. Outside
//! it the window is not there at all — a click goes to whatever is behind,
//! exactly as intended.
//!
//! The region is a rectangle rather than the notch's own outline. A region has
//! hard edges, and clipping to the silhouette would saw the anti-aliasing off
//! the curves that are the whole point of the shape. A rectangle a little
//! larger than the chrome keeps every soft edge and still gives back the rest
//! of the screen.

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, SetWindowRgn, HGDIOBJ};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    WS_EX_NOACTIVATE,
};

/// The HWND behind a Tauri window.
///
/// Tauri's `hwnd()` hands back an `HWND` from *its* version of the `windows`
/// crate, which is not the version this crate compiles against — so the handle
/// is carried across as the raw pointer it has always been. Both versions
/// declare `HWND` as a single pointer field, so this is a re-wrap and not a
/// reinterpretation; if a future version changes that, this stops compiling
/// rather than starting to lie.
///
/// Which is why the pointer is handed over untouched rather than cast to the
/// type it already has. A cast is what would let a future divergence through
/// quietly — it converts whatever it is given and says nothing — so the thing
/// that makes the paragraph above true is its absence.
pub fn hwnd_of(window: &tauri::WebviewWindow) -> Option<HWND> {
    Some(HWND(window.hwnd().ok()?.0))
}

/// Stop the window from ever taking focus.
///
/// Two things go wrong without this, and both look like the click was lost.
///
/// A window that can be activated *is* activated by the click that lands on
/// it, and Chromium spends that first click on the activation rather than
/// delivering it to the page — so the first click on the notch after touching
/// anything else does nothing at all.
///
/// And the click that reaches a session row asks Windows to raise that
/// session's terminal, which cannot win against the notch having just taken
/// the foreground itself.
///
/// The cost is that the page never receives the keyboard, so there is no
/// Escape-to-close. The global chord is the way out instead, which is the
/// right shape for a thing you reach for with the pointer anyway.
pub fn make_non_activating(window: HWND) -> bool {
    // SAFETY: our own top-level window, and `GWL_EXSTYLE` is a documented
    // index — a cross-process `SetWindowLong` would be refused, but this is
    // not one.
    unsafe {
        let style = GetWindowLongPtrW(window, GWL_EXSTYLE);
        if style == 0 {
            return false;
        }
        let wanted = style | WS_EX_NOACTIVATE.0 as isize;
        if style == wanted {
            return true;
        }
        SetWindowLongPtrW(window, GWL_EXSTYLE, wanted) != 0
    }
}

/// Put the window back at the top of the always-on-top band.
///
/// `alwaysOnTop` in the window config only sets `WS_EX_TOPMOST` once, when the
/// window is created, and that is not enough to keep it in front. Two things
/// undo it, and both of them happen on an ordinary launch at login:
///
/// Windows ranks topmost windows among themselves, and the last one to claim
/// the band wins. Everything else that starts with the session — the shell's
/// own overlays, other tray apps — claims it after we do, because we are up
/// before the desktop is. The notch then spends the whole session underneath
/// them until something raises it, and the only thing that ever did was a
/// click: a click on a window brings it to the top of its band even when the
/// window refuses activation, which is exactly why the notch appeared to fix
/// itself the moment it was touched.
///
/// So the claim is re-made: once when the window is placed, and then on a
/// slow heartbeat, which is the only thing that also covers a window that
/// takes the band later in the session.
///
/// The heartbeat is not unconditional. Re-ordering the band is exactly what
/// drops a game out of exclusive full-screen, so it is skipped while anything
/// is full-screen — see `sys::foreground`, which is the one case where making
/// this call is the bug rather than the fix.
///
/// Asynchronous, because this is called from the pointer thread and the
/// ordinary form of the call waits on the window's own thread — a webview busy
/// with a frame would otherwise stall the cursor poll behind it.
pub fn raise_to_top(window: HWND) -> bool {
    // SAFETY: our own top-level window; the size and position arguments are
    // ignored under `SWP_NOMOVE | SWP_NOSIZE`.
    unsafe {
        SetWindowPos(
            window,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS,
        )
        .is_ok()
    }
}

/// Confine the window to `rect`, given in coordinates relative to the window's
/// own top-left corner. Everything outside it stops existing.
pub fn clip_to(window: HWND, left: i32, top: i32, right: i32, bottom: i32) -> bool {
    // SAFETY: the region is handed to `SetWindowRgn`, which takes ownership of
    // it on success; on failure it is deleted here, so neither path leaks a GDI
    // object. A leak here would be one per animation frame.
    unsafe {
        let region = CreateRectRgn(left, top, right, bottom);
        if region.is_invalid() {
            return false;
        }

        // `false` for redraw: the region changes on every frame of the open
        // animation, and asking for a repaint each time fights the compositor
        // for the same pixels the webview is already drawing.
        if SetWindowRgn(window, region, false) == 0 {
            let _ = DeleteObject(HGDIOBJ(region.0));
            return false;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_impossible_window_is_refused_rather_than_crashing() {
        // Nothing owns this handle, so `SetWindowRgn` fails — and the region
        // it was given has to be freed rather than leaked.
        assert!(!clip_to(HWND(usize::MAX as *mut core::ffi::c_void), 0, 0, 10, 10));
    }
}
