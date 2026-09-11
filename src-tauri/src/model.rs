//! The shapes that cross into the webview.
//!
//! Mirrored field for field by `src/ipc/types.ts`. Instants cross as
//! milliseconds since the Unix epoch: a number survives JSON without a
//! timezone to argue about, and the other side turns it back into a `Date`.

use serde::{Deserialize, Serialize};

/// Milliseconds since the Unix epoch.
pub type Millis = i64;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UsageStatus {
    Ok,
    /// The last good reading, kept across a failure — `since` is when it was
    /// taken. A remembered reading has to be dated, or it quietly passes
    /// itself off as live.
    Stale { since: Millis },
    /// No credential at all: Claude Code has never signed in on this machine.
    NeedsAuth,
    /// A credential that exists but has expired.
    ///
    /// Not the same as signed out. Claude Code rotates this token whenever it
    /// runs, and Nook deliberately does not — minting one would mean writing a
    /// credential it does not own, and racing the owner for it. So after a
    /// restart the token is often stale until Claude Code is next used, and the
    /// honest thing is to keep showing the last reading with its age rather
    /// than demand a sign-in that is not needed.
    CredentialExpired,
    /// Backing off after a 429; `until` is when the next attempt is allowed.
    RateLimited { until: Millis },
    Error { message: String },
}

/// One metered window a provider exposes.
///
/// Deserialised as well as serialised because the last good reading is cached
/// to disk and read back at launch — see `store::Cache`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    pub id: String,
    pub label: String,
    /// 0…1+, where 1 means the limit is spent.
    pub used_fraction: Option<f64>,
    /// None when the vendor does not say when the window rolls over.
    pub resets_at: Option<Millis>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub status: UsageStatus,
    pub windows: Vec<LimitWindow>,
    /// Which window the ring means, declared by the provider rather than left
    /// to position. Without it the headline is "whichever window happens to be
    /// first", and a window dropping out of the response silently promotes
    /// another one — the ring keeps its shape and quietly changes its subject.
    pub headline_id: Option<String>,
    /// The plan on the credential — "max", "pro".
    pub plan: Option<String>,
    pub fetched_at: Option<Millis>,
}

impl UsageSnapshot {
    /// What to show before the first fetch lands.
    pub fn pending() -> Self {
        Self {
            status: UsageStatus::Ok,
            windows: Vec::new(),
            headline_id: Some("session".into()),
            plan: None,
            fetched_at: None,
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    /// Claude is doing something right now.
    Busy,
    /// Blocked on you — a permission prompt, or a question.
    Waiting,
    /// Finished its turn. Still running, still yours to type into.
    Idle,
}

/// Where a session is running, as Claude Code's `entrypoint` reports it.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionSurface {
    Terminal,
    Vscode,
    Desktop,
    Agent,
}

impl SessionSurface {
    pub fn from_entrypoint(entrypoint: Option<&str>) -> Self {
        match entrypoint {
            Some("claude-vscode") | Some("vscode") => Self::Vscode,
            Some("claude-desktop") | Some("claude-desktop-3p") => Self::Desktop,
            Some("local-agent") | Some("agent") | Some("sdk") => Self::Agent,
            _ => Self::Terminal,
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub name: String,
    pub cwd: String,
    pub surface: SessionSurface,
    pub state: SessionState,
    /// Set while `Waiting`: what it wants from you, in Claude Code's words.
    pub waiting_for: Option<String>,
    /// When it entered its current state.
    pub since: Millis,
    pub pid: u32,
    /// Whether a window could be found to bring forward. Worked out once per
    /// scan rather than on click, so the row can say up front that clicking it
    /// will do nothing.
    pub focusable: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    /// Where the notch sits down the working area, 0 at the top and 1 at the
    /// bottom. The default puts it in the lower third — near the taskbar
    /// corner without being swallowed by it.
    pub anchor_fraction: f64,
    pub resting_style: RestingStyle,
    pub autostart: bool,
    /// Chord that opens the notch from anywhere. Empty disables it.
    pub hotkey: String,
    /// Seconds between usage polls while at least one session is busy.
    pub active_poll_seconds: u64,
    /// Seconds between usage polls while nothing is running. Deliberately far
    /// apart: a limit that nothing is spending does not move.
    pub idle_poll_seconds: u64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RestingStyle {
    /// Keep the ring showing. The reading is the point, so this is the default.
    Ring,
    /// Fold to a slim pill until the pointer arrives.
    Pill,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            anchor_fraction: 0.72,
            resting_style: RestingStyle::Ring,
            autostart: false,
            // Not Ctrl+Alt+Space: a stock Windows 11 hands that to the
            // input-method switcher, so it never registers.
            hotkey: "CommandOrControl+Alt+N".into(),
            active_poll_seconds: 60,
            idle_poll_seconds: 300,
        }
    }
}

/// Where the notch window is, so the webview can put the notch inside it.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    /// Distance from the window's top to the notch's vertical centre. Not
    /// simply half the height: the window is clamped to the working area, so
    /// near the bottom of a short screen the anchor sits below the middle.
    pub anchor_y: f64,
    pub window_width: f64,
    pub window_height: f64,
}

/// Now, in milliseconds since the Unix epoch.
pub fn now_millis() -> Millis {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as Millis)
        .unwrap_or(0)
}
