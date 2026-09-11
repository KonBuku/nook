//! What survives a restart.
//!
//! Two files, kept apart on purpose. `settings.json` is the user's — it is
//! theirs to edit by hand and nothing here ever rewrites it behind their back.
//! `cache.json` is ours: the last good reading, so a fresh launch shows a dated
//! number instead of an empty ring, and the rate-limit deadline, so relaunching
//! during a penalty waits instead of spending an attempt on it.

use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::model::{LimitWindow, Millis, Preferences, UsageSnapshot, UsageStatus};

fn nook_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Nook")
}

pub fn settings_path() -> PathBuf {
    nook_dir().join("settings.json")
}

fn cache_path() -> PathBuf {
    nook_dir().join("cache.json")
}

/// The last reading, and how long we are still meant to be backing off.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Cache {
    #[serde(default)]
    pub windows: Vec<LimitWindow>,
    #[serde(default)]
    pub plan: Option<String>,
    /// When the cached reading was taken.
    #[serde(default)]
    pub fetched_at: Option<Millis>,
    /// A rate-limit deadline that has not passed yet.
    #[serde(default)]
    pub backoff_until: Option<Millis>,
}

impl Cache {
    /// The cached reading as a snapshot, dated so it cannot pass itself off as
    /// live. `None` when there is nothing worth showing.
    pub fn as_snapshot(&self) -> Option<UsageSnapshot> {
        let fetched_at = self.fetched_at?;
        if self.windows.is_empty() {
            return None;
        }
        Some(UsageSnapshot {
            status: UsageStatus::Stale { since: fetched_at },
            windows: self.windows.clone(),
            headline_id: Some("session".into()),
            plan: self.plan.clone(),
            fetched_at: Some(fetched_at),
        })
    }
}

pub struct Store {
    preferences: Mutex<Preferences>,
    cache: Mutex<Cache>,
}

impl Store {
    /// Read both files. A missing or unreadable file is a fresh install, not an
    /// error: the defaults are always a working configuration.
    pub fn load() -> Self {
        Self {
            preferences: Mutex::new(read_json(settings_path()).unwrap_or_default()),
            cache: Mutex::new(read_json(cache_path()).unwrap_or_default()),
        }
    }

    pub fn preferences(&self) -> Preferences {
        self.preferences.lock().clone()
    }

    pub fn set_preferences(&self, preferences: Preferences) -> Preferences {
        let sanitised = sanitise(preferences);
        *self.preferences.lock() = sanitised.clone();
        write_json(settings_path(), &sanitised);
        sanitised
    }

    pub fn cache(&self) -> Cache {
        self.cache.lock().clone()
    }

    /// Remember a reading that actually landed.
    pub fn remember_reading(&self, snapshot: &UsageSnapshot) {
        {
            let mut cache = self.cache.lock();
            cache.windows = snapshot.windows.clone();
            cache.plan = snapshot.plan.clone();
            cache.fetched_at = snapshot.fetched_at;
        }
        self.flush_cache();
    }

    pub fn remember_backoff(&self, until: Option<Millis>) {
        {
            let mut cache = self.cache.lock();
            if cache.backoff_until == until {
                return;
            }
            cache.backoff_until = until;
        }
        self.flush_cache();
    }

    fn flush_cache(&self) {
        let cache = self.cache.lock().clone();
        write_json(cache_path(), &cache);
    }
}

/// Keep a hand-edited settings file from producing an unusable notch.
///
/// The file is the user's to edit, so it can say anything — and an anchor of
/// `-3` or a poll interval of zero would be honoured all the way down to a
/// notch off the top of the screen hammering the endpoint. Clamped rather than
/// rejected: a value out of range is a typo, and refusing to start over one
/// would be worse than quietly using the nearest sane number.
fn sanitise(mut preferences: Preferences) -> Preferences {
    preferences.anchor_fraction = preferences.anchor_fraction.clamp(0.05, 0.95);
    // A floor, not a preference: the endpoint rate-limits, and a poll faster
    // than this is how you find that out.
    preferences.active_poll_seconds = preferences.active_poll_seconds.clamp(30, 3600);
    preferences.idle_poll_seconds = preferences
        .idle_poll_seconds
        .clamp(preferences.active_poll_seconds, 21_600);
    preferences
}

fn read_json<T: for<'de> Deserialize<'de>>(path: PathBuf) -> Option<T> {
    let text = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str(&text) {
        Ok(value) => Some(value),
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "ignoring an unreadable file");
            None
        }
    }
}

fn write_json<T: Serialize>(path: PathBuf, value: &T) {
    let Some(parent) = path.parent() else { return };
    if let Err(error) = std::fs::create_dir_all(parent) {
        tracing::warn!(path = %parent.display(), %error, "couldn't create the settings directory");
        return;
    }
    match serde_json::to_string_pretty(value) {
        Ok(text) => {
            if let Err(error) = std::fs::write(&path, text) {
                tracing::warn!(path = %path.display(), %error, "couldn't save");
            }
        }
        Err(error) => tracing::warn!(%error, "couldn't serialise"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::RestingStyle;

    #[test]
    fn a_hand_edited_anchor_is_clamped_onto_the_screen() {
        let wild = Preferences {
            anchor_fraction: -3.0,
            ..Default::default()
        };
        assert_eq!(sanitise(wild).anchor_fraction, 0.05);
    }

    #[test]
    fn the_poll_interval_has_a_floor_the_endpoint_can_live_with() {
        let eager = Preferences {
            active_poll_seconds: 1,
            idle_poll_seconds: 1,
            ..Default::default()
        };
        let safe = sanitise(eager);
        assert_eq!(safe.active_poll_seconds, 30);
        // Idle can never poll harder than active does.
        assert!(safe.idle_poll_seconds >= safe.active_poll_seconds);
    }

    #[test]
    fn the_defaults_survive_sanitising_unchanged() {
        let defaults = Preferences::default();
        assert_eq!(sanitise(defaults.clone()), defaults);
        assert_eq!(defaults.resting_style, RestingStyle::Ring);
    }

    #[test]
    fn an_empty_cache_offers_no_snapshot() {
        assert!(Cache::default().as_snapshot().is_none());
        // A timestamp with no windows behind it is not a reading either.
        let dated = Cache {
            fetched_at: Some(1),
            ..Default::default()
        };
        assert!(dated.as_snapshot().is_none());
    }

    #[test]
    fn a_cached_reading_comes_back_dated_rather_than_live() {
        let cache = Cache {
            windows: vec![LimitWindow {
                id: "session".into(),
                label: "Current session".into(),
                used_fraction: Some(0.73),
                resets_at: None,
            }],
            plan: Some("max".into()),
            fetched_at: Some(1_700_000_000_000),
            backoff_until: None,
        };
        let snapshot = cache.as_snapshot().expect("a dated reading");
        assert_eq!(
            snapshot.status,
            UsageStatus::Stale {
                since: 1_700_000_000_000
            }
        );
    }
}
