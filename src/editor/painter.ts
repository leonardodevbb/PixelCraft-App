import { blendPixel } from '../raster/blend';
import { type RGBA } from '../raster/color';
import type { PixelBuffer } from '../raster/pixel-buffer';
import { brushFootprint, type BrushShape } from '../raster/shapes';
import type { Point, Rect } from '../raster/rect';
import type { SymmetrySettings } from '../project/model';
import { isSelected, type Selection } from './selection';

export type PaintMode = 'replace' | 'over';

export interface PainterOptions {
  color: RGBA;
  size: number;
  shape: BrushShape;
  mode: PaintMode;
  /** 0..1, only used in 'over' mode. */
  opacity: number;
  selection: Selection | null;
  symmetry: SymmetrySettings | null;
}

/**
 * Writes pixels into a buffer for one stroke or shape. Each pixel is painted
 * at most once per stroke, so semi-transparent strokes do not darken where
 * the pointer passes twice, and the dirty rectangle is tracked for redraws.
 */
export class Painter {
  private touched: Uint8Array;
  private footprint: Point[];
  dirty: Rect | null = null;

  constructor(
    private readonly target: PixelBuffer,
    private readonly opts: PainterOptions,
  ) {
    this.touched = new Uint8Array(target.width * target.height);
    this.footprint = brushFootprint(opts.size, opts.shape);
  }

  /** Forgets which pixels were painted (used when a shape preview restarts). */
  reset(): void {
    this.touched.fill(0);
    this.dirty = null;
  }

  /** Paints the brush footprint centred on (x, y), plus symmetric copies. */
  stamp = (x: number, y: number): void => {
    for (const p of this.mirrored(x, y)) for (const o of this.footprint) this.pixel(p.x + o.x, p.y + o.y);
  };

  /** Paints exactly one pixel, plus symmetric copies (ignores brush size). */
  dot = (x: number, y: number): void => {
    for (const p of this.mirrored(x, y)) this.pixel(p.x, p.y);
  };

  private mirrored(x: number, y: number): Point[] {
    const s = this.opts.symmetry;
    const pts: Point[] = [{ x, y }];
    if (!s) return pts;
    // Mirror around the axis: a pixel at x maps to (2*axis - 1 - x).
    if (s.vertical) pts.push({ x: Math.round(2 * s.axisX - 1 - x), y });
    if (s.horizontal) {
      for (const p of [...pts]) pts.push({ x: p.x, y: Math.round(2 * s.axisY - 1 - p.y) });
    }
    return pts;
  }

  private pixel(x: number, y: number): void {
    const t = this.target;
    if (x < 0 || y < 0 || x >= t.width || y >= t.height) return;
    const idx = y * t.width + x;
    if (this.touched[idx]) return;
    if (!isSelected(this.opts.selection, x, y)) return;
    this.touched[idx] = 1;
    const c = this.opts.color;
    const i = idx * 4;
    const d = t.data;
    if (this.opts.mode === 'replace') {
      d[i] = c >>> 24;
      d[i + 1] = (c >>> 16) & 255;
      d[i + 2] = (c >>> 8) & 255;
      d[i + 3] = c & 255;
    } else {
      blendPixel(d, i, c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255, this.opts.opacity, 'normal');
    }
    const r = this.dirty;
    if (!r) this.dirty = { x, y, w: 1, h: 1 };
    else {
      if (x < r.x) {
        r.w += r.x - x;
        r.x = x;
      } else if (x >= r.x + r.w) r.w = x - r.x + 1;
      if (y < r.y) {
        r.h += r.y - y;
        r.y = y;
      } else if (y >= r.y + r.h) r.h = y - r.y + 1;
    }
  }
}
