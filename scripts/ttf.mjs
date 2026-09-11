// A small TrueType reader: enough of it to pull one glyph's real outline out
// of a font and write it as an SVG path.
//
// Only what is needed — head, maxp, cmap (formats 4 and 12), loca, glyf,
// including composite glyphs. Quadratic curves are kept as quadratics, which
// is what `glyf` stores and what SVG's `Q` command takes, so nothing is
// approximated on the way through.
import fs from "node:fs";

export function readFont(path) {
  const buf = fs.readFileSync(path);
  const version = buf.readUInt32BE(0);
  if (version === 0x4f54544f) throw new Error("CFF/OTTO font — glyf parser cannot read it");
  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new Error(`not a TrueType font (version 0x${version.toString(16)})`);
  }

  const numTables = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    const tag = buf.toString("ascii", at, at + 4);
    tables[tag] = { offset: buf.readUInt32BE(at + 8), length: buf.readUInt32BE(at + 12) };
  }
  for (const need of ["head", "maxp", "cmap", "loca", "glyf"]) {
    if (!tables[need]) throw new Error(`font has no ${need} table`);
  }

  const head = tables.head.offset;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const indexToLocFormat = buf.readInt16BE(head + 50);
  const numGlyphs = buf.readUInt16BE(tables.maxp.offset + 4);

  return { buf, tables, unitsPerEm, indexToLocFormat, numGlyphs };
}

/** Unicode code point -> glyph id, via the best cmap subtable available. */
export function glyphIdFor(font, codePoint) {
  const { buf, tables } = font;
  const cmap = tables.cmap.offset;
  const numSubtables = buf.readUInt16BE(cmap + 2);

  let best = null;
  for (let i = 0; i < numSubtables; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    const offset = cmap + buf.readUInt32BE(rec + 4);
    const format = buf.readUInt16BE(offset);
    // Windows Unicode BMP (3,1) or full repertoire (3,10); prefer the latter.
    const score = platform === 3 && encoding === 10 ? 3 : platform === 3 && encoding === 1 ? 2 : 1;
    if ((format === 4 || format === 12) && (!best || score > best.score)) {
      best = { offset, format, score };
    }
  }
  if (!best) throw new Error("no usable cmap subtable");

  return best.format === 4
    ? lookupFormat4(buf, best.offset, codePoint)
    : lookupFormat12(buf, best.offset, codePoint);
}

function lookupFormat4(buf, at, cp) {
  if (cp > 0xffff) return 0;
  const segCountX2 = buf.readUInt16BE(at + 6);
  const segCount = segCountX2 / 2;
  const ends = at + 14;
  const starts = ends + segCountX2 + 2;
  const deltas = starts + segCountX2;
  const ranges = deltas + segCountX2;

  for (let s = 0; s < segCount; s++) {
    if (cp > buf.readUInt16BE(ends + s * 2)) continue;
    const start = buf.readUInt16BE(starts + s * 2);
    if (cp < start) return 0;

    const delta = buf.readInt16BE(deltas + s * 2);
    const rangeOffset = buf.readUInt16BE(ranges + s * 2);
    if (rangeOffset === 0) return (cp + delta) & 0xffff;

    const glyphAt = ranges + s * 2 + rangeOffset + (cp - start) * 2;
    const id = buf.readUInt16BE(glyphAt);
    return id === 0 ? 0 : (id + delta) & 0xffff;
  }
  return 0;
}

function lookupFormat12(buf, at, cp) {
  const nGroups = buf.readUInt32BE(at + 12);
  for (let g = 0; g < nGroups; g++) {
    const rec = at + 16 + g * 12;
    const start = buf.readUInt32BE(rec);
    const end = buf.readUInt32BE(rec + 4);
    if (cp >= start && cp <= end) return buf.readUInt32BE(rec + 8) + (cp - start);
  }
  return 0;
}

function glyphRange(font, id) {
  const { buf, tables, indexToLocFormat } = font;
  const loca = tables.loca.offset;
  const [from, to] =
    indexToLocFormat === 0
      ? [buf.readUInt16BE(loca + id * 2) * 2, buf.readUInt16BE(loca + id * 2 + 2) * 2]
      : [buf.readUInt32BE(loca + id * 4), buf.readUInt32BE(loca + id * 4 + 4)];
  return from === to ? null : [tables.glyf.offset + from, tables.glyf.offset + to];
}

/**
 * A glyph's contours, in font units, y still pointing up.
 *
 * Each contour is a list of {x, y, onCurve} points, exactly as `glyf` stores
 * them — the conversion to path commands happens in `toPath`, where the
 * implied on-curve midpoints between consecutive off-curve points are
 * inserted.
 */
