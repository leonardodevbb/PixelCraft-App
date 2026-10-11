import { blendPixel } from '../raster/blend';
import { type RGBA } from '../raster/color';
import type { PixelBuffer } from '../raster/pixel-buffer';
import { brushFootprint, type BrushShape } from '../raster/shapes';
import type { Point, Rect } from '../raster/rect';
import type { SymmetrySettings } from '../project/model';
import { isSelected, type Selection } from './selection';

export type PaintMode = 'replace' | 'over';

/**
 * How a stroke changes the pixels it touches.
 *
 * - `simple`: paints the colour (replace or alpha-over, per `mode`).
 * - `lock-alpha`: only recolours pixels that already have content and keeps
 *   their transparency, so you can shade inside a shape without leaving it.
 * - `shading`: moves each touched colour one step along a colour ramp (the
 *   palette): towards the end with `shadeStep` 1, the start with -1. Pixels
 *   whose colour is not on the ramp are left alone.
 */
export type InkMode = 'simple' | 'lock-alpha' | 'shading';

export const INK_LABELS: Record<InkMode, string> = {
  simple: 'Normal',
  'lock-alpha': 'Travar transparência',
  shading: 'Sombreamento',
};

/** A brush made of coloured pixels (e.g. captured from a selection). */
export interface CustomBrush {
  /** Offsets from the pointer and the colour painted there. */
  pixels: { x: number; y: number; c: RGBA }[];
}

export interface PainterOptions {
  color: RGBA;
  size: number;
  shape: BrushShape;
  mode: PaintMode;
  /** 0..1, only used in 'over' mode. */
  opacity: number;
  selection: Selection | null;
  symmetry: SymmetrySettings | null;
  ink?: InkMode;
  /** Colour ramp for the shading ink, usually the document palette. */
  ramp?: readonly RGBA[];
  /** Direction along the ramp for the shading ink. */
  shadeStep?: 1 | -1;
  /** Replaces the size/shape footprint; each pixel keeps its own colour. */
  brush?: CustomBrush | null;
  /** Paints the custom brush's shape with `color` instead of its own colours. */
  tintBrush?: boolean;
  /** Pixels before the stroke, needed to undo single pixels (pixel-perfect). */
  original?: PixelBuffer;
}

/**
 * Writes pixels into a buffer for one stroke or shape. Each pixel is painted
 * at most once per stroke, so semi-transparent strokes do not darken where
 * the pointer passes twice, and the dirty rectangle is tracked for redraws.
 */
export class Painter {
  private touched: Uint8Array;
  private footprint: { x: number; y: number; c: RGBA | null }[];
  private rampIndex: Map<RGBA, number> | null = null;
  dirty: Rect | null = null;

  constructor(
    private readonly target: PixelBuffer,
    private opts: PainterOptions,
  ) {
    this.touched = new Uint8Array(target.width * target.height);
    this.footprint = opts.brush
      ? opts.brush.pixels.filter((p) => (p.c & 255) !== 0).map((p) => ({ x: p.x, y: p.y, c: opts.tintBrush ? null : p.c }))
      : brushFootprint(opts.size, opts.shape).map((p) => ({ ...p, c: null }));
    if (opts.ink === 'shading') {
      this.rampIndex = new Map();
      // First occurrence wins so duplicated palette entries do not break the ramp.
      (opts.ramp ?? []).forEach((c, i) => {
        if (!this.rampIndex!.has(c)) this.rampIndex!.set(c, i);
      });
    }
  }

  /** Changes the brush size mid-stroke (pen pressure). Custom brushes keep their shape. */
  setSize(size: number): void {
    const s = Math.max(1, Math.round(size));
    if (this.opts.brush || s === this.opts.size) return;
    this.opts.size = s;
    this.footprint = brushFootprint(s, this.opts.shape).map((p) => ({ ...p, c: null }));
  }

  /** Forgets which pixels were painted (used when a shape preview restarts). */
  reset(): void {
    this.touched.fill(0);
    this.dirty = null;
  }

  /** Paints the brush footprint centred on (x, y), plus symmetric copies. */
  stamp = (x: number, y: number): void => {
    for (const p of this.mirrored(x, y)) for (const o of this.footprint) this.pixel(p.x + o.x, p.y + o.y, o.c);
  };

