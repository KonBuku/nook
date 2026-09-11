//! The same usage endpoint Claude Code's own `/usage` reads, asked with the
//! token Claude Code already holds.
//!
//! The numbers are Anthropic's, so the panel shows them unqualified. The
//! endpoint is not a published API, though, so every failure path degrades to
//! a status the UI can render honestly rather than to a guess.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Deserialize;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use super::credentials::CredentialStore;
use crate::model::{LimitWindow, Millis, UsageSnapshot, UsageStatus};

const ENDPOINT: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";

#[derive(Debug, thiserror::Error)]
pub enum UsageError {
    #[error("no Claude credential on this machine")]
    NeedsAuth,
    #[error("Claude's saved token has expired")]
    CredentialExpired,
    #[error("rate limited")]
    RateLimited { retry_after: Duration },
    #[error("{0}")]
    Http(String),
}

pub struct UsageClient {
    http: reqwest::Client,
    credentials: Arc<CredentialStore>,
    backoff: Mutex<Backoff>,
}

#[derive(Default)]
struct Backoff {
    /// Until this passes, a fetch is skipped without touching the network — a
    /// poll that keeps firing into a rate limit is how you stay rate limited.
    until: Option<Millis>,
    /// How many 429s in a row. The endpoint answers `Retry-After: 0`, which is
    /// no guidance at all, so the wait doubles each time instead.
    consecutive: u32,
}

impl UsageClient {
    pub fn new(credentials: Arc<CredentialStore>, resume_backoff_until: Option<Millis>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("Nook/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("the rustls backend is compiled in, so a client always builds");

        Self {
            http,
            credentials,
            backoff: Mutex::new(Backoff {
                // Pick the back-off back up where the last run left it, so
                // relaunching during a penalty does not spend an attempt
                // extending it.
                until: resume_backoff_until,
                consecutive: 0,
            }),
        }
    }

    /// When the next attempt is allowed, if one is being withheld.
    pub fn backoff_until(&self) -> Option<Millis> {
        let backoff = self.backoff.lock();
        backoff
            .until
            .filter(|until| *until > crate::model::now_millis())
    }

    pub async fn fetch(&self) -> Result<UsageSnapshot, UsageError> {
        if let Some(until) = self.backoff_until() {
            let remaining = (until - crate::model::now_millis()).max(0) as u64;
            tracing::debug!(remaining_ms = remaining, "skipping fetch, backing off");
            return Err(UsageError::RateLimited {
                retry_after: Duration::from_millis(remaining),
            });
        }

        match self.attempt(true).await {
            Ok(snapshot) => {
                let mut backoff = self.backoff.lock();
                backoff.until = None;
                backoff.consecutive = 0;
                Ok(snapshot)
            }
            Err(UsageError::RateLimited { retry_after }) => {
                let mut backoff = self.backoff.lock();
                backoff.consecutive = backoff.consecutive.saturating_add(1);
                let wait = Self::wait_after_429(backoff.consecutive, Some(retry_after));
                backoff.until = Some(crate::model::now_millis() + wait.as_millis() as Millis);
                tracing::warn!(
                    attempt = backoff.consecutive,
                    wait_s = wait.as_secs(),
                    "rate limited"
                );
                Err(UsageError::RateLimited { retry_after: wait })
            }
            Err(error) => {
                // A rejected credential means the held copy is wrong, which is
                // what signing into a different account looks like from here.
                if matches!(error, UsageError::NeedsAuth | UsageError::CredentialExpired) {
                    self.credentials.forget();
                }
                Err(error)
            }
        }
    }

    async fn attempt(&self, retry_on_unauthorized: bool) -> Result<UsageSnapshot, UsageError> {
        let credentials = self.credentials.load().map_err(|error| {
            tracing::debug!(%error, "no usable Claude credential");
            UsageError::NeedsAuth
        })?;

        // Expired is not signed out — see `UsageStatus::CredentialExpired`.
        if credentials.is_expired() {
            return Err(UsageError::CredentialExpired);
        }

        tracing::debug!("GET /api/oauth/usage");
        let response = self
            .http
            .get(ENDPOINT)
            .bearer_auth(&credentials.access_token)
            .header("anthropic-beta", OAUTH_BETA)
            .send()
            .await
            .map_err(|error| UsageError::Http(friendly(&error)))?;

        let status = response.status();
        tracing::debug!(status = status.as_u16(), "usage endpoint answered");

        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            // Rejected but unexpired: the held copy is wrong. Re-read once, in
            // case Claude Code has refreshed the token since.
            self.credentials.forget();
            if retry_on_unauthorized {
                return Box::pin(self.attempt(false)).await;
            }
            return Err(UsageError::NeedsAuth);
        }

        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(UsageError::RateLimited {
                retry_after: retry_after_header(response.headers()).unwrap_or_default(),
            });
        }

