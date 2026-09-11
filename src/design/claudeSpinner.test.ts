import { describe, expect, it } from "vitest";

import { CLAUDE_SPINNER_FRAMES, CLAUDE_SPINNER_INTERVAL } from "./claudeSpinner";

/**
 * The frames are extracted from a font by a script, not written by hand, so
 * what these guard is that the extraction produced something drawable and that
 * the *pulse* survived it — the property that makes the animation read as
 * Claude Code's rather than as a shape changing its number of spokes.
 */

/** Every coordinate in a path, so its extent can be measured. */
function extent(d: string): { width: number; height: number } {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const xs = numbers.filter((_, i) => i % 2 === 0);
  const ys = numbers.filter((_, i) => i % 2 === 1);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

describe("the Claude Code spinner frames", () => {
  it("has the six marks Claude Code cycles through", () => {
    expect(CLAUDE_SPINNER_FRAMES).toHaveLength(6);
  });

  it("gives every frame a closed, drawable path", () => {
    for (const [index, d] of CLAUDE_SPINNER_FRAMES.entries()) {
      expect(d.startsWith("M"), `frame ${index} starts with a move`).toBe(true);
      expect(d.endsWith("Z"), `frame ${index} closes`).toBe(true);
      expect(d).not.toContain("NaN");
      expect(d).not.toContain("undefined");
    }
  });

  it("keeps every frame inside the 24-unit box", () => {
    for (const [index, d] of CLAUDE_SPINNER_FRAMES.entries()) {
      const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const out = numbers.filter((n) => n < -0.5 || n > 24.5);
      expect(out, `frame ${index} stays in the box`).toEqual([]);
    }
  });

  it("keeps the pulse: the marks are genuinely different sizes", () => {
    // The defect this guards: fitting each glyph to the same box — the obvious
    // way to normalise them — turns the animation from a pulse into a shape
    // that merely changes how many spokes it has. The interpunct has to stay
    // tiny and the heavy asterisk has to stay large.
    const sizes = CLAUDE_SPINNER_FRAMES.map((d) => {
      const { width, height } = extent(d);
      return Math.max(width, height);
    });

    const smallest = Math.min(...sizes);
    const largest = Math.max(...sizes);
    expect(smallest).toBeLessThan(6); // the interpunct
    expect(largest).toBeGreaterThan(20); // the heavy asterisk
    expect(sizes[0]).toBe(smallest); // and the small one leads
  });

  it("plays fast enough to read as motion", () => {
    // Slower than about 200ms per frame and it reads as six separate marks
    // being shown in turn rather than as one thing pulsing.
    expect(CLAUDE_SPINNER_INTERVAL).toBeGreaterThanOrEqual(60);
    expect(CLAUDE_SPINNER_INTERVAL).toBeLessThanOrEqual(200);
  });
});
