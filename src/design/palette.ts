/**
 * Sampled from the design frame, not invented.
 *
 * These differ slightly from the hexes written in Codenotch's design spec — the
 * frame is the source of truth, so the sampled values win.
 */
export const Palette = {
  /** The notch body and the panel are the same black; they are one object. */
  surface: "#000000",
  ringTrack: "#303030",
  barTrack: "#2D2D2D",

  /**
   * Claude's own colour, and what "working" is drawn in.
   *
   * Sampled off a screenshot of the spinner actually running in Windows
   * Terminal — the most common lit pixel across four captured frames — which
   * lands within two points of Anthropic's published #D97757. Measured rather
   * than looked up, for the same reason every other colour here is: the thing
   * on screen is the source of truth.
   */
  claude: "#D77757",

  /** Under half a limit spent. */
  ample: "#00FF88",
  /** Getting close — and the colour of a session that wants something. */
  watch: "#F2FF00",
  /** Nearly out, or out. */
  critical: "#FF3F00",

  textPrimary: "#FFFFFF",
  textSecondary: "#808080",
} as const;

export type UsageBand = "ample" | "watch" | "critical" | "exhausted";

/**
 * The colour a ring or bar takes at a given level of use.
 *
 * The thresholds come from the mockup, which shows 21% green, 52% yellow and
 * 73% orange. (The prose table in the design spec says 50–79 is yellow, which
 * would make 73% yellow and contradict the frame it claims to describe — the
 * frame wins.)
 */
export const bandFor = (usedFraction: number): UsageBand => {
  if (usedFraction < 0.5) return "ample";
  if (usedFraction < 0.7) return "watch";
  if (usedFraction < 1.0) return "critical";
  return "exhausted";
};

export const bandColor = (band: UsageBand): string => {
  switch (band) {
    case "ample":
      return Palette.ample;
    case "watch":
      return Palette.watch;
    case "critical":
    case "exhausted":
      return Palette.critical;
  }
};
