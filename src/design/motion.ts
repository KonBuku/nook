import type { SpringOptions, Transition } from "motion/react";

/**
 * Springs rather than durations, for the same reason SwiftUI's are: the notch
 * is a physical object on the edge of the screen, and a curve with a fixed
 * running time reads as a slide show of it instead.
 *
 * The figures are Codenotch's `NotchMotion`, converted from SwiftUI's
 * (response, dampingFraction) to Motion's (duration, bounce) — which are the
 * same two numbers under different names.
 */

/** Opening and closing the notch. Quick, with just enough overshoot to land. */
export const UNFOLD_SECONDS = 0.42;
const UNFOLD_BOUNCE = 0.22;
export const unfold: Transition = {
  type: "spring",
  duration: UNFOLD_SECONDS,
  bounce: UNFOLD_BOUNCE,
};

/**
 * The same spring, for the `useSpring` values the notch's shape rides on.
 *
 * `SpringOptions` rather than `Transition` because a motion value has no
 * orchestration to describe — no delay, no repeat, nothing to stagger. Quoted
 * from the constants above so the shape and everything animating alongside it
 * cannot drift out of step.
 */
export const unfoldSpring: SpringOptions = {
  duration: UNFOLD_SECONDS,
  bounce: UNFOLD_BOUNCE,
};

/** A reading changing: no bounce at all — a measurement does not wobble. */
export const reading: Transition = { type: "spring", duration: 0.55, bounce: 0 };

/** Swapping one set of rows for another. */
export const crossfade: Transition = { duration: 0.18, ease: [0.4, 0, 0.2, 1] };

/** A row arriving in or leaving the session list. */
export const row: Transition = { type: "spring", duration: 0.38, bounce: 0.15 };

/** How long one turn of the ring's activity arc takes, in seconds. */
export const SPIN_PERIOD = 1.1;
