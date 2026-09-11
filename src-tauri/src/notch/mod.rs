//! The window the notch lives in: where it sits, what wakes it, and the tray
//! icon that is the only other place the app appears.

pub mod placement;
pub mod pointer;
pub mod tray;

use std::str::FromStr;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::app::Nook;
use crate::model::Preferences;

pub const WINDOW_LABEL: &str = "notch";

/// Put the window where the preferences say, and tell both sides where that is.
///
/// Called at launch and whenever anything that could move it changes — the
/// anchor, the DPI, the taskbar. Cheap enough to simply re-run rather than
/// work out whether it needed to.
pub fn place_window(app: &AppHandle, nook: &Arc<Nook>) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };

    let scale = window.scale_factor().unwrap_or(1.0);
    let anchor = nook.preferences().anchor_fraction;

    let Some(geometry) = placement::compute(anchor, scale) else {
        tracing::warn!("no primary monitor to place the notch on");
        return;
    };

    let _ = window.set_size(PhysicalSize::new(
        geometry.width as u32,
        geometry.height as u32,
    ));
    let _ = window.set_position(PhysicalPosition::new(geometry.x, geometry.y));

    // After the resize, not before it. Setting `WS_EX_NOACTIVATE` during setup
    // does not survive: Tauri's own size and position calls rewrite the
    // extended style afterwards and the flag is quietly lost — which shows up
    // only as the notch stealing focus from the terminal it was asked to
    // raise.
    if let Some(hwnd) = crate::sys::window::hwnd_of(&window) {
        if !crate::sys::window::make_non_activating(hwnd) {
            tracing::warn!("couldn't stop the notch taking focus");
        }
    }

    // Placed, and put back in front. Tauri claims the always-on-top band once,
    // when the window is created — which at login is before the shell has
    // finished handing it out. See `sys::window::raise_to_top`.
    pointer::raise(app);

    nook.hot_zone.set_origin(geometry.x, geometry.y, scale);
    // The region is measured from the window's own corner, and the window has
    // just been resized — so it has to be re-cut even though the chrome inside
    // it has not changed.
    pointer::apply_region(app, &nook.hot_zone);
    nook.set_placement(geometry.placement);
    let _ = app.emit("nook://placement", geometry.placement);
}

/// Make a set of preferences take effect.
pub fn apply_preferences(app: &AppHandle, nook: &Arc<Nook>, preferences: &Preferences) {
    place_window(app, nook);
    apply_autostart(app, preferences.autostart);
    apply_hotkey(app, &preferences.hotkey);
    let _ = app.emit("nook://preferences", preferences.clone());
}

fn apply_autostart(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();

    // Asked first, because disabling something that was never enabled fails
    // with "the system cannot find the file specified" — there is no registry
    // value to remove — and that is not a problem worth a warning on every
    // launch of a default configuration.
    if manager.is_enabled().unwrap_or(false) == enabled {
        return;
    }

    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(error) = result {
        tracing::warn!(%error, enabled, "couldn't change the launch-at-login setting");
    }
}

/// Register the chord that opens the notch from anywhere.
///
/// Everything is unregistered first, including a chord that is about to be
/// registered again: a chord left over from the previous preferences would
/// otherwise keep firing, and the app would answer a shortcut the user had
/// already changed.
fn apply_hotkey(app: &AppHandle, chord: &str) {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();

    let chord = chord.trim();
    if chord.is_empty() {
        return;
    }

    let Ok(shortcut) = Shortcut::from_str(chord) else {
        tracing::warn!(chord, "not a shortcut this platform understands");
        return;
    };

    let result = shortcuts.on_shortcut(shortcut, move |app, _shortcut, event| {
        // Pressed only. A chord reports both edges, and answering both opens
        // the notch and closes it again in the time it takes to lift a finger.
        if event.state == ShortcutState::Pressed {
            let _ = app.emit("nook://toggle", ());
        }
    });

    match result {
        Ok(()) => tracing::info!(chord, "global shortcut registered"),
        // Almost always because something else already owns the chord. Worth a
        // log and nothing more: the notch still works, it just has no shortcut.
        Err(error) => tracing::warn!(chord, %error, "couldn't register the global shortcut"),
    }
}
