import { TRANSPARENT } from '../../raster/color';
import { brushFootprint, cubicBezier, line } from '../../raster/shapes';
import type { Point } from '../../raster/rect';
import { EditorError } from '../session';
import { Painter, PixelPerfectPath, type PaintMode } from '../painter';
import { isSelected, polygonSelection } from '../selection';
import type { Tool, ToolHost, ToolId, ToolPointer } from './types';

function symmetry(host: ToolHost) {
  return host.symmetryActive ? host.session.state.symmetry : null;
}

function startDraft(host: ToolHost) {
  try {
    return host.session.beginDraft();
  } catch (e) {
    if (e instanceof EditorError) host.notify(e.message);
    return null;
  }
}

/**
 * Painter configured from the tool options: ink, custom brush, symmetry and
 * selection. Erasing ignores the ink and paints the brush shape transparent.
 */
export function painterFor(
  host: ToolHost,
  p: ToolPointer,
  m: { mode: PaintMode; erase: boolean; useOptions: boolean },
): Painter | null {
  const draft = host.session.draft;
  if (!draft) return null;
  const o = host.options;
  return new Painter(draft.buffer, {
    color: m.erase ? TRANSPARENT : host.color(p.slot),
    size: o.size,
    shape: o.shape,
    mode: m.erase ? 'replace' : m.mode,
    opacity: m.useOptions ? o.opacity / 100 : 1,
    selection: host.session.selection,
    symmetry: symmetry(host),
    ink: m.erase ? 'simple' : o.ink,
    ramp: host.session.state.palette.colors,
    shadeStep: p.slot === 'primary' ? 1 : -1,
    brush: o.customBrush,
    tintBrush: m.erase,
    original: draft.original,
  });
}

/**
 * Freehand tools (pencil, brush, eraser). Consecutive pointer samples are
 * joined with Bresenham lines so fast strokes never leave gaps; the whole
 * stroke becomes one history entry. With pixel-perfect on (size 1) the
 * stroke drops "L" corners so diagonal lines stay one pixel thin.
 */
class FreehandTool implements Tool {
  cursor = 'crosshair';
  private painter: Painter | null = null;
  private last: Point | null = null;
  private plot: ((x: number, y: number) => void) | null = null;

  constructor(
    readonly id: ToolId,
    readonly label: string,
    private readonly mode: (host: ToolHost) => { mode: PaintMode; erase: boolean; useOptions: boolean },
  ) {}

  onDown(p: ToolPointer, host: ToolHost): void {
    if (!startDraft(host)) return;
    const painter = painterFor(host, p, this.mode(host));
    if (!painter) return;
    this.painter = painter;
    const o = host.options;
    const perfect = o.pixelPerfect && !o.customBrush && Math.floor(o.size) <= 1;
    this.plot = perfect ? new PixelPerfectPath(painter.stamp, painter.unstamp).add : painter.stamp;
    this.last = { x: p.x, y: p.y };
    this.plot(p.x, p.y);
    host.session.touchDraft(this.painter.dirty);
  }

  onMove(p: ToolPointer, host: ToolHost): void {
    if (!this.painter || !this.last || !this.plot) return;
    if (p.x === this.last.x && p.y === this.last.y) return;
    line(this.last.x, this.last.y, p.x, p.y, this.plot);
    this.last = { x: p.x, y: p.y };
    host.session.touchDraft(this.painter.dirty);
  }

  onUp(_p: ToolPointer, host: ToolHost): void {
    if (!this.painter) return;
    this.painter = null;
    this.last = null;
    this.plot = null;
    host.session.commitDraft(this.label);
  }

  cancel(host: ToolHost): void {
    this.painter = null;
    this.last = null;
    this.plot = null;
    host.session.cancelDraft();
  }
}

export const pencilTool = new FreehandTool('pencil', 'Lápis', () => ({ mode: 'replace', erase: false, useOptions: false }));
export const brushTool = new FreehandTool('brush', 'Pincel', () => ({ mode: 'over', erase: false, useOptions: true }));
export const eraserTool = new FreehandTool('eraser', 'Borracha', () => ({ mode: 'replace', erase: true, useOptions: false }));

/**
 * Spray can: scatters single pixels inside a circle whose diameter is the
 * brush size (at least 5 px). Density sets how many land per sample.
 */
class SprayTool implements Tool {
  readonly id = 'spray' as const;
  readonly label = 'Spray';
  cursor = 'crosshair';
  /** Replaceable for deterministic tests. */
  random: () => number = Math.random;
  private painter: Painter | null = null;

  onDown(p: ToolPointer, host: ToolHost): void {
    if (!startDraft(host)) return;
    // A fresh painter per burst would forget touched pixels; one per stroke
    // keeps semi-transparent spray from building up on the same pixel.
    this.painter = painterFor(host, p, { mode: 'over', erase: false, useOptions: true });
    this.spray(p, host);
  }