        if !status.is_success() {
            return Err(UsageError::Http(format!("the endpoint answered {status}")));
        }

        let payload: UsageResponse = response
            .json()
            .await
            .map_err(|error| UsageError::Http(format!("unreadable response — {error}")))?;

        Ok(UsageSnapshot {
            status: UsageStatus::Ok,
            windows: payload.limit_windows(),
            headline_id: Some("session".into()),
            plan: credentials.subscription_type,
            fetched_at: Some(crate::model::now_millis()),
        })
    }

    /// How long to wait after a 429.
    ///
    /// The server's own hint is honoured only as a *floor-raiser*: it answers
    /// `Retry-After: 0`, and obeying that literally means retrying immediately,
    /// which is what keeps you rate limited. So the wait starts at a minute and
    /// doubles for each 429 in a row, capped so it always recovers on its own.
    pub fn wait_after_429(consecutive: u32, retry_after: Option<Duration>) -> Duration {
        const FLOOR: u64 = 60;
        const CEILING: u64 = 15 * 60;
        let doubled = FLOOR * 2u64.pow(consecutive.saturating_sub(1).min(4));
        let hinted = retry_after.map(|wait| wait.as_secs()).unwrap_or(0);
        Duration::from_secs(doubled.max(hinted).min(CEILING))
    }
}

/// `Retry-After` is either a number of seconds or an HTTP date.
fn retry_after_header(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let raw = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim();

    if let Ok(seconds) = raw.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }

    // "Fri, 28 Aug 2026 05:15:20 GMT"
    let format = time::format_description::parse_borrowed::<2>(
        "[weekday repr:short], [day] [month repr:short] [year] [hour]:[minute]:[second] GMT",
    )
    .ok()?;
    let at = time::PrimitiveDateTime::parse(raw, &format)
        .ok()?
        .assume_utc();
    let seconds = at.unix_timestamp() - OffsetDateTime::now_utc().unix_timestamp();
    Some(Duration::from_secs(seconds.max(0) as u64))
}

/// Network errors phrased for someone looking at a notch, not a stack trace.
fn friendly(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "the endpoint did not answer in time".into()
    } else if error.is_connect() {
        "couldn't reach api.anthropic.com".into()
    } else {
        error.to_string()
    }
}

/// The shape of `GET /api/oauth/usage`.
#[derive(Deserialize, Debug)]
pub struct UsageResponse {
    limits: Option<Vec<Limit>>,
    five_hour: Option<Window>,
    seven_day: Option<Window>,
}

#[derive(Deserialize, Debug)]
struct Limit {
    kind: String,
    percent: f64,
    resets_at: Option<String>,
    /// What this window covers, when it covers less than everything.
    ///
    /// A `weekly_scoped` window is the weekly allowance for one model, and the
    /// endpoint says which one here rather than in the kind — so the kind is
    /// the same string whichever model it is about, and the name is the only
    /// thing that tells a reader what the number refers to.
    scope: Option<Scope>,
}

#[derive(Deserialize, Debug)]
struct Scope {
    model: Option<ScopedModel>,
}

#[derive(Deserialize, Debug)]
struct ScopedModel {
    display_name: Option<String>,
}

