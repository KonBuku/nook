import { fontSize, px } from "./scale";

/**
 * Every measurement is quoted in design-frame pixels so it can be checked
 * against Codenotch's own design frame directly — see `docs/design/README.md`.
 *
 * Nook only ever draws one edge — the left — and one provider, so the
 * stack-space machinery Codenotch needs for four edges and eight rings is
 * gone. What survives is every proportion the frame fixes.
 */
export const Layout = {
  // ── The notch body, at rest ────────────────────────────────────────────
  /** The depth the frame fixes: a 44pt ring with an even margin either side. */
  bodyDepth: px(186),
  /** The inverse corner where the body flares back out to the screen edge. */
  curlRadius: px(103),
  cornerRadius: px(78.8),
  padTop: px(69.5),
  padBottom: px(50.1),

  // ── The resting pill ───────────────────────────────────────────────────
  // Not in the frame — it is the notch folded away, sized to read as a
  // deliberate handle rather than a sliver of chrome.
  pillDepth: px(26),
  pillLength: px(210),

  // ── The ring ───────────────────────────────────────────────────────────
  ringDiameter: px(117), // 44pt, the design spec's anchor
  trackStroke: px(15.5),
  progressStroke: px(8),
  glyphSize: px(46),
  ringLabelGap: px(26.9),

  /**
   * The activity indicator. Not in the frame — sized to sit in the gap between
   * the glyph (46px across) and the inside edge of the track (86px), so it
   * never crowds either.
   */
  activityDiameter: px(72),
  activityStroke: px(5.5),

  // ── The open panel ─────────────────────────────────────────────────────
  panelWidth: px(600),
  panelCorner: px(49.5),
  panelPadding: px(32),
  barHeight: px(10.5),
  headerGap: px(17), // ring/glyph -> title
  headerToBlock: px(21),
  labelToBar: px(16.8),
  barToUsed: px(17.8),
  blockSpacing: px(20),
  sessionRowGap: px(10), // the two lines of one session
  hairline: px(2.5),

  /**
   * The ring beside a session's status. Sized against the body text's cap
   * (18px) rather than picked by eye, so it reads as part of the word rather
   * than a bullet pinned near it.
   */
  /** Between a mark and the word beside it. */
  markGap: px(11),
  /**
   * The surface mark on a session's detail row.
   *
   * A mark with two strokes inside it needs room: at the 6px the old status
   * ring used, all four surfaces rendered as the same grey smudge.
   */
  surfaceIcon: px(27),
  /**
   * Claude Code's spinner mark, beside a session's state word and in the chip.
   *
   * Larger than the status ring it replaced: the marks it cycles through are
   * genuinely different sizes — the interpunct is a tenth the extent of the
   * heavy asterisk — and at six pixels the small end of that range disappears
   * rather than reading as the quiet state.
   */
  spinner: px(30),

  /** The count chip under the ring while the notch is closed. */
  chipHeight: px(46),
  chipGap: px(22),
} as const;

/** Type sizes, derived from cap heights measured in the frame. */
export const Type = {
  /** The percent under the ring. Cap height 27px. */
  percent: fontSize(27),
  /** "Claude". Cap height 26px. */
  title: fontSize(26),
  /** Everything else in the panel. Cap height 18px. */
  body: fontSize(18),
  /**
   * The session count in the closed notch's chip.
   *
   * Between the body text and the percent: it is paired with a mark of its own
   * size, and set at body size it read as a stray digit parked beside the
   * glyph rather than as part of it.
   */
  chip: fontSize(22),
} as const;

/**
 * Line boxes, so a height can be budgeted before anything is laid out.
 *
 * 1.25em rather than a measured ascender-plus-descender: the CSS box model
 * already gives us a `line-height` to set, and quoting the same figure in both
 * places is what keeps the budget and the rendering in step.
 */
export const LINE_HEIGHT_RATIO = 1.25;
export const titleLine = Type.title * LINE_HEIGHT_RATIO;
export const bodyLine = Type.body * LINE_HEIGHT_RATIO;
export const percentLine = Type.percent * LINE_HEIGHT_RATIO;

/** One limit window: label row, bar, then the "% used" line. */
export const limitBlockHeight =
  2 * bodyLine + Layout.labelToBar + Layout.barHeight + Layout.barToUsed;

/**
 * A session row's own padding.
 *
 * The row is a button, and the padding is what gives hovering it a shape wider
 * than its text rather than a rectangle drawn tight around it. Named here
 * rather than written into the stylesheet because the panel's height is
 * budgeted, not measured — padding the CSS knows about and the budget does not
 * is padding that pushes the last row out of the panel.
 */
export const sessionRowPadding = px(12);

/**
 * How far the row's box reaches past the text on each side.
 *
 * The list is widened by exactly this and the row fills it, so the text still
 * lands on the panel's own grid while the hover shape stands clear of it. Done
 * once, in one place: the first version widened the list *and* the row, each by
 * its own negative margin, and the highlight ended up hanging off the panel.
 */
export const sessionRowBleed = px(20);

/**
 * The hover shape's corner.
 *
 * Generous on purpose. At the 3.8px this started with, a 32pt-tall highlight
 * read as a plain rectangle — the radius has to be a real fraction of the
 * shape's height to register as rounded at all.
 */
export const sessionRowRadius = px(24);

/** Clear space between one row and the next. */
export const sessionRowSpacing = Layout.blockSpacing / 3;

/** One session: name row, then the quieter detail row, and its own padding. */
export const sessionRowHeight =
  2 * bodyLine + Layout.sessionRowGap + 2 * sessionRowPadding;

/** What a run of `n` session rows costs, spacing included. */
export const sessionsHeight = (n: number): number =>
  n <= 0 ? 0 : n * sessionRowHeight + (n - 1) * sessionRowSpacing;

/**
 * The flare at each end of the shape.
 *
 * It is part of the silhouette but not part of the room inside it: the body's
 * straight sides only begin one flare radius in, and content laid out any
 * higher sits over a part of the shape that is curving away from underneath it.
 * So every height here is the *straight* part, and the shape is that plus two
 * flares — exactly the `bodyLength` / `shapeLength` split Codenotch draws.
 */
export const flareInset = Layout.curlRadius;

/** A content height, as the height of the shape that has to hold it. */
export const shapeLength = (content: number): number => content + 2 * flareInset;

/** The closed notch: ring, its percent label, and the padding either side. */
export const closedLength = (hasChip: boolean): number =>
  Layout.padTop +
  Layout.ringDiameter +
  Layout.ringLabelGap +
  percentLine +
  (hasChip ? Layout.chipGap + Layout.chipHeight : 0) +
  Layout.padBottom;

/**
 * The open panel's height, above the session list.
 *
 * Everything here is fixed by the reading, so it can be budgeted exactly; the
 * session list then takes whatever is left, which is what makes it the part
 * that scrolls.
 */
export const panelHeaderHeight = (windowCount: number, hasStatusLine: boolean): number => {
  let height = 2 * Layout.panelPadding + Layout.ringDiameter;
  if (windowCount > 0) {
    height +=
      Layout.headerToBlock +
      windowCount * limitBlockHeight +
      (windowCount - 1) * Layout.blockSpacing;
  } else if (hasStatusLine) {
    // A status message in place of the bars. Two lines, since the longest of
    // them wraps.
    height += Layout.headerToBlock + 2 * bodyLine;
  }
  return height;
};

/** The rule and the spacing that separate the sessions from the limits. */
export const sessionDividerHeight =
  Layout.blockSpacing + Layout.hairline + Layout.blockSpacing;
