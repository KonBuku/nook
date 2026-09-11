//! Nook — Claude usage and live Claude Code sessions, on the edge of the screen.
//!
//! The shape of the program:
//!
//! - `claude` reads what Claude Code already knows — its credential, its usage,
//!   its session registry. It never writes anything Claude Code owns.
//! - `sys` is the Win32 surface: is that process alive, which window is it
//!   typed into, where does the taskbar leave room.
//! - `notch` owns the window — where it sits, what wakes it, the tray icon.
//! - `app` holds the state and runs the two loops that keep it current.
//! - `commands` is the short list of things the webview may ask for.
//!
//! Everything the page needs arrives either as the answer to one of those
//! commands or as an event; the page itself reads no files and holds no
//! credentials.

mod app;
mod claude;
mod commands;
mod model;
mod notch;
mod store;
mod sys;

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

use app::Nook;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_usage,
            commands::get_sessions,
            commands::get_preferences,
            commands::get_placement,
            commands::refresh_usage,
            commands::save_preferences,
            commands::focus_session,
            commands::report_chrome,
            commands::quit_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let nook = Arc::new(Nook::new());
            app.manage(nook.clone());

            // Clipped to nothing before it is shown, so the window never
            // eats a click in the moment between appearing and the page
            // reporting what it drew. `apply_region` with no chrome reported
            // yet cuts it to an empty rectangle; the first `report_chrome`
            // opens it up to the notch.
            notch::pointer::apply_region(&handle, &nook.hot_zone);
            if let Some(window) = app.get_webview_window(notch::WINDOW_LABEL) {
                let _ = window.show();
            }

            let preferences = nook.preferences();
            notch::apply_preferences(&handle, &nook, &preferences);
            notch::tray::install(&handle, &nook)?;

            notch::pointer::watch(handle.clone(), nook.hot_zone.clone());
            app::watch_sessions(handle.clone(), nook.clone());
            tauri::async_runtime::spawn(app::poll_usage(handle, nook));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Nook could not start");
}

/// Logs to stderr, off unless asked for.
///
/// The app has no window to print into, so anything worth diagnosing goes to
/// the console a developer runs it from:
///
/// ```sh
/// NOOK_LOG=debug pnpm start
/// ```
fn install_logging() {
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_env("NOOK_LOG")
        .unwrap_or_else(|_| EnvFilter::new("nook_lib=warn"));

    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}