impl Limit {
    /// The model this window is about, if it is about one.
    fn scoped_to(&self) -> Option<&str> {
        self.scope
            .as_ref()?
            .model
            .as_ref()?
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
    }
}

#[derive(Deserialize, Debug)]
struct Window {
    utilization: f64,
    resets_at: Option<String>,
}

impl UsageResponse {
    /// `limits` is the forward-compatible shape — it grows new kinds as
    /// Anthropic adds them — so it is preferred, with the two named windows
    /// merged in behind it.
    pub fn limit_windows(&self) -> Vec<LimitWindow> {
        let mut windows: Vec<LimitWindow> = self
            .limits
            .iter()
            .flatten()
            .filter_map(|limit| {
                let resets_at = parse_instant(limit.resets_at.as_deref())?;
                Some(LimitWindow {
                    id: limit.kind.clone(),
                    label: label_for(&limit.kind, limit.scoped_to()),
                    used_fraction: Some(limit.percent / 100.0),
                    resets_at: Some(resets_at),
                })
            })
            .collect();

        // The named windows are merged in rather than used only as a fallback.
        // Claude Code's own schema says an entry is "present only while the API
        // reports it and its resets_at has not passed", so a window that has
        // just rolled over disappears from `limits` while `five_hour` still
        // carries it. Relying on the array alone loses the session exactly when
        // it resets, which is when someone is most likely to be looking.
        merge(
            &mut windows,
            self.five_hour.as_ref(),
            "session",
            "Current session",
        );
        merge(
            &mut windows,
            self.seven_day.as_ref(),
            "weekly_all",
            "All models",
        );

        windows.sort_by_key(|window| (display_rank(&window.id), window.id.clone()));
        windows
    }
}

fn merge(windows: &mut Vec<LimitWindow>, window: Option<&Window>, id: &str, label: &str) {
    let Some(window) = window else { return };
    if windows.iter().any(|existing| existing.id == id) {
        return;
    }
    let Some(resets_at) = parse_instant(window.resets_at.as_deref()) else {
        return;
    };
    windows.push(LimitWindow {
        id: id.into(),
        label: label.into(),
        used_fraction: Some(window.utilization / 100.0),
        resets_at: Some(resets_at),
    });
}

/// The design frame's wording, for the kinds it drew.
///
/// A window that names its own subject is labelled with that name, whatever
/// the kind says. `weekly_scoped` is the endpoint's one kind for "a week of
/// one model" — every model shares it, and the name beside it is the only
/// part that differs — so labelling it from the kind puts the word "Scoped" on
/// a row whose number is about Fable, or Opus, or whatever the plan scopes.
fn label_for(kind: &str, scoped_to: Option<&str>) -> String {
    if let Some(model) = scoped_to {
        return model.into();
    }

    match kind {
        "session" => "Current session".into(),
        "weekly_all" => "All models".into(),
        "weekly_opus" => "Opus".into(),
        "weekly_sonnet" => "Sonnet".into(),
        other => {
            let words = other.trim_start_matches("weekly_").replace('_', " ");
            let mut chars = words.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => words,
            }
        }
    }
}

/// Session first, then the weekly windows — the order the frame shows.
fn display_rank(id: &str) -> u8 {
    match id {
        "session" => 0,
        "weekly_all" => 1,
        _ => 2,
    }
}

