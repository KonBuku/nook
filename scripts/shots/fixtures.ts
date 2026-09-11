import type { Session, UsageSnapshot } from "~/ipc/types";

/**
 * The readings and sessions the README's screenshots are taken of.
 *
 * Invented, and deliberately so. A real capture would put whoever took it on
 * display — their projects, their folder names, how much of their limit they
 * had spent that afternoon — in an image that then never changes again. These
 * are made up, stable, and chosen to show each state the UI actually has:
 * every screenshot in `docs/images` is this file rendered by the real
 * components, so what they show is the real layout with numbers that belong to
 * nobody.
 */

/** A fixed instant, so every capture is byte-identical to the last one. */
export const NOW = Date.UTC(2026, 2, 17, 14, 9, 0);

const minutes = (n: number) => NOW + n * 60_000;
const hours = (n: number) => NOW + n * 3_600_000;

export const usage: UsageSnapshot = {
  status: { kind: "ok" },
  windows: [
    {
      id: "session",
      label: "Current session",
      usedFraction: 0.38,
      resetsAt: hours(2.4),
    },
    {
      id: "weekly_all",
      label: "All models",
      usedFraction: 0.64,
      resetsAt: hours(79),
    },
    {
      id: "weekly_scoped",
      label: "Opus",
      usedFraction: 0.12,
      resetsAt: hours(79),
    },
  ],
  headlineId: "session",
  plan: "max",
  fetchedAt: minutes(-1),
};

/** One session in each state the list can show. */
export const sessions: Session[] = [
  {
    id: "1",
    name: "api-gateway",
    cwd: "C:\\src\\api-gateway",
    surface: "terminal",
    state: "busy",
    waitingFor: null,
    since: minutes(-4),
    pid: 11204,
    focusable: true,
  },
  {
    id: "2",
    name: "checkout-flow",
    cwd: "C:\\src\\storefront\\checkout",
    surface: "vscode",
    state: "waiting",
    waitingFor: "Run the migration?",
    since: minutes(-1),
    pid: 24880,
    focusable: true,
  },
  {
    id: "3",
    name: "release-notes",
    cwd: "C:\\src\\release-notes",
    surface: "terminal",
    state: "idle",
    waitingFor: null,
    since: minutes(-1),
    pid: 30612,
    focusable: true,
  },
  {
    id: "4",
    name: "infra-scripts",
    cwd: "C:\\src\\infra",
    surface: "desktop",
    state: "idle",
    waitingFor: null,
    since: hours(-2) - 19 * 60_000,
    pid: 8340,
    focusable: false,
  },
];

/** The one that has just finished — white, for half a minute. */
export const justFinished: ReadonlySet<string> = new Set(["3"]);

/**
 * What the resting notch is captured over.
 *
 * Nothing working and nothing blocked, so the ring shows the reading rather
 * than the activity arc drawn over it — the closed shot is there to say how
 * little of the screen the thing takes, and a pulsing amber ring would be
 * answering a different question.
 */
export const quietSessions: Session[] = sessions.filter(
  (session) => session.state === "idle",
);
