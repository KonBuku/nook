import { motion } from "motion/react";

import { Layout, Type, bodyLine } from "~/design/layout";
import { bandColor, bandFor, Palette } from "~/design/palette";
import { reading } from "~/design/motion";
import { resetText, usageSummary } from "~/features/copy";
import type { LimitWindow } from "~/ipc/types";

/**
 * One metered window: label and reset copy on a line, a track bar, then the
 * percentage burned.
 */
export function LimitWindowRow({ window, now }: { window: LimitWindow; now: number }) {
  const fraction = window.usedFraction;
  const band = bandFor(fraction ?? 0);

  // Blank rather than invented: not every window says when it rolls over.
  const reset = window.resetsAt ? resetText(new Date(window.resetsAt), new Date(now)) : "";

  return (
    <div style={{ fontSize: Type.body }}>
      <div className="split-row" style={{ height: bodyLine }}>
        <span>{window.label}</span>
        <span className="spacer" />
        <span className="trailing">{reset}</span>
      </div>

      {/* No bar without a denominator — an empty track would read as "none
          used", which is not what "we do not know the limit" means. */}
      {fraction !== null && (
        <div
          className="bar-track"
          style={{ height: Layout.barHeight, marginTop: Layout.labelToBar }}
        >
          <motion.div
            className="bar-fill"
            style={{ background: bandColor(band) }}
            initial={false}
            animate={{
              // Never narrower than it is tall: a 1% reading drawn as a hairline
              // stops looking like a bar at all.
              width: `max(${Layout.barHeight}px, ${Math.min(Math.max(fraction, 0), 1) * 100}%)`,
              backgroundColor: bandColor(band),
            }}
            transition={reading}
          />
        </div>
      )}

      <div
        style={{
          marginTop: Layout.barToUsed,
          height: bodyLine,
          lineHeight: 1.25,
          color: Palette.textPrimary,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fraction !== null ? usageSummary(fraction) : "No reading"}
      </div>
    </div>
  );
}
