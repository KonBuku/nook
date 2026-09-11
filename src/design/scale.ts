/**
 * Every number in Nook's UI is measured off the same Figma frame Codenotch was
 * drawn from (2000 x 2000 px; see `docs/design/README.md`), so
 * the layout is *proportionally* exact rather than eyeballed.
 *
 * The frame fixes only ratios, never an absolute size, so one anchor picks the
 * scale: the design spec calls the provider ring 44pt across, and it measures
 * 117px in the frame. Change `SCALE` and the whole surface — notch, ring, type,
 * panel — resizes together, still in the design's proportions.
 *
 * A macOS point and a CSS pixel are the same unit at 100% scaling, and WebView2
 * multiplies both by the monitor's DPI factor, so the frame's proportions
 * survive the port unchanged.
 */
export const SCALE = 44 / 117;

/** A distance measured in design-frame pixels, in CSS pixels. */
export const px = (pixels: number): number => pixels * SCALE;

/**
 * Cap-height fraction of an em. The frame's type can only be measured by its
 * cap height, so this converts back to a font size.
 *
 * SF Pro's ratio, kept rather than re-derived for Segoe UI: the two differ by
 * about half a percent, which is a fifth of a pixel at the sizes used here.
 */
const CAP_RATIO = 0.714;

/** The font size whose capital letters are `pixels` tall in the frame. */
export const fontSize = (capPixels: number): number => px(capPixels) / CAP_RATIO;

/** Rounded to two places — enough precision for CSS, short enough to read. */
export const cssPx = (pixels: number): string => `${Math.round(px(pixels) * 100) / 100}px`;
