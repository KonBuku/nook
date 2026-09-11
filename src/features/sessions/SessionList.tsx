import { AnimatePresence } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  Type,
  sessionRowBleed,
  sessionRowPadding,
  sessionRowRadius,
  sessionRowSpacing,
} from "~/design/layout";
import { Palette } from "~/design/palette";
import type { Session } from "~/ipc/types";
import { SessionRow } from "./SessionRow";

/**
 * How far the list fades at its bottom edge when it can be scrolled further.
 *
 * A visible scrollbar on a 226px black panel is a grey stripe down the side of
 * a shape whose whole point is a clean silhouette. The fade says the same thing
 * more quietly: content continuing past the edge, rather than a control to
 * drag.
 *
 * Short enough to stay clear of a row's hover shape. A gradient painted over a
 * row eats into the highlight underneath it, and a highlight with its top
 * third dimmed does not read as "there is more above" — it reads as a drawing
 * mistake.
 */
const FADE = 12;

export function SessionList({
  sessions,
  justFinished,
  now,
  maxHeight,
  onOpen,
}: {
  sessions: Session[];
  justFinished: ReadonlySet<string>;
  now: number;
  /** What the panel has left for the list after everything above it. */
  maxHeight: number;
  onOpen: (session: Session) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(0);

  /**
   * Only at the bottom, and only while there is more below it.
   *
   * There was a fade at the top too, and it was wrong twice over. The top of
   * the list already has a hard edge — the rule that separates the sessions
   * from the limit windows — so a gradient there says nothing the rule has not
   * already said. And the first row under that rule is a row like any other:
   * scroll down, hover it, and the gradient sits on top of its highlight and
   * dims the top of it, which looks like the rounded corner failed to draw.
   *
   * The bottom has no rule and no edge — the list just stops — so that is
   * where a fade earns its place. It shrinks as the end is approached, because
   * one that vanishes the instant you arrive reads as a flicker.
   */
  const measure = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const past = element.scrollHeight - element.clientHeight - element.scrollTop;
    setFade(Math.min(FADE, Math.max(0, past)));
  }, []);

  // Measured after layout rather than on a timer: the list's height changes
  // when the panel opens and when a session appears, and both are moments the
  // fades have to be right for.
  useLayoutEffect(measure, [measure, sessions, maxHeight]);

  return (
    // Positioned, so the fades can sit *over* the list rather than on it.
    <div style={{ position: "relative", display: "flex", minHeight: 0 }}>
      <div
        ref={scroller}
        className="session-list"
        onScroll={measure}
        style={{
          maxHeight,
          fontSize: Type.body,
          // Widened past the panel's text column by exactly the row's bleed,
          // so a row can fill it and still land its text on the same grid as
          // the limit rows above. The row itself then needs no margin of its
          // own.
          marginInline: -sessionRowBleed,
          width: `calc(100% + ${2 * sessionRowBleed}px)`,
          ["--row-radius" as string]: `${sessionRowRadius}px`,
          ["--row-pad-x" as string]: `${sessionRowBleed}px`,
          ["--row-pad-y" as string]: `${sessionRowPadding}px`,
        }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {sessions.map((session, index) => (
            <SessionRow
              key={session.id}
              session={session}
              justFinished={justFinished.has(session.id)}
              now={now}
              spacing={index === 0 ? 0 : sessionRowSpacing}
              onOpen={onOpen}
            />
          ))}
        </AnimatePresence>
      </div>

      {/*
        Painted over the list rather than applied to it as a `mask-image`.
        A mask promotes the scroller into its own compositing layer, and text in
        a composited layer loses subpixel antialiasing — so the moment the list
        had enough rows to scroll, every row in it went soft. A gradient on top
        costs nothing and leaves the text alone. It works because what is behind
        it is the panel's own flat black.
      */}
      <BottomEdge height={fade} />
    </div>
  );
}

/** The foot of the list, fading into the panel. */
function BottomEdge({ height }: { height: number }) {
  if (height <= 0) return null;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height,
        pointerEvents: "none",
        background: `linear-gradient(to top, ${Palette.surface}, transparent)`,
      }}
    />
  );
}
