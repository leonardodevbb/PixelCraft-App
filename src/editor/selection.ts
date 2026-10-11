import { colorDistance, type RGBA } from '../raster/color';
import type { PixelBuffer } from '../raster/pixel-buffer';
import { type Point, type Rect, intersectRect, rectIsEmpty } from '../raster/rect';
import { ellipseFilled } from '../raster/shapes';

/**
 * A pixel selection: a bounding rectangle plus a per-pixel mask (1 = selected)
 * covering that rectangle. Selections are values; operations return new ones.
 */
export interface Selection {
  bounds: Rect;
  mask: Uint8Array;
}

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

export function rectSelection(r: Rect): Selection {
  return { bounds: { ...r }, mask: new Uint8Array(Math.max(0, r.w * r.h)).fill(1) };
}

/** Pixels of the ellipse inscribed in the rectangle (same raster as the ellipse tool). */
export function ellipseSelection(r: Rect): Selection {
  const mask = new Uint8Array(Math.max(0, r.w * r.h));
  ellipseFilled(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1, (x, y) => {
    const i = (y - r.y) * r.w + (x - r.x);
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) mask[i] = 1;
  });
  return { bounds: { ...r }, mask };
}

export function isSelected(sel: Selection | null, x: number, y: number): boolean {
  if (!sel) return true;
  const { bounds: b, mask } = sel;
  if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return false;
  return mask[(y - b.y) * b.w + (x - b.x)] === 1;
}

export function selectionArea(sel: Selection): number {
  let n = 0;
  for (const v of sel.mask) n += v;
  return n;
}

/** Shrinks bounds to the selected pixels; returns null for an empty selection. */
export function trimSelection(sel: Selection): Selection | null {
  const { bounds: b, mask } = sel;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++)
      if (mask[y * b.w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  if (x1 < 0) return null;
  const nb = { x: b.x + x0, y: b.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  if (nb.w === b.w && nb.h === b.h) return sel;
  const out = new Uint8Array(nb.w * nb.h);
  for (let y = 0; y < nb.h; y++) for (let x = 0; x < nb.w; x++) out[y * nb.w + x] = mask[(y + y0) * b.w + x + x0]!;
  return { bounds: nb, mask: out };
}

/** Restricts a selection to the document area. */
export function clipSelection(sel: Selection, width: number, height: number): Selection | null {
  const clip = intersectRect(sel.bounds, { x: 0, y: 0, w: width, h: height });
  if (rectIsEmpty(clip)) return null;
  const out = new Uint8Array(clip.w * clip.h);
  const b = sel.bounds;
  for (let y = 0; y < clip.h; y++)
    for (let x = 0; x < clip.w; x++) out[y * clip.w + x] = sel.mask[(y + clip.y - b.y) * b.w + (x + clip.x - b.x)]!;
  return trimSelection({ bounds: clip, mask: out });
}

/** Combines two selections. `null` as `base` means "nothing selected". */
export function combineSelections(base: Selection | null, add: Selection, mode: SelectionMode): Selection | null {
  if (mode === 'replace') return trimSelection(add);
  if (!base) return mode === 'add' ? trimSelection(add) : null;
  const x0 = Math.min(base.bounds.x, add.bounds.x);
  const y0 = Math.min(base.bounds.y, add.bounds.y);
  const x1 = Math.max(base.bounds.x + base.bounds.w, add.bounds.x + add.bounds.w);
  const y1 = Math.max(base.bounds.y + base.bounds.h, add.bounds.y + add.bounds.h);
  const bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const mask = new Uint8Array(bounds.w * bounds.h);
  for (let y = 0; y < bounds.h; y++)
    for (let x = 0; x < bounds.w; x++) {
      const a = isSelected(base, x + x0, y + y0);
      const b = isSelected(add, x + x0, y + y0);
      const v = mode === 'add' ? a || b : mode === 'subtract' ? a && !b : a && b;
      mask[y * bounds.w + x] = v ? 1 : 0;
    }
  return trimSelection({ bounds, mask });
}

export function invertSelection(sel: Selection | null, width: number, height: number): Selection | null {
  const bounds = { x: 0, y: 0, w: width, h: height };
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mask[y * width + x] = isSelected(sel, x, y) && sel ? 0 : 1;
  return trimSelection({ bounds, mask });
}

export function translateSelection(sel: Selection, dx: number, dy: number): Selection {
  return { bounds: { ...sel.bounds, x: sel.bounds.x + dx, y: sel.bounds.y + dy }, mask: sel.mask };
}

/**
 * Freehand/polygon lasso: pixels whose centre lies inside the polygon, plus
 * every pixel the outline passes through (so thin shapes are never empty).
 */
export function polygonSelection(points: Point[]): Selection | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const bx = Math.min(...xs);
  const by = Math.min(...ys);
  const bounds = { x: bx, y: by, w: Math.max(...xs) - bx + 1, h: Math.max(...ys) - by + 1 };
  const mask = new Uint8Array(bounds.w * bounds.h);
  const n = points.length;
  for (let y = 0; y < bounds.h; y++) {
    const cy = by + y + 0.5;
    const nodes: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = points[i]!;
      const b = points[j]!;
      const ay = a.y + 0.5;
      const byy = b.y + 0.5;
      if ((ay < cy && byy >= cy) || (byy < cy && ay >= cy)) nodes.push(a.x + 0.5 + ((cy - ay) / (byy - ay)) * (b.x - a.x));
    }
    nodes.sort((p, q) => p - q);
    for (let k = 0; k + 1 < nodes.length; k += 2) {
      const from = Math.max(0, Math.ceil(nodes[k]! - 0.5 - bx));
      const to = Math.min(bounds.w - 1, Math.floor(nodes[k + 1]! - 0.5 - bx));
      for (let x = from; x <= to; x++) mask[y * bounds.w + x] = 1;
    }
  }
  // Outline pixels
  const plot = (x: number, y: number): void => {
    mask[(y - by) * bounds.w + (x - bx)] = 1;
  };
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    lineSimple(a.x, a.y, b.x, b.y, plot);
  }
  return trimSelection({ bounds, mask });
}

