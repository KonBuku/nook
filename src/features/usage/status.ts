import { agoText } from "~/features/copy";
import type { LimitWindow, UsageSnapshot, UsageStatus } from "~/ipc/types";

/**
 * The headline reading: the window the ring means.
 *
 * Declared by the provider rather than left to position, and deliberately
 * not the most-constrained window. Picking whichever limit is highest means
 * the headline silently changes meaning — session one minute, weekly the
 * next — and disagrees with Claude's own panel, which always leads with the
 * session.
 */
export function headlineOf(usage: UsageSnapshot): LimitWindow | undefined {
  const id = usage.headlineId;
  return id ? usage.windows.find((window) => window.id === id) : usage.windows[0];
}

/**
 * What the panel says instead of limit rows when there is nothing to show.
 *
 * Null when there *is* a reading: a number the user can act on outranks an
 * explanation of why the last fetch failed, and the age note beside the title
 * already says the number is not live.
 */
export function statusMessage(snapshot: UsageSnapshot, now: number): string | null {
  if (snapshot.windows.length > 0) return null;

  switch (snapshot.status.kind) {
    case "needsAuth":
      // Names the command, because that is the only way to fix it — there is
      // no sign-in for Nook to offer, and telling someone to "sign in" without
      // saying where sends them to the website instead of the CLI.
      return "Run `claude` once to sign in. Nook reads the token Claude Code saves.";

    case "credentialExpired":
      // Says what happened and what fixes it. "Sign in" would send someone who
      // *is* signed in to fix the wrong thing: the token is simply old, and
      // Claude Code refreshes it whenever it next runs.
      return "Claude's saved token is stale. Run Claude Code once and it refreshes itself.";

    case "rateLimited": {
      const minutes = Math.max(1, Math.round((snapshot.status.until - now) / 60_000));
      return `Asked too often. Trying again in ${minutes} min.`;
    }

    case "error":
      return `Couldn't read usage — ${snapshot.status.message}`;

    case "ok":
    case "stale":
      return "Waiting for the first reading…";
  }
}

/**
 * How old a reading has to be before its age is worth saying.
 *
 * Longer than the active poll interval, deliberately. A fetch that fails is
 * marked stale immediately, so a reading seconds old was being announced as
 * "just now" — which displaces the plan name with a line that says nothing a
 * live reading would not also say. Past this it genuinely is old news.
 */
const WORTH_DATING_MS = 90_000;

/**
 * The note beside the panel's title: the plan, or the reading's age once it is
 * old enough to matter.
 *
 * A remembered reading has to be dated, or it quietly passes itself off as
 * live — but a reading taken half a minute ago *is* live, whatever the status
 * says about the fetch that came after it.
 */
export function readingNote(snapshot: UsageSnapshot, now: number): string | null {
  if (snapshot.windows.length === 0) return null;

  const since = staleSince(snapshot.status);
  if (since !== null && now - since >= WORTH_DATING_MS) {
    return agoText(new Date(since), new Date(now));
  }
  return snapshot.plan ? capitalise(snapshot.plan) : null;
}

function staleSince(status: UsageStatus): number | null {
  return status.kind === "stale" ? status.since : null;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
