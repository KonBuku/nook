import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

import { CLAUDE_SPINNER_FRAMES, CLAUDE_SPINNER_INTERVAL } from "~/design/claudeSpinner";
import type { SessionState } from "~/ipc/types";

/**
 * One clock for every spinner on screen.
 *
 * Each row could run its own timer, but then a panel of six sessions shows six
 * marks pulsing out of step — which reads as six unrelated things rather than
 * one app working. A single module-level interval keeps them in phase, and
 * costs one timer instead of one per row.
 *
 * It only runs while something is subscribed, so a notch with nothing working
 * has no timer at all.
 */
let frame = 0;
let ticker: number | undefined;
const listeners = new Set<(frame: number) => void>();

function subscribe(listener: (frame: number) => void): () => void {
  listeners.add(listener);
  if (ticker === undefined) {
    ticker = window.setInterval(() => {
      frame = (frame + 1) % CLAUDE_SPINNER_FRAMES.length;
      listeners.forEach((fn) => fn(frame));
    }, CLAUDE_SPINNER_INTERVAL);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && ticker !== undefined) {
      window.clearInterval(ticker);
      ticker = undefined;
    }
  };
}

function useSpinnerFrame(running: boolean): number {
  const [current, setCurrent] = useState(frame);
  useEffect(() => {
    if (!running) return;
    setCurrent(frame);
    return subscribe(setCurrent);
  }, [running]);
  return running ? current : 0;
}

/**
 * Which mark a state that is *not* animating rests on.
 *
 * None of them is the interpunct, and that is the point. Resting on it left a
 * finished session marked by a dot barely two pixels across — the animation
 * appeared to stop and take the icon with it, which is the opposite of what
 * "done" should look like.
 */
const RESTING = {
  /** The heavy asterisk, held still: stopped, and asking for something. */
  waiting: CLAUDE_SPINNER_FRAMES.length - 1,
  /**
   * The six-pointed star — solid where the others are spoked, so a turn that
   * has just ended reads as a full stop rather than as a paused spinner.
   */
  done: 3,
  /** The plain eight-spoked asterisk: open, even, and quiet. Nothing happening. */
  idle: 2,
} as const;

/**
 * Claude Code's own working mark, in the notch.
 *
 * Working plays the real animation. The other two states hold a single frame
 * from the same set rather than switching to a different kind of shape, so the
 * three states read as one object in three moods — which is the point of using
 * the terminal's own mark instead of a coloured dot.
 */
export function ClaudeSpinner({
  state,
  size,
  color,
  justFinished = false,
}: {
  state: SessionState;
  size: number;
  color: string;
  justFinished?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const animating = state === "busy" && !reduceMotion;
  const spinning = useSpinnerFrame(animating);

  let index: number;
  if (animating) {
    index = spinning;
  } else if (state === "busy") {
    // Reduced motion: hold the fullest mark rather than pulse it. Still
    // legibly "working" — it is the mark that is doing the saying.
    index = RESTING.waiting;
  } else if (state === "waiting") {
    index = RESTING.waiting;
  } else {
    index = justFinished ? RESTING.done : RESTING.idle;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{
        display: "block",
        flex: "none",
        // Blocked on you is the one state that should catch the eye without
        // moving; a slow breath does that where a spin would say "working".
        animation:
          state === "waiting" && !reduceMotion ? "nook-breathe 1.8s ease-in-out infinite" : undefined,
      }}
      aria-hidden
    >
      <path d={CLAUDE_SPINNER_FRAMES[index]} fill={color} />
    </svg>
  );
}
