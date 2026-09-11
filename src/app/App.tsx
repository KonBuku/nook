import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Layout,
  closedLength,
  flareInset,
  panelHeaderHeight,
  sessionDividerHeight,
  sessionsHeight,
  shapeLength,
} from "~/design/layout";
import { UNFOLD_SECONDS } from "~/design/motion";
import { useJustFinished } from "~/features/sessions/activity";
import { headlineOf, statusMessage } from "~/features/usage/status";
import { api } from "~/ipc/bindings";
import type { Session } from "~/ipc/types";
import { ClosedContent, OpenContent, type ContentProps } from "~/notch/NotchContent";
import { RingSlot } from "~/notch/RingSlot";
import { activityOf } from "~/features/sessions/activity";
import { NotchShell, type Shape } from "~/notch/NotchShell";
import { useNook, useNow, usePointerInside } from "./useNook";

/** Clear space between the panel and the top or bottom of the window. */
const EDGE_MARGIN = 10;

export function App() {
  const { usage, sessions, preferences, placement, toggleSignal } = useNook();
  const pointerInside = usePointerInside();
  const [pinned, setPinned] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);

  const isOpen = pointerInside || pinned;
  const now = useNow(isOpen);
  const justFinished = useJustFinished(sessions);

  useHotkeyToggle(toggleSignal, pointerInside, pinned, setPinned);

  // Zero rather than a fallback: `useShapes` still has to be called before the
  // early return below, and the numbers it produces from these are discarded.
  const anchorY = placement?.anchorY ?? 0;
  const windowHeight = placement?.windowHeight ?? 0;

  // Nothing at all until the Rust side has said where the window is.
  //
  // Drawn before that, the notch's first frame lands at the top of the window
  // and its spring then slides it down the screen — a visible fall on every
  // launch. `windowHeight` is checked rather than just `placement` because a
  // machine with no monitor to place against reports zeroes rather than
  // nothing, and zero is a shape with no room in it.
  const ready = placement !== null && placement.windowHeight > 0;

  const resting = preferences?.restingStyle ?? "ring";

  const shapes = useShapes({
    usage,
    sessionCount: sessions.length,
    hasStatusLine: statusMessage(usage, now) !== null,
    resting,
    anchorY,
    windowHeight,
  });

  const shape = isOpen ? shapes.open : shapes.closed;
  useReportChrome(shape, isOpen, ready);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void api.refreshUsage().finally(() => {
      // Held briefly even when the answer is instant: a press that releases in
      // the same frame reads as a click that did nothing.
      window.setTimeout(() => setRefreshing(false), 700);
    });
  }, []);

  const onOpenSession = useCallback((session: Session) => {
    if (!session.focusable) return;
    void api.focusSession(session.pid);
  }, []);

  const content: ContentProps = {
    usage,
    sessions,
    justFinished,
    now,
    isRefreshing,
    sessionListHeight: shapes.sessionListHeight,
    onRefresh,
    onOpenSession,
  };

  if (!ready) return null;

  const headline = headlineOf(usage);

  return (
    <NotchShell
      shape={shape}
      isOpen={isOpen}
      closedSize={shapes.closed}
      openSize={shapes.open}
      // The pill draws nothing: it is a handle, a tenth of the ring's width,
      // and the closed layout rendered into it is a full-sized reading spilling
      // out of a shape with no room for it.
      closed={resting === "pill" ? null : <ClosedContent {...content} />}
      open={<OpenContent {...content} />}
      ring={
        <RingSlot
          isOpen={isOpen}
          resting={resting}
          usedFraction={headline?.usedFraction ?? null}
          activity={activityOf(sessions)}
          isStale={usage.status.kind !== "ok" || usage.windows.length === 0}
          isRefreshing={isRefreshing}
          onRefresh={onRefresh}
        />
      }
    />
  );
}

export interface ShapeInputs {
  usage: ReturnType<typeof useNook>["usage"];
  sessionCount: number;
  hasStatusLine: boolean;
  resting: "ring" | "pill";
  anchorY: number;
  windowHeight: number;
}

/**
 * How big the notch is, closed and open, and what the session list gets.
 *
 * Budgeted rather than measured, for the same reason Codenotch budgets its
 * card: the shape animates to a height, and a height that arrives from a
 * `ResizeObserver` one frame after the animation starts makes the notch lurch.
 * Every part of the panel above the list is a fixed number of line boxes, so
 * the sum is exact — and the list, which is the one thing that is not, is
 * given the remainder and made to scroll.
 */
