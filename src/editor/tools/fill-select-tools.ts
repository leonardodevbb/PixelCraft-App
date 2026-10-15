import { composeFrame } from '../../layers/compose';
import { rectFromCorners, type Point } from '../../raster/rect';
import { constrainSquare } from '../../raster/shapes';
import { EditorError } from '../session';
import {
  clipSelection,
  combineSelections,
  ellipseSelection,
  floodMask,
  polygonSelection,
  rectSelection,
  translateSelection,
  type SelectionMode,
} from '../selection';
import { moveSelected, previewMove, wholeLayerSelection } from '../selection-ops';
import type { Tool, ToolHost, ToolPointer } from './types';

function selectionMode(p: ToolPointer): SelectionMode {
  if (p.shift && p.alt) return 'intersect';
  if (p.shift) return 'add';
  if (p.alt) return 'subtract';
  return 'replace';
}

function report(host: ToolHost, e: unknown): void {
  if (e instanceof EditorError || e instanceof RangeError) host.notify(e.message);
  else throw e;
}

/** Bucket fill: contiguous or global, with tolerance, limited to the selection. */
class BucketTool implements Tool {
  readonly id = 'bucket' as const;
  readonly label = 'Balde de preenchimento';
  cursor = 'crosshair';

  onDown(p: ToolPointer, host: ToolHost): void {
    const s = host.session;
    if (p.x < 0 || p.y < 0 || p.x >= s.state.width || p.y >= s.state.height) return;
    try {
      const draft = s.beginDraft();
      const sample = host.options.sampleMerged ? composeFrame(s.state, s.lookup, s.activeFrameId) : draft.original;
      const mask = floodMask(sample, p.x, p.y, {
        tolerance: host.options.tolerance,
        contiguous: host.options.contiguous,
        limit: s.selection,
      });
      if (!mask) {
        s.cancelDraft();
        return;
      }
      const c = host.color(p.slot);
      const b = mask.bounds;
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (mask.mask[y * b.w + x]) draft.buffer.set(b.x + x, b.y + y, c);
      s.commitDraft('Preencher');
    } catch (e) {
      s.cancelDraft();
      report(host, e);
    }
  }
  onMove(): void {}
  onUp(): void {}
  cancel(): void {}
}

/** Rectangular marquee. Shift adds, Alt subtracts, Shift+Alt intersects; a click without drag deselects. */
class RectSelectTool implements Tool {
  readonly id = 'select-rect' as const;
  readonly label = 'Seleção retangular';
  cursor = 'crosshair';
  private start: Point | null = null;
  private end: Point | null = null;
  private moved = false;

  onDown(p: ToolPointer, host: ToolHost): void {
    this.start = { x: p.x, y: p.y };
    this.end = this.start;
    this.moved = false;
    host.preview({ marquee: rectFromCorners(this.start, this.end) });
  }
  onMove(p: ToolPointer, host: ToolHost): void {
    if (!this.start) return;
    let end = { x: p.x, y: p.y };
    if (p.shift && !p.alt && p.ctrl) end = constrainSquare(this.start, end);
    if (end.x !== this.start.x || end.y !== this.start.y) this.moved = true;
    this.end = end;
    host.preview({ marquee: rectFromCorners(this.start, end) });
  }
  onUp(p: ToolPointer, host: ToolHost): void {
    if (!this.start || !this.end) return;
    const s = host.session;
    host.preview({ marquee: null });
    const mode = selectionMode(p);
    if (!this.moved && mode === 'replace') {
      if (s.selection) s.setSelection(null);
    } else {
      const r = clipSelection(rectSelection(rectFromCorners(this.start, this.end)), s.state.width, s.state.height);
      if (r) s.setSelection(combineSelections(s.selection, r, mode), 'Selecionar retângulo');
    }
    this.start = this.end = null;
  }
  cancel(host: ToolHost): void {
    this.start = this.end = null;
    host.preview({ marquee: null });
  }
}

/** Elliptical marquee, with the same modifiers as the rectangular one. */
class EllipseSelectTool implements Tool {
  readonly id = 'select-ellipse' as const;
  readonly label = 'Seleção elíptica';
  cursor = 'crosshair';
  private start: Point | null = null;
  private end: Point | null = null;
  private moved = false;

  onDown(p: ToolPointer, host: ToolHost): void {
    this.start = { x: p.x, y: p.y };
    this.end = this.start;
    this.moved = false;
    host.preview({ ellipse: rectFromCorners(this.start, this.end) });
  }
  onMove(p: ToolPointer, host: ToolHost): void {
    if (!this.start) return;
    let end = { x: p.x, y: p.y };
    if (p.shift && !p.alt && p.ctrl) end = constrainSquare(this.start, end);
    if (end.x !== this.start.x || end.y !== this.start.y) this.moved = true;
    this.end = end;
    host.preview({ ellipse: rectFromCorners(this.start, end) });
  }
  onUp(p: ToolPointer, host: ToolHost): void {
    if (!this.start || !this.end) return;
    const s = host.session;
    host.preview({ ellipse: null });
    const mode = selectionMode(p);
    if (!this.moved && mode === 'replace') {
      if (s.selection) s.setSelection(null);
    } else {
      const r = clipSelection(ellipseSelection(rectFromCorners(this.start, this.end)), s.state.width, s.state.height);
      if (r) s.setSelection(combineSelections(s.selection, r, mode), 'Selecionar elipse');
    }
    this.start = this.end = null;
  }
  cancel(host: ToolHost): void {
    this.start = this.end = null;
    host.preview({ ellipse: null });
  }
}

