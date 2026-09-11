import { motion, useReducedMotion } from "motion/react";

import { ClaudeMark } from "~/features/ClaudeMark";
import { bandColor, bandFor, Palette } from "~/design/palette";
import { Layout } from "~/design/layout";
import { reading, SPIN_PERIOD } from "~/design/motion";
import type { ActivityState } from "~/features/sessions/activity";

/**
 * The ring around Claude's mark: a grey track with a coloured arc that starts
 * at twelve o'clock and sweeps clockwise by the fraction used.
 *
 * When something is happening right now, a second, much thinner arc appears
 * *inside* the ring, in the gap between the mark and the track. It is
 * deliberately a different radius, a different weight and a neutral colour, so
 * it reads as a separate fact rather than as the usage number moving.
 */
export function UsageRing({
  usedFraction,
  activity,
  isStale = false,
  isRefreshing = false,
}: {
  /** Null when there is no reading — an empty track, rather than a confident 0%. */
  usedFraction: number | null;
  activity: ActivityState;
  isStale?: boolean;
  isRefreshing?: boolean;
}) {
  const size = Layout.ringDiameter;
  const center = size / 2;

  // The arc rides the centre line of the track: same radius, thinner stroke.
  // That is what puts a fine coloured line inside a heavier grey one, the way
  // the design frame draws it.
  const radius = (size - Layout.trackStroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const sweep = Math.min(Math.max(usedFraction ?? 0, 0), 1);
  const band = bandFor(sweep);

  return (
    <motion.div
      style={{ width: size, height: size, position: "relative", flex: "none" }}
      // Pressed in while it works, and released when the answer lands. The ring
      // is the button, so the ring is what should feel pressed.
      animate={{ scale: isRefreshing ? 0.93 : 1 }}
      transition={{ type: "spring", duration: 0.3, bounce: 0.35 }}
    >
      {/* Dimming applies to the usage reading only. Whether Claude is working
          right now is known first-hand and stays at full strength even when the
          percentage behind it has gone stale. */}
      <svg
        width={size}
        height={size}
        style={{ display: "block", opacity: isStale ? 0.45 : 1, transition: "opacity 200ms" }}
        aria-hidden
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={Palette.ringTrack}
          strokeWidth={Layout.trackStroke}
        />
        {usedFraction !== null && (
          <motion.circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={bandColor(band)}
            strokeWidth={Layout.progressStroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            // Twelve o'clock, clockwise.
            transform={`rotate(-90 ${center} ${center})`}
            // A ring that snaps to a new value reads as a glitch; one that
            // sweeps reads as a measurement being taken.
            animate={{ strokeDashoffset: circumference * (1 - sweep) }}
            initial={{ strokeDashoffset: circumference }}
            transition={reading}
          />
        )}
      </svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          // A spent limit dims its mark, so the ring reads as "waiting".
          opacity: band === "exhausted" ? 0.35 : 1,
          transition: "opacity 200ms",
        }}
      >
        <ClaudeMark size={Layout.glyphSize} />
      </div>

      {activity !== "idle" && <ActivityArc state={activity} />}
    </motion.div>
  );
}

/**
 * The inner indicator: a short arc that spins while work is happening, and a
 * full pulsing ring when something is blocked waiting on you.
 *
 * White for working, deliberately: the indicator sits inside a ring whose
 * colour already means "how much of your limit is gone", and a neutral tone
 * cannot be misread as part of that scale. Waiting gets amber because it is the
 * one state that wants something from you.
 */
function ActivityArc({ state }: { state: Exclude<ActivityState, "idle"> }) {
  const reduceMotion = useReducedMotion();
  const size = Layout.ringDiameter;
  const center = size / 2;
  const radius = Layout.activityDiameter / 2;
  const circumference = 2 * Math.PI * radius;
  const color = state === "waiting" ? Palette.watch : Palette.textPrimary;

  const shared = {
    cx: center,
    cy: center,
    r: radius,
    fill: "none",
    stroke: color,
    strokeWidth: Layout.activityStroke,
    strokeLinecap: "round" as const,
  };

  return (
    <svg
      width={size}
      height={size}
      style={{ position: "absolute", inset: 0, display: "block" }}
      aria-hidden
    >
      {state === "working" ? (
        <motion.circle
          {...shared}
          // A quarter of the circle, turning.
          strokeDasharray={`${circumference * 0.25} ${circumference}`}
          style={{ originX: "50%", originY: "50%" }}
          animate={reduceMotion ? {} : { rotate: 360 }}
          transition={{ duration: SPIN_PERIOD, ease: "linear", repeat: Infinity }}
        />
      ) : (
        <motion.circle
          {...shared}
          animate={reduceMotion ? { opacity: 1 } : { opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity }}
        />
      )}
    </svg>
  );
}
