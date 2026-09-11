import { describe, expect, it } from "vitest";

import { headlineOf, readingNote, statusMessage } from "./status";
import type { LimitWindow, UsageSnapshot } from "~/ipc/types";

const NOW = 1_700_000_000_000;

const window = (id: string, usedFraction: number | null = 0.4): LimitWindow => ({
  id,
  label: id,
  usedFraction,
  resetsAt: null,
});

const snapshot = (over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  status: { kind: "ok" },
  windows: [window("session"), window("weekly_all")],
  headlineId: "session",
  plan: "max",
  fetchedAt: NOW,
  ...over,
});

describe("headlineOf", () => {
  it("takes the window the provider declared, not the first one", () => {
    // Picking by position means a window dropping out of the response silently
    // promotes another: the ring keeps its shape and changes its subject.
    const usage = snapshot({ headlineId: "weekly_all" });
    expect(headlineOf(usage)?.id).toBe("weekly_all");
  });

  it("shows nothing rather than promoting a different window", () => {
    // A blank is honest; a weekly percentage wearing the session's place is not.
    const usage = snapshot({ headlineId: "session", windows: [window("weekly_all")] });
    expect(headlineOf(usage)).toBeUndefined();
  });
});

describe("readingNote", () => {
  it("shows the plan while the reading is current", () => {
    expect(readingNote(snapshot(), NOW)).toBe("Max");
  });

  it("does not announce the age of a reading seconds old", () => {
    // The defect this guards: a failed fetch marks the snapshot stale at once,
    // so a reading taken twenty seconds ago replaced the plan name with "just
    // now" — a line that says nothing a live reading would not also say.
    const fresh = snapshot({ status: { kind: "stale", since: NOW - 20_000 } });
    expect(readingNote(fresh, NOW)).toBe("Max");
  });

  it("dates a reading once it is genuinely old", () => {
    const old = snapshot({ status: { kind: "stale", since: NOW - 20 * 60_000 } });
    expect(readingNote(old, NOW)).toBe("20 min ago");
  });

  it("says nothing at all when there is no reading behind it", () => {
    expect(readingNote(snapshot({ windows: [] }), NOW)).toBeNull();
  });
});

describe("statusMessage", () => {
  it("stays quiet while there is a number to look at", () => {
    // A reading the user can act on outranks an explanation of why the last
    // fetch failed.
    const stale = snapshot({ status: { kind: "stale", since: NOW - 60_000 } });
    expect(statusMessage(stale, NOW)).toBeNull();
  });

  it("names the command when nothing is signed in", () => {
    const none = snapshot({ windows: [], status: { kind: "needsAuth" } });
    expect(statusMessage(none, NOW)).toContain("claude");
  });

  it("distinguishes a stale token from being signed out", () => {
    // They need different answers: one wants Claude Code run once, the other
    // wants a sign-in. Telling someone who *is* signed in to sign in sends
    // them to fix the wrong thing.
    const expired = snapshot({ windows: [], status: { kind: "credentialExpired" } });
    const message = statusMessage(expired, NOW) ?? "";
    expect(message).toContain("refresh");
    expect(message).not.toContain("sign in");
  });

  it("counts down a rate limit in minutes", () => {
    const limited = snapshot({
      windows: [],
      status: { kind: "rateLimited", until: NOW + 5 * 60_000 },
    });
    expect(statusMessage(limited, NOW)).toContain("5 min");
  });
});
