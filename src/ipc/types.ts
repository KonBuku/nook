/**
 * The shapes the Rust side serialises. Kept in one file and mirrored field for
 * field against `src-tauri/src/model.rs`, so a change on either side is a
 * compile error rather than an empty panel.
 *
 * Instants cross the boundary as milliseconds since the Unix epoch: a number
 * survives JSON without a timezone to argue about, and `new Date(ms)` is the
 * only conversion needed on this side.
 */

export type UsageStatus =
  | { kind: "ok" }
  /** The last good reading, kept across a failure. `since` is when it was taken. */
  | { kind: "stale"; since: number }
  /** No credential at all — Claude Code has never signed in here. */
  | { kind: "needsAuth" }
  /**
   * A credential that exists but has expired. Not the same as signed out:
   * Claude Code rotates this token whenever it runs, so the honest thing is to
   * say the reading is old rather than demand a sign-in that isn't needed.
   */
  | { kind: "credentialExpired" }
  /** Backing off after a 429. `until` is when the next attempt is allowed. */
  | { kind: "rateLimited"; until: number }
  | { kind: "error"; message: string };

/** One metered window. Claude exposes the rolling session and the weeklies. */
export interface LimitWindow {
  id: string;
  label: string;
  /** 0…1+, where 1 means the limit is spent. */
  usedFraction: number | null;
  /** Null when the vendor does not say when the window rolls over. */
  resetsAt: number | null;
}

export interface UsageSnapshot {
  status: UsageStatus;
  windows: LimitWindow[];
  /**
   * Which window the ring means, declared rather than left to position.
   * Without it the headline is "whichever window happens to be first", and a
   * window dropping out of the response silently promotes another one — the
   * ring keeps its shape and quietly changes its subject.
   */
  headlineId: string | null;
  /** The plan on the credential — "max", "pro". Shown under the title. */
  plan: string | null;
  /** When these numbers were fetched. */
  fetchedAt: number | null;
}

export type SessionState = "busy" | "waiting" | "idle";

/** Where a session is running, as Claude Code's `entrypoint` reports it. */
export type SessionSurface = "terminal" | "vscode" | "desktop" | "agent";

export interface Session {
  /** Stable across polls: the pid plus the session's own id. */
  id: string;
  /** What to call it — Claude Code's derived name, or the folder. */
  name: string;
  /** The working directory, in full. Shown shortened. */
  cwd: string;
  surface: SessionSurface;
  state: SessionState;
  /** Set while `waiting`: what it wants from you. */
  waitingFor: string | null;
  /** When it entered its current state. */
  since: number;
  pid: number;
  /** True when a terminal window for this session could be found. */
  focusable: boolean;
}

export interface Preferences {
  /**
   * Where the notch sits down the working area, 0 at the top and 1 at the
   * bottom. The default puts it in the lower third — near the taskbar corner
   * without being swallowed by it.
   */
  anchorFraction: number;
  /** Fold to a slim pill when the pointer is away, or keep the ring showing. */
  restingStyle: "ring" | "pill";
  /** Launch with Windows. */
  autostart: boolean;
  /** Chord that opens the notch from anywhere. Empty disables it. */
  hotkey: string;
  /** Seconds between usage polls while at least one session is busy. */
  activePollSeconds: number;
  /** Seconds between usage polls while nothing is running. */
  idlePollSeconds: number;
}

/** Where the notch is on screen, worked out by the Rust side. */
export interface Placement {
  /** Distance from the window's top to the notch's vertical centre. */
  anchorY: number;
  /** The window's own size, in CSS pixels. */
  windowHeight: number;
  windowWidth: number;
}
