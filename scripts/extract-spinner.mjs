// Pulls Claude Code's six spinner marks out of Segoe UI Symbol as real vector
// outlines — the same font Windows Terminal falls back to for these code
// points, so what Nook draws is what the terminal draws.
//
// The six are scaled by ONE shared factor rather than each fitted to the box.
// That matters: the animation is a pulse, and the pulse is made of the glyphs
// genuinely being different sizes. Normalising each to the same extent would
// flatten it into a shape that merely changes its number of spokes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFont, glyphIdFor, glyphContours } from "./ttf.mjs";

const FRAMES = [
  [0x00b7, "interpunct"],
  [0x2722, "fourTeardropSpokedAsterisk"],
  [0x2733, "eightSpokedAsterisk"],
  [0x2736, "sixPointedBlackStar"],
  [0x273b, "teardropSpokedAsterisk"],
  [0x273d, "heavyTeardropSpokedAsterisk"],
];

const SIZE = 24; // the viewBox every frame is drawn in
const font = readFont("C:/Windows/Fonts/seguisym.ttf");
console.log(`unitsPerEm=${font.unitsPerEm} numGlyphs=${font.numGlyphs}`);

// First pass: read every outline and find the largest extent among them.
const glyphs = FRAMES.map(([cp, name]) => {
  const id = glyphIdFor(font, cp);
  const contours = glyphContours(font, id);
  if (contours.length === 0) throw new Error(`no outline for U+${cp.toString(16)}`);

  const points = contours.flat();
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  return { cp, name, id, contours, minX, maxX, minY, maxY };
});

const widest = Math.max(...glyphs.map((g) => Math.max(g.maxX - g.minX, g.maxY - g.minY)));
// A little breathing room, so the largest frame does not touch the viewBox.
const k = (SIZE * 0.94) / widest;

const f = (n) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/** One glyph to a path, on the shared scale, centred on its own ink. */
function toPath(g) {
  const cx = (g.minX + g.maxX) / 2;
  const cy = (g.minY + g.maxY) / 2;
  const X = (x) => f((x - cx) * k + SIZE / 2);
  // Font y points up, SVG y points down.
  const Y = (y) => f(SIZE / 2 - (y - cy) * k);

  const parts = [];
  for (const contour of g.contours) {
    if (contour.length === 0) continue;

    let points = contour;
    if (!points[0].onCurve) {
      const last = points[points.length - 1];
      const first = points[0];
      points = [
        last.onCurve
          ? last
          : { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, onCurve: true },
        ...points,
      ];
    }

    parts.push(`M${X(points[0].x)} ${Y(points[0].y)}`);
    for (let i = 1; i <= points.length; i++) {
      const p = points[i % points.length];
      if (p.onCurve) {
        parts.push(`L${X(p.x)} ${Y(p.y)}`);
        continue;
      }
      const next = points[(i + 1) % points.length];
      const end = next.onCurve ? next : { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
      parts.push(`Q${X(p.x)} ${Y(p.y)} ${X(end.x)} ${Y(end.y)}`);
      if (next.onCurve) i++;
    }
    parts.push("Z");
  }
  return parts.join("");
}

const out = glyphs.map((g) => {
  const d = toPath(g);
  const extent = Math.max(g.maxX - g.minX, g.maxY - g.minY);
  console.log(
    `U+${g.cp.toString(16).toUpperCase().padStart(4, "0")} ${g.name.padEnd(30)}` +
      ` contours=${g.contours.length} extent=${(extent * k).toFixed(1)}/${SIZE} chars=${d.length}`,
  );
  return { ...g, d };
});

// A contact sheet beside the script, so the shapes can be checked by eye
// against a screenshot of the terminal before anyone trusts them.
const sheet = out
  .map(
    (g, i) =>
      `<g transform="translate(${i * 30} 0)">` +
      `<rect width="24" height="24" fill="#111"/>` +
      `<path d="${g.d}" fill="#ff7a45"/></g>`,
  )
  .join("");

const here = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(
  path.join(here, "spinner-sheet.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${out.length * 30} 24">${sheet}</svg>`,
);

// The module the app imports. Its header — the explanation of where these came
// from and why — is kept and re-used, so regenerating never silently drops it.
const target = path.join(here, "..", "src", "design", "claudeSpinner.ts");
const labels = {
  interpunct: "· U+00B7 — interpunct",
  fourTeardropSpokedAsterisk: "✢ U+2722 — four teardrop-spoked asterisk",
  eightSpokedAsterisk: "✳ U+2733 — eight-spoked asterisk",
  sixPointedBlackStar: "✶ U+2736 — six pointed black star",
  teardropSpokedAsterisk: "✻ U+273B — teardrop-spoked asterisk",
  heavyTeardropSpokedAsterisk: "✽ U+273D — heavy teardrop-spoked asterisk",
};

const existing = fs.readFileSync(target, "utf8");
const header = existing.split("export const CLAUDE_SPINNER_FRAMES")[0];
const interval = existing.slice(existing.indexOf("/**\n * Milliseconds per frame."));
const body = out.map((g) => `  // ${labels[g.name]}\n  "${g.d}",`).join("\n");

fs.writeFileSync(
  target,
  `${header}export const CLAUDE_SPINNER_FRAMES: readonly string[] = [\n${body}\n];\n\n${interval}`,
);

console.log(`\nwrote ${path.relative(process.cwd(), target)}`);
console.log("wrote scripts/spinner-sheet.svg");
