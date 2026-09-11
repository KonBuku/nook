import { motion } from "motion/react";

import { Layout } from "~/design/layout";
import { unfold } from "~/design/motion";
import { UsageRing } from "~/features/usage/UsageRing";
import type { ActivityState } from "~/features/sessions/activity";

/**
 * The ring, held outside both layouts so it can travel between them.
 *
 * Closed it is centred under the notch's own width; open it sits in the
 * panel's top-left corner beside the title. Left inside the two layouts and
 * cross-faded, those are two rings in two places dissolving into each other —
 * and what that looks like on screen is the whole panel lurching upward as it
 * opens, because for a moment there genuinely are two of everything.
 *
 * Pulled out here, there is one ring, and it moves. Which is also the honest
 * description of what is happening: the notch is opening around a reading that
 * was already there.
 */
export function RingSlot({
  isOpen,
  resting,
  usedFraction,
  activity,
  isStale,
  isRefreshing,
  onRefresh,
}: {
  isOpen: boolean;
  /** What the notch folds down to. The pill has no room for a ring. */
  resting: "ring" | "pill";
  usedFraction: number | null;
  activity: ActivityState;
  isStale: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  // The pill is the notch folded away — a handle, and nothing else. It is a
  // tenth of the ring's own width, so a ring drawn in it is not a small ring:
  // it is the full-sized one hanging out of a shape that cannot hold it.
  const folded = !isOpen && resting === "pill";

  // Closed, the ring is centred across the notch's depth and sits under the
  // frame's own top padding. Open, it takes the panel's corner. Folded away it
  // waits where the panel will put it, so opening the pill fades the ring in
  // rather than flying it across from a place the pill never drew it.
  const x = isOpen || folded
    ? Layout.panelPadding
    : (Layout.bodyDepth - Layout.ringDiameter) / 2;
  const y = isOpen || folded ? Layout.panelPadding : Layout.padTop;

  return (
    <motion.div
      style={{ position: "absolute", left: 0, top: 0, cursor: "pointer" }}
      initial={false}
      animate={{ x, y, opacity: folded ? 0 : 1 }}
      transition={unfold}
      onClick={onRefresh}
    >
      <UsageRing
        usedFraction={usedFraction}
        activity={activity}
        isStale={isStale}
        isRefreshing={isRefreshing}
      />
    </motion.div>
  );
}
