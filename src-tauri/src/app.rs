//! The running app: what it holds, and the two loops that keep it current.
//!
//! One loop asks the endpoint how much of the limit is gone. The other watches
//! Claude Code's session registry. They are separate because they answer
//! different questions at different speeds — a limit moves over minutes, and
//! "Claude just finished" has to show up at once.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::claude::credentials::CredentialStore;
use crate::claude::sessions;
use crate::claude::usage::{UsageClient, UsageError};
use crate::model::{Placement, Preferences, Session, SessionState, UsageSnapshot, UsageStatus};
use crate::notch::pointer::HotZone;
use crate::store::Store;

pub struct Nook {
    pub store: Store,
    pub usage_client: UsageClient,
    pub hot_zone: Arc<HotZone>,

    usage: Mutex<UsageSnapshot>,
    sessions: Mutex<Vec<Session>>,
    placement: Mutex<Placement>,

    /// Rung when someone asks for a fetch now — the tray's Refresh, or a click
    /// on the ring. Wakes the poll loop out of its sleep rather than starting a
    /// second fetch beside it, so two clicks are still one request.
    refresh: Notify,
}

impl Nook {
    pub fn new() -> Self {
        let store = Store::load();
        let cache = store.cache();
        let credentials = Arc::new(CredentialStore::new());

        // The last good reading, shown dated until the first fetch lands, so a
        // fresh launch is a number with an age on it rather than an empty ring.
        let usage = cache.as_snapshot().unwrap_or_else(UsageSnapshot::pending);

        Self {
            usage_client: UsageClient::new(credentials, cache.backoff_until),
            store,
            hot_zone: Arc::new(HotZone::new()),
            usage: Mutex::new(usage),
            sessions: Mutex::new(Vec::new()),
            placement: Mutex::new(Placement {
                anchor_y: 0.0,
                window_width: 0.0,
                window_height: 0.0,
            }),
            refresh: Notify::new(),
        }
    }

    pub fn usage(&self) -> UsageSnapshot {
        self.usage.lock().clone()
    }

    pub fn sessions(&self) -> Vec<Session> {
        self.sessions.lock().clone()
    }

    pub fn placement(&self) -> Placement {
        *self.placement.lock()
    }

    pub fn set_placement(&self, placement: Placement) {
        *self.placement.lock() = placement;
    }

    pub fn preferences(&self) -> Preferences {
        self.store.preferences()
    }

    /// Ask the poll loop to fetch now. Ignores the poll timer, not the
    /// rate-limit back-off — the whole point of the back-off is that nothing
    /// gets to overrule it.
    pub fn request_refresh(&self) {
        self.refresh.notify_one();
    }

    /// Is anything running? Decides how often the endpoint is asked: a limit
    /// that nothing is spending does not move.
    fn anything_working(&self) -> bool {
        self.sessions
            .lock()
            .iter()
            .any(|session| session.state == SessionState::Busy)
    }
}

/// Fetch, publish, sleep, repeat.
pub async fn poll_usage(app: AppHandle, nook: Arc<Nook>) {
    loop {
        fetch_once(&app, &nook).await;

        let preferences = nook.preferences();
        let interval = if nook.anything_working() {
            preferences.active_poll_seconds
        } else {
            preferences.idle_poll_seconds
        };

        // Whichever comes first: the timer, or someone asking.
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(interval)) => {}
            _ = nook.refresh.notified() => {
                tracing::debug!("refresh asked for");
            }
        }
    }
}

async fn fetch_once(app: &AppHandle, nook: &Arc<Nook>) {
    let result = nook.usage_client.fetch().await;

    let snapshot = match result {
        Ok(fresh) => {
            nook.store.remember_reading(&fresh);
            nook.store.remember_backoff(None);
            fresh
        }
        Err(error) => {
            tracing::debug!(%error, "usage fetch failed");
            nook.store
                .remember_backoff(nook.usage_client.backoff_until());
            degrade(&nook.usage(), error)
        }
    };

    let changed = {
        let mut held = nook.usage.lock();
        let changed = *held != snapshot;
        *held = snapshot.clone();
        changed
    };

    if changed {
        let _ = app.emit("nook://usage", snapshot);
    }
}

/// What to show when a fetch fails.
///
/// A reading we already have outranks the reason the next one didn't arrive:
/// the number is still roughly true, and saying how old it is tells the reader
/// more than an error would. Only when there is nothing to show does the
/// failure itself become the thing on screen — and then it says which of the
/// several different things went wrong, because they need different answers.
fn degrade(previous: &UsageSnapshot, error: UsageError) -> UsageSnapshot {
    if !previous.windows.is_empty() {
        if let Some(since) = previous.fetched_at {
            return UsageSnapshot {
                status: UsageStatus::Stale { since },
                ..previous.clone()
            };
        }
    }

    UsageSnapshot {
        status: match error {
            UsageError::NeedsAuth => UsageStatus::NeedsAuth,
            UsageError::CredentialExpired => UsageStatus::CredentialExpired,
            UsageError::RateLimited { retry_after } => UsageStatus::RateLimited {
                until: crate::model::now_millis() + retry_after.as_millis() as i64,
            },
            UsageError::Http(message) => UsageStatus::Error { message },
        },
        windows: Vec::new(),
        headline_id: previous.headline_id.clone(),
        plan: previous.plan.clone(),
        fetched_at: previous.fetched_at,
    }
}

