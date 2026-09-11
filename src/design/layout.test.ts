import { describe, expect, it } from "vitest";

import {
  Layout,
  closedLength,
  flareInset,
  limitBlockHeight,
  panelHeaderHeight,
  sessionDividerHeight,
  sessionRowBleed,
  sessionRowHeight,
  sessionRowRadius,
  sessionsHeight,
  shapeLength,
} from "./layout";
import { px, fontSize, SCALE } from "./scale";

/**
 * The panel's height is budgeted, not measured — the shape animates to a
 * number, and a height that arrives from a `ResizeObserver` a frame later makes
 * the notch lurch. That trade is only safe while the budget and what the
 * stylesheet actually draws agree, which is what these check.
 */

describe("scale", () => {
  it("is anchored on the ring the design spec names", () => {
    // The frame fixes only ratios; this one measurement picks the scale.
    expect(px(117)).toBeCloseTo(44, 6);
    expect(SCALE).toBeCloseTo(44 / 117, 9);
  });

  it("converts a cap height back to a font size", () => {
    // Type in the frame can only be measured by its capitals.
    expect(fontSize(27) * 0.714).toBeCloseTo(px(27), 6);
  });
});

describe("the closed notch", () => {
  it("makes room for the chip only when there is one", () => {
    const withChip = closedLength(true);
    const without = closedLength(false);
    expect(withChip - without).toBeCloseTo(Layout.chipGap + Layout.chipHeight, 6);
  });

  it("is tall enough for everything the stylesheet stacks in it", () => {
    // Ring, its gap, the percent line, the chip's gap and the chip — plus the
    // frame's own padding at each end.
    expect(closedLength(true)).toBeGreaterThan(
      Layout.ringDiameter + Layout.ringLabelGap + Layout.chipHeight,
    );
  });
});

describe("the shape around the content", () => {
  it("adds a flare at each end", () => {
    // The bug this guards: the flares are part of the silhouette but not part
    // of the room inside it. Sized as though they were, the session chip hung
    // below the notch's own outline and the last row was clipped.
    expect(shapeLength(100)).toBeCloseTo(100 + 2 * flareInset, 6);
    expect(flareInset).toBe(Layout.curlRadius);
  });
});

describe("the open panel", () => {
  it("grows by exactly one block per limit window", () => {
    const one = panelHeaderHeight(1, false);
    const two = panelHeaderHeight(2, false);
    expect(two - one).toBeCloseTo(limitBlockHeight + Layout.blockSpacing, 6);
  });

  it("reserves nothing for limits when there are none and nothing to say", () => {
    expect(panelHeaderHeight(0, false)).toBeCloseTo(
      2 * Layout.panelPadding + Layout.ringDiameter,
      6,
    );
  });

  it("makes room for a status message in place of the bars", () => {
    expect(panelHeaderHeight(0, true)).toBeGreaterThan(panelHeaderHeight(0, false));
  });
});

describe("the session list", () => {
  it("budgets each row's own padding", () => {
    // The bug this guards: the row is a button, and its padding lives in the
    // stylesheet. Left out of the budget, five rows overflowed the panel by
    // exactly ten times that padding, and the last row was cut in half.
    expect(sessionRowHeight).toBeGreaterThan(2 * Layout.sessionRowGap);
    expect(sessionsHeight(1)).toBeCloseTo(sessionRowHeight, 6);
  });

  it("keeps the hover shape inside the panel", () => {
    // The row's box reaches past the text column by the bleed. Any wider than
    // the panel's own padding and the highlight hangs off the edge of the
    // silhouette — which is what the first version did, by widening the list
    // and the row each with its own negative margin.
    expect(sessionRowBleed).toBeLessThanOrEqual(Layout.panelPadding);
    expect(sessionRowBleed).toBeGreaterThan(0);
  });

  it("rounds the hover shape enough to read as rounded", () => {
    // At 3.8px against a 32pt-tall highlight it read as a plain rectangle. The
    // radius has to be a real fraction of the shape's height — and no more
    // than half of it, or the corners meet and it becomes a pill.
    expect(sessionRowRadius).toBeGreaterThan(sessionRowHeight / 8);
    expect(sessionRowRadius).toBeLessThanOrEqual(sessionRowHeight / 2);
  });

  it("charges for the space between rows and not after the last", () => {
    const step = sessionsHeight(3) - sessionsHeight(2);
    expect(step).toBeCloseTo(sessionsHeight(2) - sessionsHeight(1), 6);
    expect(sessionsHeight(0)).toBe(0);
  });

  it("separates the sessions from the limits with a rule and its spacing", () => {
    expect(sessionDividerHeight).toBeCloseTo(
      2 * Layout.blockSpacing + Layout.hairline,
      6,
    );
  });
});