  onMove(p: ToolPointer, host: ToolHost): void {
    if (this.painter) this.spray(p, host);
  }

  private spray(p: ToolPointer, host: ToolHost): void {
    const painter = this.painter!;
    const r = Math.max(2.5, host.options.size / 2);
    const count = Math.max(1, Math.round((Math.PI * r * r * host.options.sprayDensity) / 100 / 4));
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2;
      const d = Math.sqrt(this.random()) * r;
      painter.dot(Math.round(p.x + Math.cos(a) * d), Math.round(p.y + Math.sin(a) * d));
    }
    host.session.touchDraft(painter.dirty);
  }

  onUp(_p: ToolPointer, host: ToolHost): void {
    if (!this.painter) return;
    this.painter = null;
    host.session.commitDraft(this.label);
  }

  cancel(host: ToolHost): void {
    this.painter = null;
    host.session.cancelDraft();
  }
}

/**
 * Freehand outline that is filled when released (Aseprite's "contour").
 * The path is previewed as a line; the fill uses the ink and selection.
 */
class ContourTool implements Tool {
  readonly id = 'contour' as const;
  readonly label = 'Contorno preenchido';
  cursor = 'crosshair';
  private points: Point[] = [];
  private painter: Painter | null = null;

  onDown(p: ToolPointer, host: ToolHost): void {
    if (!startDraft(host)) return;
    this.painter = painterFor(host, p, { mode: 'replace', erase: false, useOptions: false });
    this.points = [{ x: p.x, y: p.y }];
    this.painter?.dot(p.x, p.y);
    host.session.touchDraft(this.painter?.dirty ?? null);
  }

  onMove(p: ToolPointer, host: ToolHost): void {
    const painter = this.painter;
    const last = this.points.at(-1);
    if (!painter || !last || (last.x === p.x && last.y === p.y)) return;
    line(last.x, last.y, p.x, p.y, painter.dot);
    this.points.push({ x: p.x, y: p.y });
    host.session.touchDraft(painter.dirty);
  }

  onUp(_p: ToolPointer, host: ToolHost): void {
    const painter = this.painter;
    if (!painter) return;
    const poly = polygonSelection(this.points);
    if (poly) {
      const b = poly.bounds;
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (poly.mask[y * b.w + x]) painter.dot(b.x + x, b.y + y);
    }
    this.painter = null;
    this.points = [];
    host.session.commitDraft(this.label);
  }

  cancel(host: ToolHost): void {
    this.painter = null;
    this.points = [];
    host.session.cancelDraft();
  }
}

/**
 * Bézier curve in three gestures: drag the line between the end points, then
 * drag to place the first control point, then the second. The curve is
 * committed after the third gesture; Escape or switching tools cancels it.
 */
class CurveTool implements Tool {
  readonly id = 'curve' as const;
  readonly label = 'Curva';
  cursor = 'crosshair';
  /** 0: dragging the end points, 1: first control point, 2: second. */
  private phase = 0;
  private pts: Point[] = [];
  private slot: ToolPointer['slot'] = 'primary';

  onDown(p: ToolPointer, host: ToolHost): void {
    const s = host.session;
    if (this.phase > 0 && !s.draft) this.phase = 0;
    if (this.phase === 0) {
      if (!startDraft(host)) return;
      this.slot = p.slot;
      this.pts = [{ x: p.x, y: p.y }, { x: p.x, y: p.y }, { x: p.x, y: p.y }, { x: p.x, y: p.y }];
    }
    this.place(p, host);
  }

  onMove(p: ToolPointer, host: ToolHost): void {
    if (host.session.draft && this.pts.length) this.place(p, host);
  }

  private place(p: ToolPointer, host: ToolHost): void {
    const pt = { x: p.x, y: p.y };
    if (this.phase === 0) {
      // While the end points move the curve is straight: controls sit on the ends.
      this.pts = [this.pts[0]!, { ...this.pts[0]! }, pt, pt];
    } else if (this.phase === 1) this.pts[1] = pt;
    else this.pts[2] = pt;
    this.draw(host);
  }

  private draw(host: ToolHost): void {
    const s = host.session;
    s.resetDraft();
    const painter = painterFor(host, { x: 0, y: 0, fx: 0, fy: 0, slot: this.slot, shift: false, ctrl: false, alt: false }, {
      mode: 'replace',
      erase: false,
      useOptions: false,
    });
    if (!painter) return;
    const [a, c1, c2, b] = this.pts as [Point, Point, Point, Point];
    cubicBezier(a, c1, c2, b, painter.stamp);
    host.preview({ handles: this.phase === 0 ? null : this.pts });
    s.touchDraft(painter.dirty);
  }

