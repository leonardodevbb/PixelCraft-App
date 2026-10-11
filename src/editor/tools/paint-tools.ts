import { TRANSPARENT } from '../../raster/color';
import { line } from '../../raster/shapes';
import type { Point } from '../../raster/rect';
import { EditorError } from '../session';
import { Painter, type PaintMode } from '../painter';
import type { Tool, ToolHost, ToolId, ToolPointer } from './types';

function symmetry(host: ToolHost) {
  return host.symmetryActive ? host.session.state.symmetry : null;
}

/**
 * Freehand tools (pencil, brush, eraser). Consecutive pointer samples are
 * joined with Bresenham lines so fast strokes never leave gaps; the whole
 * stroke becomes one history entry.
 */
class FreehandTool implements Tool {
  cursor = 'crosshair';
  private painter: Painter | null = null;
  private last: Point | null = null;

  constructor(
    readonly id: ToolId,
    readonly label: string,
    private readonly mode: (host: ToolHost) => { mode: PaintMode; erase: boolean; useOptions: boolean },
  ) {}

  onDown(p: ToolPointer, host: ToolHost): void {
    let draft;
    try {
      draft = host.session.beginDraft();
    } catch (e) {
      if (e instanceof EditorError) host.notify(e.message);
      return;
    }
    const m = this.mode(host);
    const o = host.options;
    this.painter = new Painter(draft.buffer, {
      color: m.erase ? TRANSPARENT : host.color(p.slot),
      size: o.size,
      shape: o.shape,
      mode: m.mode,
      opacity: m.useOptions ? o.opacity / 100 : 1,
      selection: host.session.selection,
      symmetry: symmetry(host),
    });
    this.last = { x: p.x, y: p.y };
    this.painter.stamp(p.x, p.y);
    host.session.touchDraft(this.painter.dirty);
  }

  onMove(p: ToolPointer, host: ToolHost): void {
    if (!this.painter || !this.last) return;
    if (p.x === this.last.x && p.y === this.last.y) return;
    line(this.last.x, this.last.y, p.x, p.y, this.painter.stamp);
    this.last = { x: p.x, y: p.y };
    host.session.touchDraft(this.painter.dirty);
  }

  onUp(_p: ToolPointer, host: ToolHost): void {
    if (!this.painter) return;
    this.painter = null;
    this.last = null;
    host.session.commitDraft(this.label);
  }

  cancel(host: ToolHost): void {
    this.painter = null;
    this.last = null;
    host.session.cancelDraft();
  }
}

export const pencilTool = new FreehandTool('pencil', 'Lápis', () => ({ mode: 'replace', erase: false, useOptions: false }));
export const brushTool = new FreehandTool('brush', 'Pincel', () => ({ mode: 'over', erase: false, useOptions: true }));
export const eraserTool = new FreehandTool('eraser', 'Borracha', () => ({ mode: 'replace', erase: true, useOptions: false }));