function lineSimple(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export interface FloodOptions {
  /** 0..100, see colorDistance. */
  tolerance: number;
  /** Only pixels connected to the seed (4-neighbourhood) vs. all similar pixels. */
  contiguous: boolean;
  /** Fill/selection is limited to this selection. */
  limit?: Selection | null;
  /** Abort above this many pixels (protects against freezing on huge documents). */
  maxPixels?: number;
}

/**
 * Pixels similar to the colour at (sx, sy). Uses an explicit scanline stack
 * (no recursion), so large areas cannot overflow the call stack.
 */
export function floodMask(img: PixelBuffer, sx: number, sy: number, opts: FloodOptions): Selection | null {
  const { width: w, height: h } = img;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  if (w * h > (opts.maxPixels ?? 4096 * 4096)) throw new RangeError('Área grande demais para preencher.');
  const target: RGBA = img.get(sx, sy);
  const tol = opts.tolerance;
  const px = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h);
  // Packed little-endian ABGR → compare via the RGBA accessor only when tolerance > 0.
  const targetRaw = px[sy * w + sx]!;
  const targetTransparent = img.data[(sy * w + sx) * 4 + 3] === 0;
  const matches = (i: number): boolean => {
    const raw = px[i]!;
    if (raw === targetRaw) return true;
    if (targetTransparent && img.data[i * 4 + 3] === 0) return true;
    if (tol <= 0) return false;
    return colorDistance(img.get(i % w, (i / w) | 0), target) <= tol;
  };
  const allowed = (i: number): boolean => !opts.limit || isSelected(opts.limit, i % w, (i / w) | 0);
  const mask = new Uint8Array(w * h);
  if (!opts.contiguous) {
    for (let i = 0; i < w * h; i++) if (allowed(i) && matches(i)) mask[i] = 1;
    return trimSelection({ bounds: { x: 0, y: 0, w, h }, mask });
  }
  if (!allowed(sy * w + sx)) return null;
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let i = y * w + x;
    while (x > 0 && !mask[i - 1] && matches(i - 1) && allowed(i - 1)) {
      x--;
      i--;
    }
    let up = false;
    let down = false;
    for (; x < w; x++, i++) {
      if (mask[i] || !matches(i) || !allowed(i)) break;
      mask[i] = 1;
      if (y > 0) {
        const u = i - w;
        const ok = !mask[u] && matches(u) && allowed(u);
        if (ok && !up) {
          stack.push(x, y - 1);
          up = true;
        } else if (!ok) up = false;
      }
      if (y < h - 1) {
        const d = i + w;
        const ok = !mask[d] && matches(d) && allowed(d);
        if (ok && !down) {
          stack.push(x, y + 1);
          down = true;
        } else if (!ok) down = false;
      }
    }
  }
  return trimSelection({ bounds: { x: 0, y: 0, w, h }, mask });
}

/** Mask of non-transparent pixels of an image (e.g. "select layer content"). */
export function opaqueSelection(img: PixelBuffer): Selection | null {
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) mask[i] = img.data[i * 4 + 3] !== 0 ? 1 : 0;
  return trimSelection({ bounds: img.bounds, mask });
}