/** Freehand lasso, closed automatically on release. */
class LassoTool implements Tool {
  readonly id = 'select-lasso' as const;
  readonly label = 'Laço';
  cursor = 'crosshair';
  private points: Point[] = [];

  onDown(p: ToolPointer, host: ToolHost): void {
    this.points = [{ x: p.x, y: p.y }];
    host.preview({ lasso: this.points });
  }
  onMove(p: ToolPointer, host: ToolHost): void {
    if (!this.points.length) return;
    const last = this.points.at(-1)!;
    if (last.x === p.x && last.y === p.y) return;
    this.points = [...this.points, { x: p.x, y: p.y }];
    host.preview({ lasso: this.points });
  }
  onUp(p: ToolPointer, host: ToolHost): void {
    const s = host.session;
    host.preview({ lasso: null });
    const mode = selectionMode(p);
    if (this.points.length < 2 && mode === 'replace') s.setSelection(null);
    else {
      const poly = polygonSelection(this.points);
      const clipped = poly && clipSelection(poly, s.state.width, s.state.height);
      if (clipped) s.setSelection(combineSelections(s.selection, clipped, mode), 'Selecionar com laço');
    }
    this.points = [];
  }
  cancel(host: ToolHost): void {
    this.points = [];
    host.preview({ lasso: null });
  }
}

/** Selects similar colours (contiguous or global) using the tolerance option. */
class MagicWandTool implements Tool {
  readonly id = 'magic-wand' as const;
  readonly label = 'Varinha mágica';
  cursor = 'crosshair';

  onDown(p: ToolPointer, host: ToolHost): void {
    const s = host.session;
    if (p.x < 0 || p.y < 0 || p.x >= s.state.width || p.y >= s.state.height) return;
    try {
      const src = host.options.sampleMerged
        ? composeFrame(s.state, s.lookup, s.activeFrameId)
        : s.celImage(s.activeLayerId, s.activeFrameId) ?? composeFrame(s.state, s.lookup, s.activeFrameId, { onlyLayers: new Set() });
      const m = floodMask(src, p.x, p.y, { tolerance: host.options.tolerance, contiguous: host.options.contiguous });
      if (m) s.setSelection(combineSelections(s.selection, m, selectionMode(p)), 'Varinha mágica');
    } catch (e) {
      report(host, e);
    }
  }
  onMove(): void {}
  onUp(): void {}
  cancel(): void {}
}

/**
 * Moves the selected pixels (or the whole layer). Alt duplicates instead of
 * moving; Ctrl moves only the selection outline. Each drag is one undo step.
 */
class MoveTool implements Tool {
  readonly id = 'move' as const;
  readonly label = 'Mover';
  cursor = 'move';
  private start: Point | null = null;
  private delta: Point = { x: 0, y: 0 };
  private mode: 'pixels' | 'outline' = 'pixels';
  private duplicate = false;

  onDown(p: ToolPointer, host: ToolHost): void {
    const s = host.session;
    this.start = { x: p.x, y: p.y };
    this.delta = { x: 0, y: 0 };
    this.duplicate = p.alt;
    this.mode = p.ctrl && s.selection ? 'outline' : 'pixels';
    if (this.mode === 'pixels') {
      try {
        s.beginDraft();
      } catch (e) {
        this.start = null;
        report(host, e);
      }
    }
  }
  onMove(p: ToolPointer, host: ToolHost): void {
    if (!this.start) return;
    const s = host.session;
    const d = { x: p.x - this.start.x, y: p.y - this.start.y };
    if (d.x === this.delta.x && d.y === this.delta.y) return;
    this.delta = d;
    host.preview({ selectionOffset: d });
    if (this.mode === 'pixels' && s.draft) {
      previewMove(s.draft.original, s.selection ?? wholeLayerSelection(s), d.x, d.y, this.duplicate, s.draft.buffer);
      s.touchDraft(s.draft.buffer.bounds);
    }
  }
  onUp(_p: ToolPointer, host: ToolHost): void {
    if (!this.start) return;
    const s = host.session;
    const { x: dx, y: dy } = this.delta;
    this.start = null;
    host.preview({ selectionOffset: null });
    if (this.mode === 'outline') {
      if (s.selection && (dx || dy)) s.setSelection(translateSelection(s.selection, dx, dy), 'Mover contorno da seleção');
      return;
    }
    s.cancelDraft();
    try {
      moveSelected(s, dx, dy, this.duplicate);
    } catch (e) {
      report(host, e);
    }
  }
  cancel(host: ToolHost): void {
    this.start = null;
    host.preview({ selectionOffset: null });
    host.session.cancelDraft();
  }
}

export const bucketTool = new BucketTool();
export const rectSelectTool = new RectSelectTool();
export const ellipseSelectTool = new EllipseSelectTool();
export const lassoTool = new LassoTool();
export const magicWandTool = new MagicWandTool();
export const moveTool = new MoveTool();
