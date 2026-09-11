import { describe, expect, it } from "vitest";

import { agoText, elapsedText, resetText, shortPath, usageSummary } from "./copy";

/**
 * The copy is where a correct reading goes wrong.
 *
 * Every case here is one that shipped wrong, or would read wrong, in Codenotch
 * or in this port — a path that never split, a reset time a week out written as
 * a weekday, a minute count that truncated instead of rounding.
 */

const at = (iso: string) => new Date(iso);

describe("shortPath", () => {
  it("keeps the two segments that tell sessions apart", () => {
    // The bug this exists for: a `[\\/]` class missing a backslash matches only
    // forward slashes, so the whole path came through and every row was a
    // near-identical `C:\Users\you\Desktop\...`.
    expect(shortPath("C:\\Users\\you\\Desktop\\notes-app")).toBe("Desktop\\notes-app");
  });

  it("handles forward slashes and mixed separators", () => {
    expect(shortPath("C:/Users/you/Desktop/notes-app")).toBe("Desktop\\notes-app");
    expect(shortPath("C:\\Users/you\\Desktop/notes-app")).toBe("Desktop\\notes-app");
  });

  it("survives a UNC path and a bare folder", () => {
    expect(shortPath("\\\\server\\share\\project")).toBe("share\\project");
    expect(shortPath("notes-app")).toBe("notes-app");
  });

  it("gives the original back rather than an empty row", () => {
    expect(shortPath("")).toBe("");
  });
});

describe("resetText", () => {
  const now = at("2026-09-07T12:00:00Z");

  it("rounds minutes rather than truncating", () => {
    // 50m40s reads as 51, not 50.
    expect(resetText(at("2026-09-07T12:50:40Z"), now)).toBe("Resets in 51 min");
  });

  it("never says 60 min", () => {
    // A value that rounds up to 60 falls through to the absolute form.
    expect(resetText(at("2026-09-07T12:59:50Z"), now)).not.toContain("60 min");
  });

  it("says a day and month past a week out, not a weekday", () => {
    // A weekday only identifies a day inside the coming week: a window 26 days
    // out written as "Resets Mon 3:55 PM" reads as *this* Monday.
    const text = resetText(at("2026-10-03T15:55:00Z"), now);
    expect(text).toMatch(/Resets \w/);
    expect(text).not.toMatch(/\d:\d\d/);
  });

  it("says so when the window has already rolled", () => {
    expect(resetText(at("2026-09-07T11:00:00Z"), now)).toBe("Resetting…");
  });
});

describe("elapsedText", () => {
  const now = at("2026-09-07T12:00:00Z");

  it("does not count seconds", () => {
    expect(elapsedText(at("2026-09-07T11:59:40Z"), now)).toBe("just now");
  });

  it("never says 0 min", () => {
    expect(elapsedText(at("2026-09-07T11:59:14Z"), now)).toBe("1 min");
  });

  it("drops the minutes when there are none", () => {
    expect(elapsedText(at("2026-09-07T10:00:00Z"), now)).toBe("2 hr");
    expect(elapsedText(at("2026-09-07T09:30:00Z"), now)).toBe("2 hr 30 min");
  });

  it("phrases the same span as a point in the past", () => {
    expect(agoText(at("2026-09-07T11:59:40Z"), now)).toBe("just now");
    expect(agoText(at("2026-09-07T11:00:00Z"), now)).toBe("1 hr ago");
  });
});

describe("usageSummary", () => {
  it("gives both ends of the same figure", () => {
    // "12% Used" beside a vendor's "87% remaining" reads as two different
    // numbers rather than one seen from either end.
    expect(usageSummary(0.73)).toBe("73% Used · 27% left");
  });

  it("never reports negative headroom", () => {
    expect(usageSummary(1.4)).toBe("140% Used · 0% left");
  });
});