export function useShapes({
  usage,
  sessionCount,
  hasStatusLine,
  resting,
  anchorY,
  windowHeight,
}: ShapeInputs) {
  return useMemo(() => {
    // What the straight part of the shape can be, once the window's own margin
    // and the two flares have taken their share.
    const available = Math.max(0, windowHeight - 2 * EDGE_MARGIN - 2 * flareInset);

    const closedContent =
      resting === "pill" ? Layout.pillLength : closedLength(sessionCount > 0);
    const closed: Shape = {
      width: resting === "pill" ? Layout.pillDepth : Layout.bodyDepth,
      height: shapeLength(closedContent),
      contentHeight: closedContent,
      centerY: anchorY,
    };

    const header = panelHeaderHeight(usage.windows.length, hasStatusLine);
    const divider = sessionCount > 0 ? sessionDividerHeight : 0;
    const wanted = header + divider + sessionsHeight(sessionCount);

    const openContent = Math.min(wanted, available);
    // Whatever is left once everything with a fixed height has had its share.
    // The list is the one part that is not a known number of line boxes, so it
    // takes the remainder and scrolls rather than growing the panel past the
    // screen.
    const sessionListHeight = Math.max(0, openContent - header - divider);

    const openHeight = shapeLength(openContent);
    const open: Shape = {
      width: Layout.panelWidth,
      height: openHeight,
      contentHeight: openContent,
      centerY: clamp(
        anchorY,
        EDGE_MARGIN + openHeight / 2,
        windowHeight - EDGE_MARGIN - openHeight / 2,
      ),
    };

    return { closed, open, sessionListHeight };
  }, [usage.windows.length, sessionCount, hasStatusLine, resting, anchorY, windowHeight]);
}

/**
 * Tell the Rust side how big the chrome is, so what is reachable matches what
 * is drawn.
 *
 * Growing is reported at once and shrinking only after the animation has
 * finished, so the hot zone is never smaller than the shape inside it. The
 * other way round, a pointer resting on the panel would fall outside the zone
 * the instant it started closing — and the notch would snap shut under a
 * pointer that had not moved.
 */
function useReportChrome(shape: Shape, isOpen: boolean, ready: boolean) {
  const reported = useRef<Shape | null>(null);

  useEffect(() => {
    // Not before the placement has arrived. The shape derived from a window of
    // no height is centred on the top of the screen rather than on the notch,
    // and reporting it hands Rust a hot zone a third of a screen away from
    // anything drawn — long enough for a pointer resting there to open a notch
    // it was nowhere near.
    if (!ready) return;

    const previous = reported.current;
    const grew = !previous || shape.width > previous.width || shape.height > previous.height;

    const report = () => {
      reported.current = shape;
      void api.reportChrome(shape.width, shape.height, shape.centerY);
    };

    if (grew) {
      report();
      return;
    }

    const settle = window.setTimeout(report, UNFOLD_SECONDS * 1000 + 60);
    return () => window.clearTimeout(settle);
  }, [shape.width, shape.height, shape.centerY, isOpen, ready]);
}

/**
 * The global chord, and how it lets go again.
 *
 * Pressing it pins the notch open even though the pointer is elsewhere — the
 * whole point is to see the sessions without reaching for the corner. It
 * unpins on the next press, or once the pointer has actually visited the notch
 * and left again, which is the gesture that means "I'm done with it" without
 * needing a key at all.
 */
function useHotkeyToggle(
  signal: number,
  pointerInside: boolean,
  pinned: boolean,
  setPinned: (pinned: boolean) => void,
) {
  const visited = useRef(false);

  useEffect(() => {
    if (signal === 0) return; // the initial render, not a press
    visited.current = false;
    setPinned(!pinned);
    // `pinned` is read, not depended on: re-running when it changes would flip
    // the notch straight back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);

  useEffect(() => {
    if (!pinned) return;
    if (pointerInside) {
      visited.current = true;
    } else if (visited.current) {
      setPinned(false);
    }
  }, [pinned, pointerInside, setPinned]);

  // No Escape handler, deliberately. The window is `WS_EX_NOACTIVATE` — it
  // never takes focus, so it never receives a key — and making it focusable to
  // get one back would cost the first click on every visit and lose the race
  // to raise the terminal that click asked for. The chord is the way out.
}

const clamp = (value: number, low: number, high: number): number =>
  // `low` wins when the two cross, which happens when the panel is taller than
  // the window: better pinned to the top and clipped at the bottom than the
  // other way round, since the title is the part you cannot lose.
  Math.max(low, Math.min(value, Math.max(low, high)));
