import { type PixelBuffer } from '../raster/pixel-buffer';
import type { Rect } from '../raster/rect';

export interface SliceOptions {
  frameWidth: number;
  frameHeight: number;
  /** Space before the first cell. */
  offsetX: number;
  offsetY: number;
  /** Space between cells. */
  gapX: number;
  gapY: number;
  /** 0 = as many as fit. */
  columns: number;
  rows: number;
  skipEmpty: boolean;
}

/** Cell rectangles for a spritesheet, row by row, only cells fully inside the image. */
export function sliceRects(width: number, height: number, o: SliceOptions): Rect[] {
  if (o.frameWidth < 1 || o.frameHeight < 1) return [];
  const fitCols = Math.floor((width - o.offsetX + o.gapX) / (o.frameWidth + o.gapX));
  const fitRows = Math.floor((height - o.offsetY + o.gapY) / (o.frameHeight + o.gapY));
  const cols = Math.max(0, o.columns > 0 ? Math.min(o.columns, fitCols) : fitCols);
  const rows = Math.max(0, o.rows > 0 ? Math.min(o.rows, fitRows) : fitRows);
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push({ x: o.offsetX + c * (o.frameWidth + o.gapX), y: o.offsetY + r * (o.frameHeight + o.gapY), w: o.frameWidth, h: o.frameHeight });
  return out;
}

export function sliceSheet(img: PixelBuffer, o: SliceOptions): PixelBuffer[] {
  const frames = sliceRects(img.width, img.height, o).map((r) => img.extract(r));
  return o.skipEmpty ? frames.filter((f) => !f.isEmpty()) : frames;
}

/**
 * Guesses a cell size: the most common gap-free square size that divides the
 * image, or the image height for horizontal strips.
 */
export function guessCellSize(width: number, height: number): { w: number; h: number } {
  if (width > height && width % height === 0) return { w: height, h: height };
  if (height > width && height % width === 0) return { w: width, h: width };
  for (const s of [64, 48, 32, 24, 16, 8]) if (width % s === 0 && height % s === 0 && width / s <= 64 && height / s <= 64) return { w: s, h: s };
  return { w: width, h: height };
}
