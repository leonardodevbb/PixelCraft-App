import { PixelBuffer } from './pixel-buffer';
import type { Point } from './rect';

/**
 * Scale2x / EPX magnification: doubles the image, rounding staircase edges
 * instead of making blocks. It never invents colours, which is what makes it
 * a good base for RotSprite.
 */
export function scale2x(src: PixelBuffer): PixelBuffer {
  const w = src.width;
  const h = src.height;
  const out = new PixelBuffer(w * 2, h * 2);
  const s = new Uint32Array(src.data.buffer, src.data.byteOffset, w * h);
  const d = new Uint32Array(out.data.buffer, out.data.byteOffset, w * h * 4);
  const at = (x: number, y: number): number => s[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  const ow = w * 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const e = s[y * w + x]!;
      const b = at(x, y - 1);
      const dd = at(x - 1, y);
      const f = at(x + 1, y);
      const hh = at(x, y + 1);
      const o = y * 2 * ow + x * 2;
      d[o] = dd === b && b !== f && dd !== hh ? dd : e;
      d[o + 1] = b === f && b !== dd && f !== hh ? f : e;
      d[o + ow] = dd === hh && dd !== b && hh !== f ? dd : e;
      d[o + ow + 1] = hh === f && dd !== hh && b !== f ? f : e;
    }
  return out;
}

export type TransformAlgorithm = 'nearest' | 'rotsprite';

export const TRANSFORM_ALGORITHM_LABELS: Record<TransformAlgorithm, string> = {
  nearest: 'Pixels exatos (vizinho mais próximo)',
  rotsprite: 'RotSprite (bordas suaves em rotações)',
};

/** Above this many source pixels RotSprite falls back to nearest (memory: 64× the piece). */
export const ROTSPRITE_MAX_PIXELS = 256 * 256;

/**
 * Placement of a piece: its centre in document coordinates, scale factors and
 * rotation in degrees (clockwise, as on screen with y pointing down).
 */
export interface Placement {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  angle: number;
}

/** Corners of the transformed piece (top-left, top-right, bottom-right, bottom-left). */
export function placementCorners(w: number, h: number, p: Placement): Point[] {
  const rad = (p.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = (w * p.sx) / 2;
  const hh = (h * p.sy) / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({ x: p.cx + x! * cos - y! * sin, y: p.cy + x! * sin + y! * cos }));
}

/**
 * Renders a piece with a placement. Returns the image and its top-left in
 * document coordinates. Each output pixel samples the source at its centre
 * (inverse mapping), so there are never holes; an identity placement on a
 * pixel-aligned centre reproduces the piece exactly.
 */
export function renderPlacement(src: PixelBuffer, p: Placement, algorithm: TransformAlgorithm = 'nearest'): { buffer: PixelBuffer; x: number; y: number } {
  const w = src.width;
  const h = src.height;
  const eps = 1e-6;
  const corners = placementCorners(w, h, p);
  // Snap the centre so the output box lands on whole pixels: a 3×2 piece
  // rotated 90° becomes exactly 2×3 instead of straddling pixel edges.
  const bw = Math.max(1, Math.round(Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x)) - eps));
  const bh = Math.max(1, Math.round(Math.max(...corners.map((c) => c.y)) - Math.min(...corners.map((c) => c.y)) - eps));
  const x0 = Math.round(p.cx - bw / 2 + eps);
  const y0 = Math.round(p.cy - bh / 2 + eps);
  p = { ...p, cx: x0 + bw / 2, cy: y0 + bh / 2 };
  const out = new PixelBuffer(bw, bh);
  if (!out.width || !out.height || !w || !h) return { buffer: out, x: x0, y: y0 };
  const useRot = algorithm === 'rotsprite' && w * h <= ROTSPRITE_MAX_PIXELS && p.angle % 90 !== 0;
  const k = useRot ? 8 : 1;
  const sample = useRot ? scale2x(scale2x(scale2x(src))) : src;
  const sw = sample.width;
  const sh = sample.height;
  const s32 = new Uint32Array(sample.data.buffer, sample.data.byteOffset, sw * sh);
  const o32 = new Uint32Array(out.data.buffer, out.data.byteOffset, out.width * out.height);
  const rad = (p.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      const dx = x0 + x + 0.5 - p.cx;
      const dy = y0 + y + 0.5 - p.cy;
      // Inverse rotation, then inverse scale, into source pixel units.
      const u = (dx * cos + dy * sin) / p.sx + w / 2;
      const v = (-dx * sin + dy * cos) / p.sy + h / 2;
      const sx = Math.floor(u * k + eps);
      const sy = Math.floor(v * k + eps);
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
      o32[y * out.width + x] = s32[sy * sw + sx]!;
    }
  return { buffer: out, x: x0, y: y0 };
}
