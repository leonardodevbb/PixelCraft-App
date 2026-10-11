import { alpha, blue, green, red, rgba, type RGBA } from './color';
import type { Point } from './rect';

export type GradientShape = 'linear' | 'radial';
export type DitherMode = 'none' | 'bayer2' | 'bayer4' | 'bayer8';

export const DITHER_LABELS: Record<DitherMode, string> = {
  none: 'Suave (sem pontilhado)',
  bayer2: 'Pontilhado 2×2',
  bayer4: 'Pontilhado 4×4',
  bayer8: 'Pontilhado 8×8',
};

/** Builds a normalized ordered-dither (Bayer) matrix of size n×n (n = 2^k). */
function bayer(n: number): Float32Array {
  let m = [0];
  let size = 1;
  while (size < n) {
    const next = new Array<number>(size * 2 * size * 2);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = m[y * size + x]! * 4;
        const w = size * 2;
        next[y * w + x] = v;
        next[y * w + x + size] = v + 2;
        next[(y + size) * w + x] = v + 3;
        next[(y + size) * w + x + size] = v + 1;
      }
    m = next;
    size *= 2;
  }
  // Thresholds in (0, 1): (v + 0.5) / n².
  return Float32Array.from(m, (v) => (v + 0.5) / (n * n));
}

const MATRICES: Record<Exclude<DitherMode, 'none'>, { n: number; m: Float32Array }> = {
  bayer2: { n: 2, m: bayer(2) },
  bayer4: { n: 4, m: bayer(4) },
  bayer8: { n: 8, m: bayer(8) },
};

/** Position along the gradient (0 at `a`, 1 at `b`), clamped. */
export function gradientT(shape: GradientShape, a: Point, b: Point, x: number, y: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  let t: number;
  if (shape === 'radial') t = Math.hypot(x - a.x, y - a.y) / Math.sqrt(len2);
  else t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerp(c1: RGBA, c2: RGBA, t: number): RGBA {
  const m = (u: number, v: number): number => Math.round(u + (v - u) * t);
  return rgba(m(red(c1), red(c2)), m(green(c1), green(c2)), m(blue(c1), blue(c2)), m(alpha(c1), alpha(c2)));
}

/**
 * Color of the gradient at pixel (x, y). With dithering the result is always
 * exactly `c1` or `c2` (no new colors), which keeps palettes intact.
 */
export function gradientColor(shape: GradientShape, dither: DitherMode, a: Point, b: Point, c1: RGBA, c2: RGBA, x: number, y: number): RGBA {
  // Sample at the pixel centre so a drag from pixel A to pixel B is symmetric.
  const t = gradientT(shape, a, b, x, y);
  if (dither === 'none') return lerp(c1, c2, t);
  const { n, m } = MATRICES[dither];
  const th = m[(((y % n) + n) % n) * n + (((x % n) + n) % n)]!;
  return t > th ? c2 : c1;
}
