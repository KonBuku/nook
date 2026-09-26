import { describe, expect, it } from "vitest";

import { Layout } from "./layout";
import { EDGE_MARGIN, shapesFor, type ShapeInputs } from "./shapes";

/** The slab the notch is drawn in, in CSS pixels. Mirrors `placement.rs`. */
const WINDOW_HEIGHT = 560;

const inputs = (over: Partial<ShapeInputs> = {}): ShapeInputs => ({
  windowCount: 3,
  sessionCount: 4,
  hasStatusLine: false,
  resting: "ring",
  anchorY: WINDOW_HEIGHT / 2,
  windowHeight: WINDOW_HEIGHT,
  ...over,
});

const top = (shape: { centerY: number; height: number }) => shape.centerY - shape.height / 2;
const bottom = (shape: { centerY: number; height: number }) => shape.centerY + shape.height / 2;

describe("shapesFor", () => {
  it("puts both shapes on the anchor when there is room for them", () => {
    const { closed, open } = shapesFor(inputs());
    expect(closed.centerY).toBe(WINDOW_HEIGHT / 2);
    expect(open.centerY).toBe(WINDOW_HEIGHT / 2);
  });

  it("keeps the silhouette two flares longer than the content it holds", () => {
    const { closed, open } = shapesFor(inputs());
    // Whatever the arithmetic above them, this relationship is what the shape
    // is drawn from — `notchPath` reads the flare out of the height.
    expect(closed.height).toBeGreaterThan(closed.contentHeight);
    expect(open.height).toBeGreaterThan(open.contentHeight);
    expect(closed.height - closed.contentHeight).toBeCloseTo(
      open.height - open.contentHeight,
      6,
    );
  });

  it("holds the closed notch inside the window at the very bottom", () => {
    // An anchor dragged to the bottom of the working area asks for the notch's
    // *centre* there, which would hang half the shape off the end of the
    // window to be sliced flat by its edge.
    const { closed } = shapesFor(inputs({ anchorY: WINDOW_HEIGHT }));
    expect(bottom(closed)).toBeCloseTo(WINDOW_HEIGHT - EDGE_MARGIN, 6);
    expect(top(closed)).toBeGreaterThan(0);
  });

  it("holds the closed notch inside the window at the very top", () => {
    const { closed } = shapesFor(inputs({ anchorY: 0 }));
    expect(top(closed)).toBeCloseTo(EDGE_MARGIN, 6);
    expect(bottom(closed)).toBeLessThan(WINDOW_HEIGHT);
  });

  it("rests the panel on the same edge as the notch at the extremes", () => {
    // The one that matters for the flicker: with both clamped the same way the
    // shape's bottom does not move when it opens, so nothing slides in and out
    // of the window's edge on every hover.
    const bottomEnd = shapesFor(inputs({ anchorY: WINDOW_HEIGHT }));
    expect(bottom(bottomEnd.open)).toBeCloseTo(bottom(bottomEnd.closed), 6);

    const topEnd = shapesFor(inputs({ anchorY: 0 }));
    expect(top(topEnd.open)).toBeCloseTo(top(topEnd.closed), 6);
  });

  it("never lets either shape leave the window, wherever the anchor is put", () => {
    for (let anchorY = -200; anchorY <= WINDOW_HEIGHT + 200; anchorY += 10) {
      const { closed, open } = shapesFor(inputs({ anchorY }));
      for (const shape of [closed, open]) {
        expect(top(shape)).toBeGreaterThanOrEqual(EDGE_MARGIN - 0.001);
        expect(bottom(shape)).toBeLessThanOrEqual(WINDOW_HEIGHT - EDGE_MARGIN + 0.001);
      }
    }
  });

  it("pins a panel taller than the window to the top rather than the bottom", () => {
    // The title is the part you cannot afford to lose off the end.
    const short = shapesFor(inputs({ windowHeight: 120, anchorY: 110 }));
    expect(top(short.open)).toBeCloseTo(EDGE_MARGIN, 6);
  });

  it("folds to the pill's own size, still inside the window", () => {
    const { closed } = shapesFor(inputs({ resting: "pill", anchorY: WINDOW_HEIGHT }));
    expect(closed.width).toBe(Layout.pillDepth);
    expect(closed.contentHeight).toBe(Layout.pillLength);
    expect(bottom(closed)).toBeCloseTo(WINDOW_HEIGHT - EDGE_MARGIN, 6);
  });

  it("gives the session list whatever the fixed parts left it", () => {
    const { open, sessionListHeight } = shapesFor(inputs());
    expect(sessionListHeight).toBeGreaterThan(0);
    expect(sessionListHeight).toBeLessThan(open.contentHeight);
  });

  it("makes the list scroll rather than growing the panel past the window", () => {
    const many = shapesFor(inputs({ sessionCount: 40 }));
    expect(bottom(many.open)).toBeLessThanOrEqual(WINDOW_HEIGHT - EDGE_MARGIN + 0.001);
    expect(many.sessionListHeight).toBeGreaterThan(0);
  });

  it("asks for no list at all when nothing is running", () => {
    expect(shapesFor(inputs({ sessionCount: 0 })).sessionListHeight).toBe(0);
  });
});
