//! Everything the webview is allowed to ask for.
//!
//! Deliberately a short list. The page draws; it does not read files, hold
//! credentials, or touch Win32. Anything that does lives behind one of these.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::app::Nook;
use crate::model::{Placement, Preferences, Session, UsageSnapshot};
use crate::notch;
use crate::sys::process::{self, ProcessTable};

#[tauri::command]
pub fn get_usage(nook: State<'_, Arc<Nook>>) -> UsageSnapshot {
    nook.usage()
}

#[tauri::command]
pub fn get_sessions(nook: State<'_, Arc<Nook>>) -> Vec<Session> {
    nook.sessions()
}

#[tauri::command]
pub fn get_preferences(nook: State<'_, Arc<Nook>>) -> Preferences {
    nook.preferences()
}

#[tauri::command]
pub fn get_placement(nook: State<'_, Arc<Nook>>) -> Placement {
    nook.placement()
}

#[tauri::command]
pub fn refresh_usage(nook: State<'_, Arc<Nook>>) {
    nook.request_refresh();
}

#[tauri::command]
pub fn save_preferences(
    app: AppHandle,
    nook: State<'_, Arc<Nook>>,
    preferences: Preferences,
) -> Preferences {
    // Saved sanitised, and the sanitised copy is what comes back — so a value
    // that was clamped shows up in the settings UI as the value in force,
    // rather than as the one that was asked for and quietly overruled.
    let saved = nook.store.set_preferences(preferences);
    notch::apply_preferences(&app, &nook, &saved);
    saved
}

/// Bring the terminal running this session to the front.
///
/// Returns false when no window could be found — a session started from a
/// detached process or a service has none, and saying so is better than a
/// click that appears to do nothing.
#[tauri::command]
pub fn focus_session(pid: u32) -> bool {
    let table = ProcessTable::snapshot();
    match process::window_for(pid, &table) {
        Some(window) => {
            let raised = process::focus_window(window);
            // Logged on the way out as well as the way in: without this, a
            // click that never reached Rust and one that reached it and failed
            // read the same in the log, which cost an afternoon.
            tracing::info!(pid, raised, "raising this session's window");
            raised
        }
        None => {
            tracing::info!(pid, "no window found for this session");
            false
        }
    }
}

/// The webview telling us how big the chrome it just drew is.
///
/// This is what makes the window the shape of the notch: the region is
/// recomputed from it, so what is clickable and what is drawn cannot drift
/// apart. The page reports a size that has grown immediately and one that has
/// shrunk only once the animation has settled, so the region is never smaller
/// than the shape inside it.
#[tauri::command]
pub fn report_chrome(
    app: AppHandle,
    nook: State<'_, Arc<Nook>>,
    width: f64,
    height: f64,
    center_y: f64,
) {
    nook.hot_zone.set_chrome(width, height, center_y);
    notch::pointer::apply_region(&app, &nook.hot_zone);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