export function glyphContours(font, id, depth = 0) {
  if (depth > 5) return [];
  const range = glyphRange(font, id);
  if (!range) return [];

  const { buf } = font;
  const [start] = range;
  const numberOfContours = buf.readInt16BE(start);

  if (numberOfContours < 0) return compositeContours(font, start, depth);

  const endPts = [];
  for (let i = 0; i < numberOfContours; i++) {
    endPts.push(buf.readUInt16BE(start + 10 + i * 2));
  }
  const numPoints = numberOfContours === 0 ? 0 : endPts[endPts.length - 1] + 1;

  let at = start + 10 + numberOfContours * 2;
  at += 2 + buf.readUInt16BE(at); // skip instructions

  const flags = [];
  while (flags.length < numPoints) {
    const flag = buf.readUInt8(at++);
    flags.push(flag);
    if (flag & 8) {
      let repeat = buf.readUInt8(at++);
      while (repeat-- > 0) flags.push(flag);
    }
  }

  const readCoords = (shortBit, sameBit) => {
    const values = [];
    let value = 0;
    for (const flag of flags) {
      if (flag & shortBit) {
        const delta = buf.readUInt8(at++);
        value += flag & sameBit ? delta : -delta;
      } else if (!(flag & sameBit)) {
        value += buf.readInt16BE(at);
        at += 2;
      }
      values.push(value);
    }
    return values;
  };

  const xs = readCoords(2, 16);
  const ys = readCoords(4, 32);

  const contours = [];
  let from = 0;
  for (const end of endPts) {
    const points = [];
    for (let i = from; i <= end; i++) {
      points.push({ x: xs[i], y: ys[i], onCurve: (flags[i] & 1) !== 0 });
    }
    contours.push(points);
    from = end + 1;
  }
  return contours;
}

function compositeContours(font, start, depth) {
  const { buf } = font;
  let at = start + 10;
  const all = [];

  for (;;) {
    const flags = buf.readUInt16BE(at);
    const glyphIndex = buf.readUInt16BE(at + 2);
    at += 4;

    let dx, dy;
    if (flags & 1) {
      dx = buf.readInt16BE(at);
      dy = buf.readInt16BE(at + 2);
      at += 4;
    } else {
      dx = buf.readInt8(at);
      dy = buf.readInt8(at + 1);
      at += 2;
    }

    // Scaling, when present. F2Dot14 fixed point.
    let a = 1, b = 0, c = 0, d = 1;
    const f2dot14 = (o) => buf.readInt16BE(o) / 16384;
    if (flags & 8) {
      a = d = f2dot14(at);
      at += 2;
    } else if (flags & 0x40) {
      a = f2dot14(at);
      d = f2dot14(at + 2);
      at += 4;
    } else if (flags & 0x80) {
      a = f2dot14(at);
      b = f2dot14(at + 2);
      c = f2dot14(at + 4);
      d = f2dot14(at + 6);
      at += 8;
    }

    for (const contour of glyphContours(font, glyphIndex, depth + 1)) {
      all.push(
        contour.map((p) => ({
          x: a * p.x + c * p.y + dx,
          y: b * p.x + d * p.y + dy,
          onCurve: p.onCurve,
        })),
      );
    }

    if (!(flags & 0x20)) break; // MORE_COMPONENTS
  }
  return all;
}

/**
 * Contours to an SVG path, scaled into `size` and flipped (font y is up, SVG y
 * is down), centred on the glyph's own ink rather than on its advance width —
 * the mark is what should sit in the middle, not its typographic box.
 */
export function toPath(contours, size, decimals = 2) {
  const all = contours.flat();
  if (all.length === 0) return { d: "", box: null };

  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const k = size / span;

  const ox = (size - (maxX - minX) * k) / 2;
  const oy = (size - (maxY - minY) * k) / 2;
  const f = (n) => {
    const r = Math.round(n * 10 ** decimals) / 10 ** decimals;
    return Object.is(r, -0) ? 0 : r;
  };
  const X = (x) => f((x - minX) * k + ox);
  const Y = (y) => f(size - ((y - minY) * k + oy)); // flip

  const parts = [];
  for (const contour of contours) {
    if (contour.length === 0) continue;

    // A contour may begin on an off-curve point; start from the implied
    // midpoint so the first command has somewhere to come from.
    let points = contour;
    if (!points[0].onCurve) {
      const last = points[points.length - 1];
      const first = points[0];
      const startPoint = last.onCurve
        ? last
        : { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, onCurve: true };
      points = [startPoint, ...points];
    }

    parts.push(`M${X(points[0].x)} ${Y(points[0].y)}`);

    for (let i = 1; i <= points.length; i++) {
      const point = points[i % points.length];
      if (point.onCurve) {
        parts.push(`L${X(point.x)} ${Y(point.y)}`);
        continue;
      }

      // An off-curve control point. Its end point is the next on-curve point,
      // or the midpoint to the next control point when two curves run together.
      const next = points[(i + 1) % points.length];
      const end = next.onCurve ? next : { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
      parts.push(`Q${X(point.x)} ${Y(point.y)} ${X(end.x)} ${Y(end.y)}`);
      if (next.onCurve) i++;
    }
    parts.push("Z");
  }

  return { d: parts.join(""), box: { minX, maxX, minY, maxY } };
}
