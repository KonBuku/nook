import { describe, expect, it } from "vitest";

import { notchPath } from "./notchPath";
import { Layout } from "./layout";

/**
 * The silhouette is generated on every animation frame, so it has to stay a
 * closed, well-formed path at every size the notch passes through — including
 * the ones it only visits for a few milliseconds on the way to somewhere else.
 */

/** Every arc radius in the path, in the order they appear. */
const radii = (d: string): number[] =>
  [...d.matchAll(/A (\d+(?:\.\d+)?) /g)].map((match) => Number(match[1]));

describe("notchPath", () => {
  const open = {
    width: Layout.panelWidth,
    height: 300,
    curl: Layout.curlRadius,
    corner: Layout.cornerRadius,
  };

  it("draws a closed path anchored to the screen edge", () => {
    const d = notchPath(open);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("keeps both flares and both corners at a comfortable size", () => {
    // Two flares and two corners, in that interleaved order.
    expect(radii(notchPath(open))).toEqual([
      Layout.curlRadius,
      Layout.cornerRadius,
      Layout.cornerRadius,
      Layout.curlRadius,
    ]);
  });

  it("keeps the corner when the shape folds to a pill", () => {
    // The bug this guards: clamping the corner by `width - curl` — the obvious
    // reading — collapses it to zero as soon as the flare is as wide as the
    // body, and a 10pt-wide shape came out with square corners. The corner is
    // claimed first, out of half the width.
    const pill = notchPath({
      width: Layout.pillDepth,
      height: Layout.pillLength,
      curl: Layout.curlRadius,
      corner: Layout.cornerRadius,
    });
    const corner = Layout.pillDepth / 2;
    expect(radii(pill)).toContain(corner);
    expect(radii(pill).every((r) => r > 0)).toBe(true);
  });

  it("never lets the two flares overlap in a short shape", () => {
    const squat = notchPath({ width: 200, height: 40, curl: 100, corner: 30 });
    // Each flare gets at most half the height, or they cross in the middle and
    // the path folds through itself.
    expect(radii(squat).every((r) => r <= 20)).toBe(true);
  });

  it("degrades to a plain rectangle rather than NaN at zero size", () => {
    const d = notchPath({ width: 0, height: 0, curl: 40, corner: 30 });
    expect(d).not.toContain("NaN");
    expect(d.endsWith("Z")).toBe(true);
  });

  it("produces no negative radii for any size on the way between the two", () => {
    // The shape passes through every width and height between closed and open
    // on a spring that overshoots, so both ends of the range are exceeded.
    for (let width = 0; width <= Layout.panelWidth + 20; width += 3) {
      for (let height = 0; height <= 500; height += 17) {
        const d = notchPath({
          width,
          height,
          curl: Layout.curlRadius,
          corner: Layout.cornerRadius,
        });
        expect(d).not.toContain("NaN");
        expect(d).not.toContain("-");
      }
    }
  });
});
