/**
 * How big the notch is, closed and open, and where in the window each sits.
 *
 * Plain arithmetic with the window passed in, for the same reason
 * `placement::within` on the Rust side takes the screen as an argument: this is
 * the part that can be wrong in ways nobody notices until a shape is hanging
 * off the end of a display, and it can only be checked if it can be called
 * without a React tree around it. `useShapes` is the two-line memo over it.
 */
import {
  Layout,
  closedLength,
  flareInset,
  panelHeaderHeight,
  sessionDividerHeight,
  sessionsHeight,
  shapeLength,
} from "./layout";

export interface Shape {
  width: number;
  /** The whole silhouette, flares included. */
  height: number;
  /**
   * The straight part between the flares — the only part content can sit in.
   * Always `height` less two flare radii; carried alongside rather than derived
   * so the shape and the layout inside it are quoting one number.
   */
  contentHeight: number;
  /** The chrome's vertical centre, from the top of the window. */
  centerY: number;
}

export interface ShapeInputs {
  /** How many limit windows the reading has. */
  windowCount: number;
  sessionCount: number;
  hasStatusLine: boolean;
  resting: "ring" | "pill";
  /** Where the notch wants its centre, from the top of the window. */
  anchorY: number;
  windowHeight: number;
}

export interface Shapes {
  closed: Shape;
  open: Shape;
  /** What the session list has left once everything fixed has had its share. */
  sessionListHeight: number;
}

/** Clear space between a shape and the top or bottom of the window. */
export const EDGE_MARGIN = 10;

/**
 * Both shapes, and the remainder the session list runs in.
 *
 * Budgeted rather than measured, for the same reason Codenotch budgets its
 * card: the shape animates to a height, and a height that arrives from a
 * `ResizeObserver` one frame after the animation starts makes the notch lurch.
 * Every part of the panel above the list is a fixed number of line boxes, so
 * the sum is exact — and the list, which is the one thing that is not, is
 * given the remainder and made to scroll.
 */
export function shapesFor({
  windowCount,
  sessionCount,
  hasStatusLine,
  resting,
  anchorY,
  windowHeight,
}: ShapeInputs): Shapes {
  // What the straight part of the shape can be, once the window's own margin
  // and the two flares have taken their share.
  const available = Math.max(0, windowHeight - 2 * EDGE_MARGIN - 2 * flareInset);

  const closedContent = resting === "pill" ? Layout.pillLength : closedLength(sessionCount > 0);
  const closedHeight = shapeLength(closedContent);
  const closed: Shape = {
    width: resting === "pill" ? Layout.pillDepth : Layout.bodyDepth,
    height: closedHeight,
    contentHeight: closedContent,
    centerY: inside(anchorY, closedHeight, windowHeight),
  };

  const header = panelHeaderHeight(windowCount, hasStatusLine);
  const divider = sessionCount > 0 ? sessionDividerHeight : 0;
  const wanted = header + divider + sessionsHeight(sessionCount);

  const openContent = Math.min(wanted, available);
  // The list is the one part that is not a known number of line boxes, so it
  // takes the remainder and scrolls rather than growing the panel past the
  // screen.
  const sessionListHeight = Math.max(0, openContent - header - divider);

  const openHeight = shapeLength(openContent);
  const open: Shape = {
    width: Layout.panelWidth,
    height: openHeight,
    contentHeight: openContent,
    centerY: inside(anchorY, openHeight, windowHeight),
  };

  return { closed, open, sessionListHeight };
}

/**
 * Where a shape of this height has to sit to stay inside the window.
 *
 * Both shapes, not just the panel. The closed notch used to take the anchor
 * raw — and an anchor dragged to the very bottom of the working area is, by
 * definition, the notch's *centre* at the bottom of the working area: half the
 * shape hanging past the end of the window, sliced flat by its edge. Opening
 * moved it back inside, because the panel was clamped, and closing pushed it
 * out again. The missing slice appearing and disappearing on every hover is
 * what that looked like.
 *
 * Clamped the same way, the two shapes share a bottom edge at the extremes: the
 * panel grows upward out of a notch that has not moved at all.
 */
function inside(anchorY: number, height: number, windowHeight: number): number {
  const low = EDGE_MARGIN + height / 2;
  const high = windowHeight - EDGE_MARGIN - height / 2;
  // `low` wins when the two cross, which happens when the shape is taller than
  // the window: better pinned to the top and clipped at the bottom than the
  // other way round, since the title is the part you cannot lose.
  return Math.max(low, Math.min(anchorY, Math.max(low, high)));
}
