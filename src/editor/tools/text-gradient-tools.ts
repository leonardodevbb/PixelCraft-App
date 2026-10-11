import { gradientColor } from '../../raster/gradient';
import type { Point, Rect } from '../../raster/rect';
import { isSelected } from '../selection';
import { EditorError } from '../session';
import type { Tool, ToolHost, ToolPointer } from './types';

/** Click places a text cursor; the UI opens the text editor with live preview. */
export const textTool: Tool = {
  id: 'text',
  label: 'Texto',
  cursor: 'text',
  onDown(p: ToolPointer, host: ToolHost): void {
    if (!host.session.canEditLayer()) {
      host.notify('Selecione uma camada de pixels desbloqueada para escrever.');
      return;
    }
    host.requestText?.({ x: p.x, y: p.y });
  },
  onMove() {},
  onUp() {},
  cancel() {},
};

/**
 * Drag from start to end color. Fills the selection (or the whole cel). With
 * a dither mode only the two colors are used, in an ordered Bayer pattern.
 */
class GradientTool implements Tool {
  id = 'gradient' as const;
  label = 'Degradê';
  cursor = 'crosshair';
  private start: Point | null = null;

  onDown(p: ToolPointer, host: ToolHost): void {
    try {
      host.session.beginDraft();
    } catch (e) {
      if (e instanceof EditorError) host.notify(e.message);
      return;
    }
    this.start = { x: p.x, y: p.y };
    this.draw(p, host);
  }

  onMove(p: ToolPointer, host: ToolHost): void {
    if (this.start) this.draw(p, host);
  }

  private draw(p: ToolPointer, host: ToolHost): void {
    const draft = host.session.draft;
    if (!draft || !this.start) return;
    const a = this.start;
    let b: Point = { x: p.x, y: p.y };
    if (p.shift) {
      // Snap to horizontal, vertical or 45°.
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      b = { x: Math.round(a.x + Math.cos(ang) * len), y: Math.round(a.y + Math.sin(ang) * len) };
    }
    const first = host.color(p.slot);
    const second = host.color(p.slot === 'primary' ? 'secondary' : 'primary');
    const { gradientShape, dither } = host.options;
    const sel = host.session.selection;
    const buf = draft.buffer;
    const area: Rect = sel ? sel.bounds : { x: 0, y: 0, w: buf.width, h: buf.height };
    const x0 = Math.max(0, area.x);
    const y0 = Math.max(0, area.y);
    const x1 = Math.min(buf.width, area.x + area.w);
    const y1 = Math.min(buf.height, area.y + area.h);
    if (x1 <= x0 || y1 <= y0) return;
    const d = buf.data;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        if (sel && !isSelected(sel, x, y)) continue;
        const c = gradientColor(gradientShape, dither, a, b, first, second, x, y);
        const i = (y * buf.width + x) * 4;
        d[i] = c >>> 24;
        d[i + 1] = (c >>> 16) & 255;
        d[i + 2] = (c >>> 8) & 255;
        d[i + 3] = c & 255;
      }
    host.session.touchDraft({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  onUp(_p: ToolPointer, host: ToolHost): void {
    if (!this.start) return;
    this.start = null;
    host.session.commitDraft('Degradê');
  }

  cancel(host: ToolHost): void {
    this.start = null;
    host.session.cancelDraft();
  }
}

export const gradientTool = new GradientTool();
