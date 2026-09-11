import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Placement, Preferences, Session, UsageSnapshot } from "./types";

/**
 * Typed wrappers around the commands `src-tauri/src/commands.rs` exposes.
 *
 * Thin on purpose: the point is that every `invoke` name and payload shape
 * appears exactly once, so renaming a command breaks the build here rather
 * than at runtime in a window with no console attached.
 */
export const api = {
  usage: () => invoke<UsageSnapshot>("get_usage"),
  sessions: () => invoke<Session[]>("get_sessions"),
  preferences: () => invoke<Preferences>("get_preferences"),
  placement: () => invoke<Placement>("get_placement"),

  /** Ask for a fetch now, ignoring the poll timer but not the back-off. */
  refreshUsage: () => invoke<void>("refresh_usage"),

  savePreferences: (preferences: Preferences) =>
    invoke<Preferences>("save_preferences", { preferences }),

  /**
   * Bring the window that owns this session's terminal to the front.
   * Resolves false when no window could be found — a session started from a
   * detached process has none.
   */
  focusSession: (pid: number) => invoke<boolean>("focus_session", { pid }),

  /** Tell the Rust side how tall the chrome currently is, so the pointer
   *  hot zone matches what is actually drawn. */
  reportChrome: (width: number, height: number, centerY: number) =>
    invoke<void>("report_chrome", { width, height, centerY }),

  quit: () => invoke<void>("quit_app"),
};

/** Events the Rust side pushes. Each returns its own unlisten function. */
export const events = {
  onUsage: (fn: (snapshot: UsageSnapshot) => void): Promise<UnlistenFn> =>
    listen<UsageSnapshot>("nook://usage", (e) => fn(e.payload)),

  onSessions: (fn: (sessions: Session[]) => void): Promise<UnlistenFn> =>
    listen<Session[]>("nook://sessions", (e) => fn(e.payload)),

  /**
   * The pointer entering or leaving the notch's hot zone.
   *
   * Reported by Rust rather than by the DOM because the window is click-through
   * everywhere the chrome is not: with `ignore_cursor_events` on, the webview
   * never sees a pointer at all, so it cannot be the thing that notices one
   * arriving. Rust polls the cursor, opens the window to events when it lands
   * in the zone, and closes it again when it leaves.
   */
  onPointer: (fn: (inside: boolean) => void): Promise<UnlistenFn> =>
    listen<boolean>("nook://pointer", (e) => fn(e.payload)),

  /** The global chord was pressed: open, and stay open until dismissed. */
  onToggle: (fn: () => void): Promise<UnlistenFn> =>
    listen<null>("nook://toggle", () => fn()),

  onPreferences: (fn: (preferences: Preferences) => void): Promise<UnlistenFn> =>
    listen<Preferences>("nook://preferences", (e) => fn(e.payload)),

  onPlacement: (fn: (placement: Placement) => void): Promise<UnlistenFn> =>
    listen<Placement>("nook://placement", (e) => fn(e.payload)),
};
