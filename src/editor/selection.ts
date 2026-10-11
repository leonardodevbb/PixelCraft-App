import type { Rect } from '../raster/rect';

/**
 * A pixel selection: a bounding rectangle plus a per-pixel mask (1 = selected)
 * covering that rectangle. Rectangular selections have a full mask.
 */
export interface Selection {
  bounds: Rect;
  mask: Uint8Array;
}

export function rectSelection(r: Rect): Selection {
  return { bounds: { ...r }, mask: new Uint8Array(r.w * r.h).fill(1) };
}

export function isSelected(sel: Selection | null, x: number, y: number): boolean {
  if (!sel) return true;
  const { bounds: b, mask } = sel;
  if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return false;
  return mask[(y - b.y) * b.w + (x - b.x)] === 1;
}
