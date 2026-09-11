//! The tray icon — the only place Nook appears outside the notch itself.
//!
//! The window takes no focus and has no title bar, so there is nowhere else to
//! put "quit", and an app with no way out is not one anybody should install.

use std::sync::Arc;

use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::app::Nook;
use crate::store;

pub fn install(app: &AppHandle, nook: &Arc<Nook>) -> tauri::Result<()> {
    let preferences = nook.preferences();

    let open = MenuItem::with_id(app, "open", "Open Nook", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Windows",
        true,
        preferences.autostart,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Edit settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Nook", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open,
            &refresh,
            &PredefinedMenuItem::separator(app)?,
            &autostart,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("nook")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound("the bundled window icon".into())
        })?)
        .tooltip("Nook — Claude usage and live sessions")
        .menu(&menu)
        // The menu is for the right button; a left click just opens the notch,
        // which is what a tray icon for a thing you look at should do.
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = tray.app_handle().emit("nook://toggle", ());
            }
        })
        .build(app)?;

    Ok(())
}

fn handle_menu(app: &AppHandle, event: MenuEvent) {
    let Some(nook) = app.try_state::<Arc<Nook>>() else {
        return;
    };

    match event.id().as_ref() {
        "open" => {
            let _ = app.emit("nook://toggle", ());
        }
        "refresh" => nook.request_refresh(),
        "autostart" => {
            let mut preferences = nook.preferences();
            preferences.autostart = !preferences.autostart;
            let saved = nook.store.set_preferences(preferences);
            super::apply_preferences(app, &nook, &saved);
        }
        "settings" => open_settings_file(&nook),
        "quit" => app.exit(0),
        _ => {}
    }
}

/// Open `settings.json` in whatever the user's editor for JSON is.
///
/// Written out first if it is not there. A menu item that opens a file that
/// does not exist yet is a menu item that appears to do nothing on a fresh
/// install, and the defaults are the most useful thing to show someone about
/// to edit them.
fn open_settings_file(nook: &Arc<Nook>) {
    let path = store::settings_path();
    if !path.exists() {
        nook.store.set_preferences(nook.preferences());
    }

    // Through Explorer rather than `cmd /c start`: Explorer is a GUI process,
    // so nothing flashes a console window on the way past.
    if let Err(error) = std::process::Command::new("explorer").arg(&path).spawn() {
        tracing::warn!(path = %path.display(), %error, "couldn't open the settings file");
    }
}
