import { useEffect, useRef, useState } from "react";

import type { Session, SessionState } from "~/ipc/types";
import { Palette } from "~/design/palette";

/**
 * The state of every live session, reduced to the one thing worth knowing at a
 * glance — which is all the closed notch has room to say.
 */
export type ActivityState = "working" | "waiting" | "idle";

/**
 * Anything blocked on you outranks anything merely busy: it is the only state
 * where the notch is asking for something.
 */
export function activityOf(sessions: Session[]): ActivityState {
  if (sessions.some((session) => session.state === "waiting")) return "waiting";
  if (sessions.some((session) => session.state === "busy")) return "working";
  return "idle";
}

/** What a session's row calls its state. */
export function stateWord(state: SessionState, justFinished: boolean): string {
  switch (state) {
    case "busy":
      return "working";
    case "waiting":
      return "waiting";
    case "idle":
      // "done" rather than "idle" for the first moment after a turn ends: the
      // question being answered is "has it finished?", and for the few seconds
      // when that is news, the row should say so.
      return justFinished ? "done" : "ready";
  }
}

/**
 * What colour a state is drawn in.
 *
 * Working takes Claude's own colour rather than a green, because that is what
 * the terminal two inches away is already using for the same mark — the notch
 * saying it in a different colour would read as a different thing happening.
 *
 * Waiting keeps the amber, which is the one state that wants something from
 * you. Finished goes quiet: white for the half-minute where "it just finished"
 * is news, then grey once it is merely true.
 */
export function stateColor(state: SessionState, justFinished: boolean): string {
  switch (state) {
    case "busy":
      return Palette.claude;
    case "waiting":
      return Palette.watch;
    case "idle":
      return justFinished ? Palette.textPrimary : Palette.textSecondary;
  }
}

/**
 * The same choice for the closed notch's chip, which speaks for every session
 * at once. Quoted from `stateColor` rather than repeated, so the mark under the
 * ring and the marks in the list can never disagree.
 */
export function activityColor(activity: ActivityState): string {
  switch (activity) {
    case "working":
      return stateColor("busy", false);
    case "waiting":
      return stateColor("waiting", false);
    case "idle":
      return stateColor("idle", false);
  }
}

/** The session state a whole-notch activity reads as. */
export function activityAsState(activity: ActivityState): SessionState {
  switch (activity) {
    case "working":
      return "busy";
    case "waiting":
      return "waiting";
    case "idle":
      return "idle";
  }
}

/** How long a finished session stays marked as freshly finished. */
const FINISHED_WINDOW_MS = 30_000;

/**
 * Which sessions have just stopped working.
 *
 * The registry says what a session *is*, never what it just *was*, so a turn
 * ending looks exactly like a session that has been sitting idle for an hour.
 * Watching the transition here is the only place that difference exists — and
 * it is the difference between a list you have to read and one that tells you
 * something happened.
 */
export function useJustFinished(sessions: Session[]): ReadonlySet<string> {
  const previous = useRef(new Map<string, SessionState>());
  const [finished, setFinished] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const before = previous.current;
    const nowFinished = sessions
      .filter((session) => session.state === "idle" && before.get(session.id) === "busy")
      .map((session) => session.id);

    previous.current = new Map(sessions.map((session) => [session.id, session.state]));

    if (nowFinished.length === 0) return;

    setFinished((current) => new Set([...current, ...nowFinished]));

    // Each session clears on its own timer rather than the set clearing as a
    // batch: two sessions finishing a few seconds apart should each get their
    // own moment, not share whichever timer happened to be running.
    const timers = nowFinished.map((id) =>
      window.setTimeout(() => {
        setFinished((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, FINISHED_WINDOW_MS),
    );

    return () => timers.forEach(window.clearTimeout);
  }, [sessions]);

  return finished;
}