/// Timestamps come back RFC 3339, sometimes with fractional seconds.
fn parse_instant(text: Option<&str>) -> Option<Millis> {
    let at = OffsetDateTime::parse(text?, &Rfc3339).ok()?;
    Some((at.unix_timestamp_nanos() / 1_000_000) as Millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn back_off_ignores_the_endpoints_useless_zero() {
        // The endpoint answers `Retry-After: 0`; obeying it means retrying at
        // once, which is what keeps you rate limited.
        let wait = UsageClient::wait_after_429(1, Some(Duration::ZERO));
        assert_eq!(wait, Duration::from_secs(60));
    }

    #[test]
    fn back_off_doubles_then_caps() {
        assert_eq!(UsageClient::wait_after_429(2, None), Duration::from_secs(120));
        assert_eq!(UsageClient::wait_after_429(3, None), Duration::from_secs(240));
        // Capped, so it always recovers on its own.
        assert_eq!(UsageClient::wait_after_429(9, None), Duration::from_secs(900));
    }

    #[test]
    fn a_longer_server_hint_wins() {
        let wait = UsageClient::wait_after_429(1, Some(Duration::from_secs(300)));
        assert_eq!(wait, Duration::from_secs(300));
    }

    #[test]
    fn the_session_window_survives_dropping_out_of_limits() {
        // `limits` omits a window whose reset has just passed; `five_hour`
        // still carries it, and losing it there loses the ring's subject.
        let payload: UsageResponse = serde_json::from_str(
            r#"{
                "limits": [{"kind": "weekly_all", "percent": 7.0, "resets_at": "2026-09-10T00:00:00Z"}],
                "five_hour": {"utilization": 73.0, "resets_at": "2026-09-07T18:00:00Z"}
            }"#,
        )
        .expect("fixture parses");

        let windows = payload.limit_windows();
        assert_eq!(windows.len(), 2);
        // Session first, whichever shape it arrived in.
        assert_eq!(windows[0].id, "session");
        assert_eq!(windows[0].label, "Current session");
        assert!((windows[0].used_fraction.unwrap() - 0.73).abs() < 1e-9);
    }

    #[test]
    fn limits_wins_over_the_named_window_for_the_same_id() {
        let payload: UsageResponse = serde_json::from_str(
            r#"{
                "limits": [{"kind": "session", "percent": 42.0, "resets_at": "2026-09-07T18:00:00Z"}],
                "five_hour": {"utilization": 73.0, "resets_at": "2026-09-07T18:00:00Z"}
            }"#,
        )
        .expect("fixture parses");

        let windows = payload.limit_windows();
        assert_eq!(windows.len(), 1);
        assert!((windows[0].used_fraction.unwrap() - 0.42).abs() < 1e-9);
    }

    #[test]
    fn fractional_seconds_parse() {
        assert!(parse_instant(Some("2026-09-07T18:00:00.123456Z")).is_some());
        assert!(parse_instant(Some("2026-09-07T18:00:00+02:00")).is_some());
        assert!(parse_instant(Some("not a date")).is_none());
    }

    #[test]
    fn unknown_kinds_get_a_readable_label() {
        assert_eq!(label_for("weekly_haiku", None), "Haiku");
        assert_eq!(label_for("session", None), "Current session");
    }

    #[test]
    fn a_scoped_window_is_labelled_with_the_model_it_covers() {
        let payload: UsageResponse = serde_json::from_str(
            r#"{
                "limits": [{
                    "kind": "weekly_scoped",
                    "percent": 0,
                    "resets_at": "2026-09-17T01:00:00Z",
                    "scope": {"model": {"id": null, "display_name": "Fable"}, "surface": null}
                }]
            }"#,
        )
        .expect("fixture parses");

        let windows = payload.limit_windows();
        assert_eq!(windows[0].label, "Fable");
        // The id stays the endpoint's, so sorting and merging still line up.
        assert_eq!(windows[0].id, "weekly_scoped");
    }

    #[test]
    fn a_scoped_window_with_nothing_to_name_falls_back_to_the_kind() {
        // `scope` is null on every window that covers everything, and the
        // endpoint has answered that way for a scoped one before now.
        assert_eq!(label_for("weekly_scoped", None), "Scoped");

        // And a name that is only whitespace is no name at all — the trim
        // lives in `scoped_to`, where the endpoint's own text is read.
        let payload: UsageResponse = serde_json::from_str(
            r#"{
                "limits": [{
                    "kind": "weekly_scoped",
                    "percent": 0,
                    "resets_at": "2026-09-17T01:00:00Z",
                    "scope": {"model": {"display_name": "   "}}
                }]
            }"#,
        )
        .expect("fixture parses");
        assert_eq!(payload.limit_windows()[0].label, "Scoped");
    }
}
