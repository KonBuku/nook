//! Claude Code's own OAuth credential, read where Claude Code puts it.
//!
//! On macOS this lives in the login keychain, which is why Codenotch has a
//! whole cache built around not triggering an access prompt on every poll. On
//! Windows it is a plain file — `%USERPROFILE%\.claude\.credentials.json` —
//! so the equivalent here is much smaller: re-read it only when its
//! modification time has actually moved.
//!
//! Nook never signs in and never writes this file. Claude Code owns the
//! credential; Nook borrows the token to ask about its own usage.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use serde::Deserialize;

use crate::model::Millis;

#[derive(Clone, Debug, PartialEq)]
pub struct Credentials {
    pub access_token: String,
    /// When the access token stops being accepted.
    pub expires_at: Millis,
    /// "max", "pro" — whatever the credential says the plan is.
    pub subscription_type: Option<String>,
}

impl Credentials {
    pub fn is_expired(&self) -> bool {
        // A minute of slack: a token that expires while a request is in flight
        // is worth re-reading rather than spending on a 401.
        self.expires_at <= crate::model::now_millis() + 60_000
    }
}

#[derive(Deserialize)]
struct CredentialsFile {
    #[serde(rename = "claudeAiOauth")]
    oauth: Option<OAuth>,
}

#[derive(Deserialize)]
struct OAuth {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "expiresAt")]
    expires_at: Option<Millis>,
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
}

/// Claude Code's configuration directory.
///
/// `CLAUDE_CONFIG_DIR` is honoured because Claude Code honours it: someone
/// keeping a work login apart with `CLAUDE_CONFIG_DIR=~/.claude-work claude`
/// has their sessions and their token in there, and reading `~/.claude` would
/// report on an account they are not using.
pub fn config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        let path = PathBuf::from(dir);
        if !path.as_os_str().is_empty() {
            return path;
        }
    }
    dirs::home_dir().unwrap_or_default().join(".claude")
}

pub fn credentials_path() -> PathBuf {
    config_dir().join(".credentials.json")
}

/// Holds the last credential read, and the file's modification time when it was
/// read, so a poll that changes nothing costs one `stat` instead of a parse.
#[derive(Default)]
pub struct CredentialStore {
    cached: Mutex<Option<(SystemTime, Credentials)>>,
}

impl CredentialStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// The current credential, or an error saying which of the two things is
    /// wrong: there is no file, or the file has nothing usable in it.
    pub fn load(&self) -> Result<Credentials> {
        let path = credentials_path();
        let modified = modified_at(&path);

        if let (Some(modified), Some((seen, credentials))) = (modified, self.cached.lock().clone()) {
            if seen == modified {
                return Ok(credentials);
            }
        }

        let credentials = read(&path)?;
        if let Some(modified) = modified {
            *self.cached.lock() = Some((modified, credentials.clone()));
        }
        Ok(credentials)
    }

    /// Drop the held copy, so the next `load` goes back to the file.
    ///
    /// Called when the endpoint rejects a token that had not expired — which is
    /// what signing into a different account looks like from here.
    pub fn forget(&self) {
        *self.cached.lock() = None;
    }
}

fn read(path: &Path) -> Result<Credentials> {
    let text = fs::read_to_string(path)
        .with_context(|| format!("no Claude credential at {}", path.display()))?;
    let parsed: CredentialsFile =
        serde_json::from_str(&text).context("Claude's credential file is not the shape we expect")?;
    let oauth = parsed
        .oauth
        .context("Claude's credential file has no claudeAiOauth entry")?;

    Ok(Credentials {
        access_token: oauth.access_token,
        // Absent is treated as long-lived rather than as expired: a missing
        // field must never be what stops a working token being used.
        expires_at: oauth.expires_at.unwrap_or(Millis::MAX),
        subscription_type: oauth.subscription_type,
    })
}

fn modified_at(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).ok()?.modified().ok()
}