  onUp(_p: ToolPointer, host: ToolHost): void {
    if (!host.session.draft || !this.pts.length) return;
    if (this.phase < 2) {
      this.phase++;
      if (this.phase === 1) host.preview({ handles: this.pts });
      return;
    }
    this.finish(host);
    host.session.commitDraft(this.label);
  }

  private finish(host: ToolHost): void {
    this.phase = 0;
    this.pts = [];
    host.preview({ handles: null });
  }

  cancel(host: ToolHost): void {
    this.finish(host);
    host.session.cancelDraft();
  }

  deactivate(host: ToolHost): void {
    if (this.phase > 0) this.cancel(host);
  }
}

/** Shared code of the blur and jumble tools: applies `fn` under the brush. */
abstract class FilterBrushTool implements Tool {
  abstract readonly id: ToolId;
  abstract readonly label: string;
  cursor = 'crosshair';
  random: () => number = Math.random;
  private last: Point | null = null;

  protected abstract filter(x: number, y: number, host: ToolHost, footprint: Point[]): void;

  onDown(p: ToolPointer, host: ToolHost): void {
    if (!startDraft(host)) return;
    this.last = { x: p.x, y: p.y };
    this.stamp(p.x, p.y, host);
  }

  onMove(p: ToolPointer, host: ToolHost): void {
    if (!this.last || (p.x === this.last.x && p.y === this.last.y)) return;
    line(this.last.x, this.last.y, p.x, p.y, (x, y) => this.stamp(x, y, host));
    this.last = { x: p.x, y: p.y };
  }

  private stamp(x: number, y: number, host: ToolHost): void {
    const o = host.options;
    const fp = brushFootprint(Math.max(1, o.size), o.shape);
    this.filter(x, y, host, fp);
    const r = Math.ceil(o.size / 2) + 1;
    host.session.touchDraft({ x: x - r, y: y - r, w: 2 * r + 1, h: 2 * r + 1 });
  }

  onUp(_p: ToolPointer, host: ToolHost): void {
    if (!this.last) return;
    this.last = null;
    host.session.commitDraft(this.label);
  }

  cancel(host: ToolHost): void {
    this.last = null;
    host.session.cancelDraft();
  }
}

/**
 * Softens pixels under the brush: each becomes the alpha-weighted average of
 * its 3×3 neighbourhood. Passing over the same area again blurs more.
 */
class BlurTool extends FilterBrushTool {
  readonly id = 'blur' as const;
  readonly label = 'Desfocar';

  protected filter(cx: number, cy: number, host: ToolHost, fp: Point[]): void {
    const buf = host.session.draft!.buffer;
    const sel = host.session.selection;
    const src = buf.clone();
    for (const o of fp) {
      const x = cx + o.x;
      const y = cy + o.y;
      if (!buf.inBounds(x, y) || !isSelected(sel, x, y)) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!src.inBounds(x + dx, y + dy)) continue;
          const i = ((y + dy) * src.width + x + dx) * 4;
          const pa = src.data[i + 3]!;
          r += src.data[i]! * pa;
          g += src.data[i + 1]! * pa;
          b += src.data[i + 2]! * pa;
          a += pa;
          n++;
        }
      const i = (y * buf.width + x) * 4;
      if (a === 0) {
        buf.data[i + 3] = 0;
        continue;
      }
      buf.data[i] = Math.round(r / a);
      buf.data[i + 1] = Math.round(g / a);
      buf.data[i + 2] = Math.round(b / a);
      buf.data[i + 3] = Math.round(a / n);
    }
  }
}

/** Shuffles pixels under the brush with random neighbours (Aseprite's "jumble"). */
class JumbleTool extends FilterBrushTool {
  readonly id = 'jumble' as const;
  readonly label = 'Embaralhar';

  protected filter(cx: number, cy: number, host: ToolHost, fp: Point[]): void {
    const buf = host.session.draft!.buffer;
    const sel = host.session.selection;
    for (const o of fp) {
      const x = cx + o.x;
      const y = cy + o.y;
      const nx = x + Math.floor(this.random() * 3) - 1;
      const ny = y + Math.floor(this.random() * 3) - 1;
      if (!buf.inBounds(x, y) || !buf.inBounds(nx, ny) || !isSelected(sel, x, y) || !isSelected(sel, nx, ny)) continue;
      const c = buf.get(x, y);
      buf.set(x, y, buf.get(nx, ny));
      buf.set(nx, ny, c);
    }
  }
}

export const sprayTool = new SprayTool();
export const contourTool = new ContourTool();
export const curveTool = new CurveTool();
export const blurTool = new BlurTool();
export const jumbleTool = new JumbleTool();
