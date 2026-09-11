//! The live Claude Code sessions, read from the registry Claude Code keeps.
//!
//! Every running session writes `<config>/sessions/<pid>.json` and rewrites it
//! the moment its state changes, so "Claude just finished" is a file event
//! rather than something to poll for. The directory is watched; a slow timer
//! runs alongside purely to notice processes that died without touching the
//! directory, which no file event will ever report.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use crate::model::{Millis, Session, SessionState, SessionSurface};
use crate::sys::process::{self, ProcessTable};

pub fn sessions_dir() -> PathBuf {
    super::credentials::config_dir().join("sessions")
}

/// Read every live session, newest state change first.
///
/// Ordering is settled here rather than in the UI so the list does not
/// reshuffle between a scan and a render: sessions that want something first,
/// then the ones that are working, then the rest — and within each group, the
/// one that changed most recently.
pub fn scan(directory: &Path) -> Vec<Session> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        // No directory yet is the ordinary state on a machine where Claude
        // Code has not run since installing, not an error worth surfacing.
        return Vec::new();
    };

    let table = ProcessTable::snapshot();
    let mut sessions: Vec<Session> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .filter_map(|entry| {
            let text = std::fs::read_to_string(entry.path()).ok()?;
            let record: Record = serde_json::from_str(strip_bom(&text)).ok()?;
            record.into_session(&table)
        })
        .collect();

    sessions.sort_by(|a, b| {
        state_rank(a.state)
            .cmp(&state_rank(b.state))
            .then(b.since.cmp(&a.since))
    });
    sessions
}

/// Blocked on you outranks merely busy: it is the only state where the notch is
/// asking for something.
fn state_rank(state: SessionState) -> u8 {
    match state {
        SessionState::Waiting => 0,
        SessionState::Busy => 1,
        SessionState::Idle => 2,
    }
}

/// One entry in the session registry, as Claude Code writes it.
///
/// Decoded leniently on purpose: the file is written by another program on its
/// own release schedule, and an unknown field must never cost us a session we
/// could have shown. Every field but the pid and the working directory is
/// optional, and the two that are not are the two without which there is
/// nothing to show.
#[derive(Deserialize, Debug)]
struct Record {
    pid: u32,
    cwd: String,

    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    entrypoint: Option<String>,

    /// The raw state word. Older builds write this alone.
    #[serde(default)]
    status: Option<String>,
    /// The normalised form, when present. Preferred over `status`, because it
    /// is the field Claude Code promises to keep meaning the same thing.
    #[serde(default)]
    tempo: Option<String>,

    /// What a blocked session wants, under either of the names it has had.
    #[serde(default, rename = "waitingFor")]
    waiting_for: Option<String>,
    #[serde(default)]
    needs: Option<String>,

    #[serde(default, rename = "statusUpdatedAt")]
    status_updated_at: Option<Millis>,
    #[serde(default, rename = "updatedAt")]
    updated_at: Option<Millis>,

    /// The process creation time, so a pid that has since been recycled does
    /// not resurrect a dead session.
    ///
    /// On Windows this is a FILETIME tick count written as a decimal string;
    /// `Value` rather than a typed field because older macOS builds wrote a
    /// ctime sentence here instead, and a hard parse would drop the whole
    /// record over a field used only to rule something out.
    #[serde(default, rename = "procStart")]
    proc_start: Option<Value>,
}

impl Record {
    fn into_session(self, table: &ProcessTable) -> Option<Session> {
        if !process::is_alive(self.pid, self.proc_start_ticks()) {
            return None;
        }

        let state = self.state();
        let folder = last_segment(&self.cwd);

        Some(Session {
            id: format!("claude.{}", self.pid),
            name: self
                .name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| folder.to_string()),
            cwd: self.cwd.clone(),
            surface: SessionSurface::from_entrypoint(self.entrypoint.as_deref()),
            state,
            waiting_for: match state {
                SessionState::Waiting => self
                    .waiting_for
                    .or(self.needs)
                    .filter(|text| !text.trim().is_empty()),
                // What it *was* waiting for is not worth carrying once it has
                // stopped waiting for it.
                _ => None,
            },
            since: self
                .status_updated_at
                .or(self.updated_at)
                .unwrap_or_else(crate::model::now_millis),
            pid: self.pid,
            focusable: process::window_for(self.pid, table).is_some(),
        })
    }

    fn state(&self) -> SessionState {
        match (self.tempo.as_deref(), self.status.as_deref()) {
            (Some("blocked"), _) | (_, Some("waiting")) | (_, Some("blocked")) => {
                SessionState::Waiting
            }
            (Some("active"), _) | (_, Some("busy")) | (_, Some("active")) => SessionState::Busy,
            _ => SessionState::Idle,
        }
    }

    /// `procStart` as FILETIME ticks, when it is written in the form Windows
    /// Claude Code uses.
    fn proc_start_ticks(&self) -> Option<u64> {
        match self.proc_start.as_ref()? {
            Value::String(text) => text.parse().ok(),
            Value::Number(number) => number.as_u64(),
            _ => None,
        }
    }
}

