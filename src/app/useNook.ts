import { useEffect, useState } from "react";

import { api, events } from "~/ipc/bindings";
import type { Placement, Preferences, Session, UsageSnapshot } from "~/ipc/types";

export interface NookState {
  usage: UsageSnapshot;
  sessions: Session[];
  preferences: Preferences | null;
  placement: Placement | null;
  /** Rung when the global chord is pressed or the tray icon is clicked. */
  toggleSignal: number;
}

const EMPTY_USAGE: UsageSnapshot = {
  status: { kind: "ok" },
  windows: [],
  headlineId: "session",
  plan: null,
  fetchedAt: null,
};

/**
 * Everything the Rust side knows, kept current.
 *
 * Each value is fetched once at mount and then pushed: the backend emits only
 * when something actually changed, so there is nothing here that polls and
 * nothing that re-renders on a timer it did not need.
 */
export function useNook(): NookState {
  const [usage, setUsage] = useState<UsageSnapshot>(EMPTY_USAGE);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [toggleSignal, setToggleSignal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // The first paint should be the real reading, not an empty ring that fills
    // in a moment later — the backend already holds the last one it cached.
    void Promise.all([
      api.usage(),
      api.sessions(),
      api.preferences(),
      api.placement(),
    ]).then(([usage, sessions, preferences, placement]) => {
      if (cancelled) return;
      setUsage(usage);
      setSessions(sessions);
      setPreferences(preferences);
      setPlacement(placement);
    });

    const subscriptions = [
      events.onUsage(setUsage),
      events.onSessions(setSessions),
      events.onPreferences(setPreferences),
      events.onPlacement(setPlacement),
      events.onToggle(() => setToggleSignal((n) => n + 1)),
    ];

    return () => {
      cancelled = true;
      // Each listener is a promise for its own unlisten function; awaiting them
      // here would leave the window listening for however long the round trip
      // takes after unmount.
      subscriptions.forEach((pending) => void pending.then((off) => off()));
    };
  }, []);

  return { usage, sessions, preferences, placement, toggleSignal };
}

/**
 * A clock, for the copy that ages: "51 min", "2 hr ago".
 *
 * One second while the notch is open, and stopped when it is closed — a closed
 * notch shows no elapsed time, so a tick there is a re-render for nothing.
 */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return now;
}

/**
 * The pointer entering and leaving the notch's hot zone.
 *
 * Comes from Rust, not the DOM: the window is click-through everywhere the
 * chrome is not, and with `ignore_cursor_events` on the page never sees a
 * pointer at all — so it cannot be the thing that notices one arriving.
 */
export function usePointerInside(): boolean {
  const [inside, setInside] = useState(false);

  useEffect(() => {
    const subscription = events.onPointer(setInside);
    return () => void subscription.then((off) => off());
  }, []);

  return inside;
}
