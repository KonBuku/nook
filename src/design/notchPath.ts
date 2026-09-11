/**
 * The notch body: a pill welded to the left edge of the screen, with *inverse*
 * rounded corners at each end that flare back out to the edge, so it reads as
 * part of the bezel rather than as a floating panel.
 *
 * Windows has no hardware notch to imitate, so unlike Codenotch there is only
 * one variant to draw — and drawing it directly, for the left edge, is clearer
 * than a canonical path plus a transform onto whichever edge it happens to be.
 *
 * SVG coordinates: x rightward from the screen edge, y downward. Angles below
 * are quoted in that frame, so a rising angle sweeps clockwise on screen.
 */
export interface NotchPathOptions {
  /** How far the body reaches in from the screen edge. */
  width: number;
  /** The full shape, flares included. */
  height: number;
  /** The inverse corner where the shape meets the bezel. */
  curl: number;
  /** The outer corner, away from the bezel. */
  corner: number;
}

export function notchPath({ width, height, curl, corner }: NotchPathOptions): string {
  // Order matters. Clamping the corner by `width - curl` — the obvious reading
  // — collapses it to zero as soon as the flare is as wide as the body, which
  // is exactly what happens when the notch folds to its pill: a 10pt-wide
  // shape came out with square corners. The corner is claimed first, out of
  // half the width, and the flare takes what is left.
  const wanted = clamp(corner, 0, width / 2);
  const c = clamp(curl, 0, Math.min(height / 2, width - wanted));
  const r = clamp(wanted, 0, (height - 2 * c) / 2);

  const bodyTop = c;
  const bodyBottom = height - c;

  const parts: string[] = [`M 0 0`];

  // Flare inward and down onto the body's top edge. Concave: it cuts the
  // corner out of the bezel rather than rounding off the shape.
  if (c > 0) parts.push(`A ${c} ${c} 0 0 0 ${c} ${bodyTop}`);

  parts.push(`L ${width - r} ${bodyTop}`);
  if (r > 0) parts.push(`A ${r} ${r} 0 0 1 ${width} ${bodyTop + r}`);

  parts.push(`L ${width} ${bodyBottom - r}`);
  if (r > 0) parts.push(`A ${r} ${r} 0 0 1 ${width - r} ${bodyBottom}`);

  parts.push(`L ${c} ${bodyBottom}`);
  // Flare back out to the screen edge.
  if (c > 0) parts.push(`A ${c} ${c} 0 0 0 0 ${height}`);

  parts.push("Z");
  return parts.join(" ");
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));