/// Drop a UTF-8 byte-order mark, which `serde_json` will not parse past.
///
/// Claude Code writes these files from Node and never emits one, but anything
/// that rewrites a session file on Windows might — PowerShell's `Set-Content
/// -Encoding utf8` does, and so do several editors. Three bytes of preamble
/// must not be the reason a live session vanishes from the notch: that failure
/// is invisible, and it looks exactly like the session having ended.
fn strip_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

fn last_segment(path: &str) -> &str {
    path.rsplit(['\\', '/'])
        .find(|segment| !segment.is_empty())
        .unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(json: &str) -> Record {
        serde_json::from_str(json).expect("fixture parses")
    }

    #[test]
    fn the_live_windows_shape_parses() {
        // Taken verbatim from a running session, minus the fields nothing reads.
        let parsed = record(
            r#"{"pid":19380,"sessionId":"ce4c2779","cwd":"C:\\Users\\you\\Desktop\\notes-app",
                "startedAt":1788798491516,"procStart":"134332720904244584","version":"2.1.263",
                "kind":"interactive","entrypoint":"cli","pidDomain":"win32:desktop-b5b8k3s",
                "name":"notes-app-b6","nameSource":"derived","status":"busy",
                "updatedAt":1788798817371,"statusUpdatedAt":1788798817371}"#,
        );

        assert_eq!(parsed.pid, 19380);
        assert_eq!(parsed.state(), SessionState::Busy);
        assert_eq!(parsed.proc_start_ticks(), Some(134_332_720_904_244_584));
        assert_eq!(
            SessionSurface::from_entrypoint(parsed.entrypoint.as_deref()),
            SessionSurface::Terminal
        );
    }

    #[test]
    fn tempo_is_preferred_over_the_raw_status_word() {
        let parsed = record(r#"{"pid":1,"cwd":"C:\\x","tempo":"blocked","status":"busy"}"#);
        assert_eq!(parsed.state(), SessionState::Waiting);
    }

    #[test]
    fn an_unknown_status_is_idle_rather_than_dropped() {
        let parsed = record(r#"{"pid":1,"cwd":"C:\\x","status":"contemplating"}"#);
        assert_eq!(parsed.state(), SessionState::Idle);
    }

    #[test]
    fn a_byte_order_mark_never_costs_a_session() {
        // Found the hard way: a session file rewritten by PowerShell arrives
        // with EF BB BF in front of it, `serde_json` refuses the whole thing,
        // and the session simply disappears — indistinguishable from it having
        // ended.
        let with_bom = "\u{feff}{\"pid\":1,\"cwd\":\"C:\\\\x\",\"status\":\"busy\"}";
        assert!(serde_json::from_str::<Record>(with_bom).is_err());
        let parsed: Record =
            serde_json::from_str(strip_bom(with_bom)).expect("the mark is stripped");
        assert_eq!(parsed.state(), SessionState::Busy);
    }

    #[test]
    fn unknown_fields_never_cost_a_session() {
        let parsed = record(r#"{"pid":1,"cwd":"C:\\x","somethingNew":{"a":[1,2]}}"#);
        assert_eq!(parsed.pid, 1);
    }

    #[test]
    fn a_ctime_proc_start_is_ignored_rather_than_fatal() {
        // What older macOS builds wrote. Unparseable as ticks, which must fall
        // back to trusting the pid instead of dropping the record.
        let parsed = record(r#"{"pid":1,"cwd":"C:\\x","procStart":"Fri Aug 28 05:15:20 2026"}"#);
        assert_eq!(parsed.proc_start_ticks(), None);
    }

    #[test]
    fn a_nameless_session_is_called_after_its_folder() {
        let parsed = record(r#"{"pid":1,"cwd":"C:\\Users\\you\\Desktop\\notes-app"}"#);
        let table = ProcessTable::snapshot();
        // Use our own pid so the liveness check passes.
        let parsed = Record {
            pid: std::process::id(),
            proc_start: None,
            ..parsed
        };
        let session = parsed.into_session(&table).expect("our own process is alive");
        assert_eq!(session.name, "notes-app");
    }

    #[test]
    fn a_dead_pid_is_not_reported() {
        // A session file left behind by a crash says `busy` for ever.
        let parsed = record(r#"{"pid":4294967294,"cwd":"C:\\x","status":"busy"}"#);
        assert!(parsed.into_session(&ProcessTable::snapshot()).is_none());
    }

    #[test]
    fn waiting_sessions_lead_the_list() {
        let mut sessions = [
            Session {
                id: "a".into(),
                name: "a".into(),
                cwd: "C:\\a".into(),
                surface: SessionSurface::Terminal,
                state: SessionState::Idle,
                waiting_for: None,
                since: 300,
                pid: 1,
                focusable: false,
            },
            Session {
                id: "b".into(),
                name: "b".into(),
                cwd: "C:\\b".into(),
                surface: SessionSurface::Terminal,
                state: SessionState::Waiting,
                waiting_for: None,
                since: 100,
                pid: 2,
                focusable: false,
            },
        ];
        sessions.sort_by(|a, b| {
            state_rank(a.state)
                .cmp(&state_rank(b.state))
                .then(b.since.cmp(&a.since))
        });
        assert_eq!(sessions[0].id, "b");
    }
}