  /** Paints exactly one pixel, plus symmetric copies (ignores brush size). */
  dot = (x: number, y: number): void => {
    for (const p of this.mirrored(x, y)) this.pixel(p.x, p.y, null);
  };

  /**
   * Restores the pixel (and its symmetric copies) to how it was before the
   * stroke and lets the stroke paint it again. Used by pixel-perfect strokes
   * to remove the corner pixel of an "L".
   */
  unstamp = (x: number, y: number): void => {
    const orig = this.opts.original;
    if (!orig) return;
    const t = this.target;
    for (const p of this.mirrored(x, y)) {
      if (!t.inBounds(p.x, p.y)) continue;
      t.set(p.x, p.y, orig.get(p.x, p.y));
      this.touched[p.y * t.width + p.x] = 0;
    }
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

  private pixel(x: number, y: number, own: RGBA | null): void {
    const t = this.target;
    if (x < 0 || y < 0 || x >= t.width || y >= t.height) return;
    const idx = y * t.width + x;
    if (this.touched[idx]) return;
    if (!isSelected(this.opts.selection, x, y)) return;
    const i = idx * 4;
    const d = t.data;
    const ink = this.opts.ink ?? 'simple';
    let c = own ?? this.opts.color;
    if (ink === 'shading') {
      const cur = ((d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!) >>> 0;
      const at = d[i + 3] === 0 ? undefined : this.rampIndex!.get(cur);
      if (at === undefined) return;
      const ramp = this.opts.ramp!;
      const next = Math.max(0, Math.min(ramp.length - 1, at + (this.opts.shadeStep ?? 1)));
      this.touched[idx] = 1;
      if (next === at) return;
      c = ramp[next]!;
      d[i] = c >>> 24;
      d[i + 1] = (c >>> 16) & 255;
      d[i + 2] = (c >>> 8) & 255;
      this.grow(x, y);
      return;
    }
    if (ink === 'lock-alpha') {
      const a = d[i + 3]!;
      if (a === 0) return;
      this.touched[idx] = 1;
      if (own === null && this.opts.mode === 'over') blendPixel(d, i, c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255, this.opts.opacity, 'normal');
      else {
        d[i] = c >>> 24;
        d[i + 1] = (c >>> 16) & 255;
        d[i + 2] = (c >>> 8) & 255;
      }
      d[i + 3] = a;
      this.grow(x, y);
      return;
    }
    this.touched[idx] = 1;
    // Custom brushes keep their transparent pixels out of the stroke.
    if (own !== null && (own & 255) === 0) return;
    if (this.opts.mode === 'replace' && own === null) {
      d[i] = c >>> 24;
      d[i + 1] = (c >>> 16) & 255;
      d[i + 2] = (c >>> 8) & 255;
      d[i + 3] = c & 255;
    } else {
      blendPixel(d, i, c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255, this.opts.mode === 'over' ? this.opts.opacity : 1, 'normal');
    }
    this.grow(x, y);
  }

  private grow(x: number, y: number): void {
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

/**
 * Pixel-perfect filter for freehand strokes: whenever the last three points
 * form an "L" (two orthogonal steps that could have been one diagonal step),
 * the corner is dropped. Feed it every pixel of the stroke in order.
 */
export class PixelPerfectPath {
  private pts: Point[] = [];

  constructor(
    private readonly paint: (x: number, y: number) => void,
    private readonly unpaint: (x: number, y: number) => void,
  ) {}

  add = (x: number, y: number): void => {
    const last = this.pts.at(-1);
    if (last && last.x === x && last.y === y) return;
    this.pts.push({ x, y });
    this.paint(x, y);
    const n = this.pts.length;
    if (n < 3) return;
    const a = this.pts[n - 3]!;
    const b = this.pts[n - 2]!;
    const c = this.pts[n - 1]!;
    const corner = Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1 && ((b.x === a.x && b.y === c.y) || (b.y === a.y && b.x === c.x));
    if (!corner) return;
    this.unpaint(b.x, b.y);
    this.pts.splice(n - 2, 1);
  };
}
