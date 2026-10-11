import { constrainLine, constrainSquare, ellipseFilled, ellipseOutline, line, rectFilled, rectOutline } from '../../raster/shapes';
import type { Point } from '../../raster/rect';
import { Painter } from '../painter';
import { EditorError } from '../session';
import type { Tool, ToolHost, ToolId, ToolPointer } from './types';

type Rasterize = (a: Point, b: Point, painter: Painter) => void;

/**
 * Two-point tools (line, rectangle, ellipse). While dragging the shape is
 * re-rasterized into the draft from the original pixels, which gives a live
 * preview; releasing commits it as one history entry. Shift constrains the
 * angle (line) or the aspect ratio (rectangle, ellipse); Alt draws from the
 * centre.
 */
class ShapeTool implements Tool {
  cursor = 'crosshair';
  private start: Point | null = null;
  private painter: Painter | null = null;

  constructor(
    readonly id: ToolId,
    readonly label: string,
    private readonly raster: Rasterize,
    private readonly constrain: (a: Point, b: Point) => Point,
    private readonly fromCenterAllowed: boolean,
  ) {}

  onDown(p: ToolPointer, host: ToolHost): void {
    let draft;
    try {
      draft = host.session.beginDraft();
    } catch (e) {
      if (e instanceof EditorError) host.notify(e.message);
      return;
    }
    this.start = { x: p.x, y: p.y };
    this.painter = new Painter(draft.buffer, {
      color: host.color(p.slot),
      size: host.options.size,
      shape: host.options.shape,
      mode: 'replace',
      opacity: 1,
      selection: host.session.selection,
      symmetry: host.symmetryActive ? host.session.state.symmetry : null,
    });
    this.draw(p, host);
  }

  onMove(p: ToolPointer, host: ToolHost): void {
    if (this.start) this.draw(p, host);
  }

  private draw(p: ToolPointer, host: ToolHost): void {
    const start = this.start!;
    const painter = this.painter!;
    host.session.resetDraft();
    painter.reset();
    let end: Point = { x: p.x, y: p.y };
    if (p.shift) end = this.constrain(start, end);
    let a = start;
    if (p.alt && this.fromCenterAllowed) {
      a = { x: 2 * start.x - end.x, y: 2 * start.y - end.y };
    }
    this.raster(a, end, painter);
    host.session.touchDraft(painter.dirty);
  }

  onUp(_p: ToolPointer, host: ToolHost): void {
    if (!this.start) return;
    this.start = null;
    this.painter = null;
    host.session.commitDraft(this.label);
  }

  cancel(host: ToolHost): void {
    this.start = null;
    this.painter = null;
    host.session.cancelDraft();
  }
}

export const lineTool = new ShapeTool(
  'line',
  'Linha',
  (a, b, p) => line(a.x, a.y, b.x, b.y, p.stamp),
  constrainLine,
  false,
);

/** Thick outlines stamp the brush along the path; size 1 plots single pixels. */
function outline(fn: typeof rectOutline): Rasterize {
  return (a, b, p) => fn(a.x, a.y, b.x, b.y, p.stamp);
}

export const rectTool = new ShapeTool('rect', 'Retângulo', outline(rectOutline), constrainSquare, true);
export const rectFilledTool = new ShapeTool(
  'rect-filled',
  'Retângulo preenchido',
  (a, b, p) => rectFilled(a.x, a.y, b.x, b.y, p.dot),
  constrainSquare,
  true,
);
export const ellipseTool = new ShapeTool('ellipse', 'Elipse', outline(ellipseOutline), constrainSquare, true);
export const ellipseFilledTool = new ShapeTool(
  'ellipse-filled',
  'Elipse preenchida',
  (a, b, p) => ellipseFilled(a.x, a.y, b.x, b.y, p.dot),
  constrainSquare,
  true,
);