/// Watch Claude Code's session registry, and publish what is live.
///
/// Watched rather than polled, because Claude Code rewrites a session file the
/// moment its state changes — so "Claude is waiting on you" arrives as a file
/// event. The timer alongside it is not a fallback for that: it is there to
/// notice processes that died without touching the directory, which no file
/// event will ever report.
pub fn watch_sessions(app: AppHandle, nook: Arc<Nook>) {
    use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};

    let directory = sessions::sessions_dir();
    // The opening scan only seeds the state. Asking for a refresh here would
    // be a second request at the endpoint a few hundred milliseconds after the
    // poll loop's own opening fetch: `Notify` holds the permit until the loop
    // first sleeps, and the sleep then returns immediately.
    publish_sessions_inner(&app, &nook, false);

    let watcher = {
        let app = app.clone();
        let nook = nook.clone();
        // A single state change produces several file events — a write, a
        // rename, an attribute touch — so they are coalesced before a rescan.
        new_debouncer(Duration::from_millis(120), move |result: DebounceEventResult| {
            if result.is_ok() {
                publish_sessions(&app, &nook);
            }
        })
    };

    match watcher {
        Ok(mut debouncer) => {
            if let Err(error) = debouncer
                .watcher()
                .watch(&directory, RecursiveMode::NonRecursive)
            {
                // No directory yet is the ordinary state on a machine where
                // Claude Code has not run since installing. The timer below
                // still covers us, and it will pick sessions up the moment the
                // directory appears.
                tracing::info!(path = %directory.display(), %error, "not watching the session directory yet");
            }

            // Held for the life of the process: dropping the debouncer stops
            // the watch, and a watcher that stopped silently is a notch that
            // quietly goes out of date.
            std::thread::Builder::new()
                .name("nook-sessions".into())
                .spawn(move || {
                    let _debouncer = debouncer;
                    loop {
                        std::thread::sleep(Duration::from_secs(5));
                        publish_sessions(&app, &nook);
                    }
                })
                .expect("the OS can always start a thread this early in startup");
        }
        Err(error) => {
            tracing::warn!(%error, "falling back to polling the session directory");
            std::thread::Builder::new()
                .name("nook-sessions".into())
                .spawn(move || loop {
                    std::thread::sleep(Duration::from_secs(2));
                    publish_sessions(&app, &nook);
                })
                .expect("the OS can always start a thread this early in startup");
        }
    }
}

fn publish_sessions(app: &AppHandle, nook: &Arc<Nook>) {
    publish_sessions_inner(app, nook, true);
}

fn publish_sessions_inner(app: &AppHandle, nook: &Arc<Nook>, may_refresh: bool) {
    let found = sessions::scan(&sessions::sessions_dir());

    let changed = {
        let mut held = nook.sessions.lock();
        let changed = *held != found;
        if changed {
            *held = found.clone();
        }
        changed
    };

    // Don't churn the webview for nothing: the scan runs every five seconds
    // whether or not anything moved.
    if !changed {
        return;
    }

    tracing::debug!(count = found.len(), "sessions changed");
    let _ = app.emit("nook://sessions", found);

    // Something starting up is the moment the reading is most likely to be
    // about to move, and the moment someone is most likely to look at it.
    if may_refresh {
        nook.request_refresh();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::LimitWindow;

    fn reading() -> UsageSnapshot {
        UsageSnapshot {
            status: UsageStatus::Ok,
            windows: vec![LimitWindow {
                id: "session".into(),
                label: "Current session".into(),
                used_fraction: Some(0.73),
                resets_at: None,
            }],
            headline_id: Some("session".into()),
            plan: Some("max".into()),
            fetched_at: Some(1_700_000_000_000),
        }
    }

    #[test]
    fn a_failure_dates_the_reading_it_already_had() {
        let degraded = degrade(&reading(), UsageError::Http("offline".into()));
        assert_eq!(
            degraded.status,
            UsageStatus::Stale {
                since: 1_700_000_000_000
            }
        );
        // And keeps the number, because it is still roughly true.
        assert_eq!(degraded.windows.len(), 1);
    }

    #[test]
    fn with_nothing_to_show_the_failure_is_what_shows() {
        let empty = UsageSnapshot::pending();
        assert_eq!(
            degrade(&empty, UsageError::NeedsAuth).status,
            UsageStatus::NeedsAuth
        );
        assert_eq!(
            degrade(&empty, UsageError::CredentialExpired).status,
            UsageStatus::CredentialExpired
        );
        assert!(matches!(
            degrade(&empty, UsageError::Http("boom".into())).status,
            UsageStatus::Error { .. }
        ));
    }

    #[test]
    fn an_undated_reading_does_not_get_passed_off_as_merely_stale() {
        // Windows with no timestamp cannot be aged, so the failure wins.
        let undated = UsageSnapshot {
            fetched_at: None,
            ..reading()
        };
        assert_eq!(
            degrade(&undated, UsageError::NeedsAuth).status,
            UsageStatus::NeedsAuth
        );
    }
}
