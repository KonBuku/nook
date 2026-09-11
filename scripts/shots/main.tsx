/**
 * The page the README's screenshots are taken of.
 *
 * It renders the real components — `NotchShell`, the real content layouts, the
 * real `useShapes` — against `fixtures.ts`, so a screenshot is the shipping
 * layout rather than a drawing of it. Nothing here is imported by the app; it
 * is a second Vite entry (`shots.html`) that the production build never sees.
 *
 * Each scene is one URL: `/shots.html?scene=panel`. `scripts/shots/README.md`
 * says how they are captured.
 */
import { MotionConfig, MotionGlobalConfig } from "motion/react";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { useShapes } from "~/app/App";
import { Layout } from "~/design/layout";
import { activityOf } from "~/features/sessions/activity";
import { SessionList } from "~/features/sessions/SessionList";
import { ClosedContent, OpenContent, type ContentProps } from "~/notch/NotchContent";
import { NotchShell } from "~/notch/NotchShell";
import { RingSlot } from "~/notch/RingSlot";
import { headlineOf } from "~/features/usage/status";
import type { Session } from "~/ipc/types";

import { NOW, justFinished, quietSessions, sessions, usage } from "./fixtures";
import "~/styles.css";
import "./shots.css";

/** The slab the notch would be drawn in, in CSS pixels. Mirrors placement.rs. */
const WINDOW_HEIGHT = 560;

function Notch({
  open,
  sessionList,
  resting = "ring",
}: {
  open: boolean;
  sessionList: Session[];
  resting?: "ring" | "pill";
}) {
  const shapes = useShapes({
    usage,
    sessionCount: sessionList.length,
    hasStatusLine: false,
    resting,
    anchorY: WINDOW_HEIGHT / 2,
    windowHeight: WINDOW_HEIGHT,
  });

  const content: ContentProps = {
    usage,
    sessions: sessionList,
    justFinished,
    now: NOW,
    isRefreshing: false,
    sessionListHeight: shapes.sessionListHeight,
    onRefresh: () => {},
    onOpenSession: () => {},
  };

  return (
    <NotchShell
      shape={open ? shapes.open : shapes.closed}
      isOpen={open}
      closedSize={shapes.closed}
      openSize={shapes.open}
      closed={resting === "pill" ? null : <ClosedContent {...content} />}
      open={<OpenContent {...content} />}
      ring={
        <RingSlot
          isOpen={open}
          resting={resting}
          usedFraction={headlineOf(usage)?.usedFraction ?? null}
          activity={activityOf(sessionList)}
          isStale={false}
          isRefreshing={false}
          onRefresh={() => {}}
        />
      }
    />
  );
}

/**
 * The notch pinned to the left edge, the way the screen has it.
 *
 * The slab the notch is drawn in is taller than any of these captures, and the
 * shape is placed inside it by `centerY` — so the slab is held at its real
 * height and centred in the frame. Shrinking it instead would move the flares,
 * which are the part that says the thing is attached to the screen's edge.
 */
function Edge({ children }: { children: ReactNode }) {
  return (
    <div className="edge" style={{ height: WINDOW_HEIGHT }}>
      {children}
    </div>
  );
}

/**
 * The four session states, on a plate of the panel's own surface.
 *
 * The real `SessionList` rather than four loose rows: the list is what holds
 * the row's radius, bleed and padding, and rows rendered outside it are rows
 * with none of that — a different shape from the one that ships.
 */
function States() {
  return (
    <div className="states" style={{ width: Layout.panelWidth, padding: Layout.panelPadding }}>
      <SessionList
        sessions={sessions}
        justFinished={justFinished}
        now={NOW}
        maxHeight={9999}
        onOpen={() => {}}
      />
    </div>
  );
}

const scenes = {
  panel: () => (
    <Edge>
      <Notch open sessionList={sessions} />
    </Edge>
  ),
  closed: () => (
    <Edge>
      <Notch open={false} sessionList={quietSessions} />
    </Edge>
  ),
  pill: () => (
    <Edge>
      <Notch open={false} sessionList={quietSessions} resting="pill" />
    </Edge>
  ),
  states: () => <States />,
};

type SceneName = keyof typeof scenes;

const asked = new URLSearchParams(location.search).get("scene") ?? "";
const which: SceneName = asked in scenes ? (asked as SceneName) : "panel";
const Scene = scenes[which];

document.body.dataset.scene = which;

// Land every animation on its final value immediately.
//
// `MotionConfig`'s transition below is only a *default*: a component that
// names its own — the ring's progress arc does, and so does its refresh
// squash — keeps it, and a spring still settling when the shutter opens is
// what made two runs of this produce two different pictures of the same ring.
MotionGlobalConfig.skipAnimations = true;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/*
      Every capture has to be the same bytes as the last one, or re-taking a
      screenshot after a UI change is a new photograph rather than a diff. Two
      things move on their own here: Motion's enter transitions, and the
      spinner. `duration: 0` lands every transition on its final value in the
      first frame, and `reducedMotion` is the switch the components already
      have for "hold a mark rather than play one" — so what is captured is the
      app's own still state, not a rig pretending to be it.
    */}
    <MotionConfig reducedMotion="always" transition={{ duration: 0 }}>
      <Scene />
    </MotionConfig>
  </StrictMode>,
);
