import { alpha, blue, green, red, rgba, withAlpha, type RGBA } from '../raster/color';
import type { PixelBuffer } from '../raster/pixel-buffer';

/** Colour → number of pixels. Fully transparent pixels are ignored. */
export function countColors(images: Iterable<PixelBuffer>): Map<RGBA, number> {
  const out = new Map<RGBA, number>();
  for (const img of images) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const c = ((d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!) >>> 0;
      out.set(c, (out.get(c) ?? 0) + 1);
    }
  }
  return out;
}

/** Squared distance weighted for perceived brightness ("redmean"). */
export function perceptualDistance(a: RGBA, b: RGBA): number {
  const rm = (red(a) + red(b)) / 2;
  const dr = red(a) - red(b);
  const dg = green(a) - green(b);
  const db = blue(a) - blue(b);
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/** Nearest palette colour, keeping the source alpha (palettes are opaque). */
export function nearestColor(c: RGBA, palette: readonly RGBA[]): RGBA {
  if (alpha(c) === 0 || palette.length === 0) return c;
  let best = palette[0]!;
  let bd = Infinity;
  for (const p of palette) {
    const d = perceptualDistance(c, p);
    if (d < bd) {
      bd = d;
      best = p;
      if (d === 0) break;
    }
  }
  return withAlpha(best, alpha(c));
}

/** Colours used in the images that are not in the palette (alpha ignored). */
export function outOfPalette(used: Iterable<RGBA>, palette: readonly RGBA[]): RGBA[] {
  const set = new Set(palette.map((c) => withAlpha(c, 255)));
  const out: RGBA[] = [];
  for (const c of used) if (!set.has(withAlpha(c, 255))) out.push(c);
  return out;
}

/** Indices of colours that repeat an earlier entry. */
export function duplicateIndices(palette: readonly RGBA[]): number[] {
  const seen = new Set<RGBA>();
  const out: number[] = [];
  palette.forEach((c, i) => {
    if (seen.has(c)) out.push(i);
    else seen.add(c);
  });
  return out;
}

interface Box {
  colors: { c: RGBA; n: number }[];
}

function channelRange(b: Box): { ch: 0 | 1 | 2; range: number } {
  let best: { ch: 0 | 1 | 2; range: number } = { ch: 0, range: -1 };
  for (const ch of [0, 1, 2] as const) {
    let lo = 255;
    let hi = 0;
    for (const { c } of b.colors) {
      const v = ch === 0 ? red(c) : ch === 1 ? green(c) : blue(c);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo > best.range) best = { ch, range: hi - lo };
  }
  return best;
}

/**
 * Median-cut quantisation of the opaque colours to at most `max` colours.
 * Deterministic: the same input always gives the same palette.
 */
export function medianCut(counts: Map<RGBA, number>, max: number): RGBA[] {
  const all = [...counts.entries()].map(([c, n]) => ({ c: withAlpha(c, 255), n }));
  const merged = new Map<RGBA, number>();
  for (const { c, n } of all) merged.set(c, (merged.get(c) ?? 0) + n);
  const entries = [...merged.entries()].map(([c, n]) => ({ c, n })).sort((a, b) => a.c - b.c);
  if (entries.length <= max) return entries.map((e) => e.c);
  const boxes: Box[] = [{ colors: entries }];
  while (boxes.length < max) {
    let idx = -1;
    let score = 0;
    boxes.forEach((b, i) => {
      if (b.colors.length < 2) return;
      const s = channelRange(b).range * Math.sqrt(b.colors.reduce((a, e) => a + e.n, 0));
      if (s > score) {
        score = s;
        idx = i;
      }
    });
    if (idx < 0) break;
    const box = boxes[idx]!;
    const { ch } = channelRange(box);
    const key = (c: RGBA): number => (ch === 0 ? red(c) : ch === 1 ? green(c) : blue(c));
    const sorted = [...box.colors].sort((a, b) => key(a.c) - key(b.c) || a.c - b.c);
    const total = sorted.reduce((a, e) => a + e.n, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i]!.n;
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
      cut = i + 1;
    }
    boxes.splice(idx, 1, { colors: sorted.slice(0, cut) }, { colors: sorted.slice(cut) });
  }
  return boxes.map((b) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    let n = 0;
    for (const { c, n: k } of b.colors) {
      r += red(c) * k;
      g += green(c) * k;
      bl += blue(c) * k;
      n += k;
    }
    return rgba(Math.round(r / n), Math.round(g / n), Math.round(bl / n));
  });
}
