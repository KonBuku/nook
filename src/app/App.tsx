import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { shapesFor, type Shape, type Shapes } from "~/design/shapes";
import { useJustFinished } from "~/features/sessions/activity";
import { headlineOf, statusMessage } from "~/features/usage/status";
import { api } from "~/ipc/bindings";
import type { Session } from "~/ipc/types";
import { ClosedContent, OpenContent, type ContentProps } from "~/notch/NotchContent";
import { RingSlot } from "~/notch/RingSlot";
import { activityOf } from "~/features/sessions/activity";
import { NotchShell } from "~/notch/NotchShell";
import { useDragging, useNook, useNow, usePointerInside } from "./useNook";

export function App() {
  const { usage, sessions, preferences, placement, toggleSignal } = useNook();
  const pointerInside = usePointerInside();
  const dragging = useDragging();
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
  const onPaint = useReportPainted();
  useReportReach(shapes.closed, ready);

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

  // Only the press is ours. Following the cursor and noticing the button come
  // back up both happen in Rust, because the page stops receiving the pointer
  // the moment it leaves the notch — the window is clipped to a region, and
  // that is enforced below the browser.
  const onGrab = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    void api.beginDrag();
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
    onGrab,
  };

  if (!ready) return null;

  const headline = headlineOf(usage);

  return (
    <NotchShell
      shape={shape}
      isOpen={isOpen}
      dragging={dragging}
      onPaint={onPaint}
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

/** The memo over `shapesFor`. The arithmetic itself lives in `design/shapes`. */
export function useShapes({
  usage,
  sessionCount,
  hasStatusLine,
  resting,
  anchorY,
  windowHeight,
}: {
  usage: ReturnType<typeof useNook>["usage"];
  sessionCount: number;
  hasStatusLine: boolean;
  resting: "ring" | "pill";
  anchorY: number;
  windowHeight: number;
}): Shapes {
  const windowCount = usage.windows.length;
  return useMemo(
    () =>
      shapesFor({ windowCount, sessionCount, hasStatusLine, resting, anchorY, windowHeight }),
    [windowCount, sessionCount, hasStatusLine, resting, anchorY, windowHeight],
  );
}

/**
 * Tell the Rust side what is on screen, so the region it cuts the window to
 * never clips the shape inside it.
 *
 * Driven by the springs the shape rides rather than by the target it is heading
 * for, and that is the whole of it: between one target and the next there is a
 * travelling object that is at neither, and a region cut to either end saws a
 * piece off whatever is in the middle.
 *
 * This replaced a scheme that reported the two ends and tried to cover the
 * journey — grow at once, shrink once the spring should have landed. Every
 * failure it had was a guess about the middle that turned out wrong: it watched
 * the width and the height but not where the shape's centre was, so travel that
 * was purely a move went unreported until the timer fired half a second later;
 * and the rectangle it held meanwhile spanned both ends at once, which is a
 * band of window that swallows clicks while nothing is drawn in it.
 *
 * What makes reporting every frame affordable is that "every frame" means every
 * frame *the shape moves*, which is a few hundred milliseconds at a time and
 * nothing at all in between. A drag away from the screen's ends moves the
 * window, not the shape, and reports nothing. Whole pixels, because the region
 * is measured in them, and the rounding is what keeps three motion values
 * changing in the same frame down to one call.
 *
 * The margin the region is grown by covers the rest: a frame of travel, and the
 * command's own trip across the IPC.
 */
function useReportPainted() {
  const sent = useRef<{ width: number; height: number; centerY: number } | null>(null);

  return useCallback((width: number, height: number, top: number) => {
    const next = {
      width: Math.round(width),
      height: Math.round(height),
      centerY: Math.round(top + height / 2),
    };

    const previous = sent.current;
    if (
      previous &&
      previous.width === next.width &&
      previous.height === next.height &&
      previous.centerY === next.centerY
    ) {
      return;
    }

    sent.current = next;
    void api.reportChrome(next.width, next.height, next.centerY);
  }, []);
}

/**
 * Tell the Rust side how big the notch is at rest.
 *
 * This is what a pointer has to touch to open the notch, and it is a different
 * rectangle from the one above on a different schedule. Reported the instant it
 * changes, in both directions: it describes where the notch *will* be, so there
 * is no animation for it to wait out — and waiting is precisely what made
 * walking back towards the screen edge reopen a panel that had just closed.
 *
 * `contentHeight` rather than `height`, because the flares are not somewhere
 * anyone can aim. The silhouette curves concavely back to the screen edge over
 * a flare radius at each end, so the ends of its bounding box hold nothing but
 * a sliver against the very edge — and a hot zone cut to the box opened the
 * notch from a pointer with visibly nothing under it.
 */
function useReportReach(resting: Shape, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    void api.reportReach(resting.width, resting.contentHeight, resting.centerY);
  }, [resting.width, resting.contentHeight, resting.centerY, ready]);
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
