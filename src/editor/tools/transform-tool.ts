import { PixelBuffer } from '../../raster/pixel-buffer';
import type { Point, Rect } from '../../raster/rect';
import { placementCorners, renderPlacement, type Placement } from '../../raster/transform';
import { drawOver } from '../raster-ops';
import { clipSelection, rectSelection, type Selection } from '../selection';
import { extractPiece } from '../selection-ops';
import { EditorError } from '../session';
import type { Tool, ToolHost, ToolPointer } from './types';

/** What the options bar shows about the piece being transformed. */
export interface TransformInfo {
  width: number;
  height: number;
  /** Percent. Negative means mirrored. */
  scaleX: number;
  scaleY: number;
  angle: number;
}

interface Lifted {
  piece: PixelBuffer;
  /** Selection mask of the piece as an image (alpha 255 = selected). */
  maskImg: PixelBuffer;
  bounds: Rect;
  hadSelection: boolean;
  /** The cel with the piece lifted out. */
  base: PixelBuffer;
  place: Placement;
}

type Drag =
  | { kind: 'move'; start: Point; from: Placement }
  | { kind: 'scale'; hx: -1 | 0 | 1; hy: -1 | 0 | 1; from: Placement }
  | { kind: 'rotate'; startAngle: number; from: Placement };

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Free transform with on-canvas handles. Activating the tool lifts the
 * selection (or the whole layer content); dragging inside moves it, the
 * square handles scale it (Shift keeps proportions), and dragging just
 * outside a corner rotates it (Shift snaps to 15°). Enter or switching tools
 * applies, Escape cancels. The result is one history entry.
 */
export class TransformTool implements Tool {
  readonly id = 'transform' as const;
  readonly label = 'Transformar';
  cursor = 'move';
  private lifted: Lifted | null = null;
  private drag: Drag | null = null;
  private listeners = new Set<() => void>();

  /* ---------- state for the UI ---------- */

  get active(): boolean {
    return !!this.lifted;
  }

  get info(): TransformInfo | null {
    const l = this.lifted;
    if (!l) return null;
    return {
      width: Math.round(Math.abs(l.bounds.w * l.place.sx)),
      height: Math.round(Math.abs(l.bounds.h * l.place.sy)),
      scaleX: Math.round(l.place.sx * 1000) / 10,
      scaleY: Math.round(l.place.sy * 1000) / 10,
      angle: Math.round(l.place.angle * 10) / 10,
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /* ---------- lifecycle ---------- */

  /** Lifts the selection (or the layer content). Returns false when there is nothing to transform. */
  begin(host: ToolHost): boolean {
    const s = host.session;
    if (this.lifted && s.draft) return true;
    this.lifted = null;
    let draft;
    try {
      draft = s.beginDraft();
    } catch (e) {
      if (e instanceof EditorError) host.notify(e.message);
      return false;
    }
    const hadSelection = !!s.selection;
    const content = draft.original.contentBounds();
    const sel: Selection | null = s.selection ?? (content ? rectSelection(content) : null);
    if (!sel) {
      s.cancelDraft();
      host.notify('A camada está vazia neste quadro: não há nada para transformar.');
      return false;
    }
    const piece = extractPiece(draft.original, sel);
    const b = sel.bounds;
    const base = draft.original.clone();
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (sel.mask[y * b.w + x]) base.set(b.x + x, b.y + y, 0);
    const maskImg = new PixelBuffer(b.w, b.h);
    for (let i = 0; i < sel.mask.length; i++) if (sel.mask[i]) maskImg.data[i * 4 + 3] = 255;
    this.lifted = {
      piece: piece.buffer,
      maskImg,
      bounds: { ...b },
      hadSelection,
      base,
      place: { cx: b.x + b.w / 2, cy: b.y + b.h / 2, sx: 1, sy: 1, angle: 0 },
    };
    this.render(host);
    return true;
  }

  activate(host: ToolHost): void {
    this.begin(host);
  }

  /** Changes the placement numerically (options bar). */
  setParams(host: ToolHost, patch: Partial<Pick<Placement, 'sx' | 'sy' | 'angle'>>): void {
    const l = this.lifted;
    if (!l || !host.session.draft) return;
    l.place = { ...l.place, ...patch };
    if (patch.sx !== undefined && Math.abs(l.place.sx * l.bounds.w) < 1) l.place.sx = Math.sign(patch.sx || 1) / l.bounds.w;
    if (patch.sy !== undefined && Math.abs(l.place.sy * l.bounds.h) < 1) l.place.sy = Math.sign(patch.sy || 1) / l.bounds.h;
    this.render(host);
  }

  flip(host: ToolHost, axis: 'h' | 'v'): void {
    const l = this.lifted;
    if (!l) return;
    this.setParams(host, axis === 'h' ? { sx: -l.place.sx } : { sy: -l.place.sy });
  }

  private render(host: ToolHost): void {
    const l = this.lifted!;
    const d = host.session.draft;
    if (!d) return;
    d.buffer.paste(l.base, 0, 0);
    const out = renderPlacement(l.piece, l.place, host.options.transformAlgorithm);
    drawOver(d.buffer, out.buffer, out.x, out.y);
    host.session.touchDraft(d.buffer.bounds);
    host.preview({ transformBox: placementCorners(l.bounds.w, l.bounds.h, l.place) });
    this.changed();
  }

  /** Re-renders after the algorithm option changed. */
  refresh(host: ToolHost): void {
    if (this.lifted && host.session.draft) this.render(host);
  }

  /** Writes the result as one history entry and selects the transformed area. */
  apply(host: ToolHost): void {
    const l = this.lifted;
    const s = host.session;
    const d = s.draft;
    this.lifted = null;
    this.drag = null;
    host.preview({ transformBox: null });
    this.changed();
    if (!l || !d) return;
    s.cancelDraft();
    let selection: Selection | null = null;
    if (l.hadSelection) {
      const m = renderPlacement(l.maskImg, l.place, 'nearest');
      const mask = new Uint8Array(m.buffer.width * m.buffer.height);
      for (let i = 0; i < mask.length; i++) mask[i] = m.buffer.data[i * 4 + 3]! > 0 ? 1 : 0;
      selection = clipSelection({ bounds: { x: m.x, y: m.y, w: m.buffer.width, h: m.buffer.height }, mask }, s.state.width, s.state.height);
    }
    const rect = d.original.diffBounds(d.buffer);
    if (!rect) return;
    s.writeCel('Transformar', d.layerId, d.frameId, [{ rect, pixels: d.buffer.extract(rect) }], { ...s.context, selection });
  }

  /* ---------- pointer ---------- */

  private local(p: { x: number; y: number }, place: Placement): Point {
    const c = Math.cos(rad(place.angle));
    const sn = Math.sin(rad(place.angle));
    const dx = p.x - place.cx;
    const dy = p.y - place.cy;
    return { x: dx * c + dy * sn, y: -dx * sn + dy * c };
  }

  /** What dragging from this point would do. */
  hit(p: { x: number; y: number }, zoom: number): Drag['kind'] | 'scale-handle' | 'outside' {
    const l = this.lifted;
    if (!l) return 'outside';
    const q = this.local(p, l.place);
    const hw = Math.abs((l.bounds.w * l.place.sx) / 2);
    const hh = Math.abs((l.bounds.h * l.place.sy) / 2);
    const r = Math.max(0.6, 6 / zoom);
    // Deep inside the box always moves, so small pieces are not all handles.
    if (Math.abs(q.x) < hw - r / 2 && Math.abs(q.y) < hh - r / 2) return 'move';
    for (const hx of [-1, 0, 1])
      for (const hy of [-1, 0, 1]) {
        if (!hx && !hy) continue;
        if (Math.abs(q.x - hx * hw) <= r && Math.abs(q.y - hy * hh) <= r) return 'scale-handle';
      }
    if (Math.abs(q.x) <= hw && Math.abs(q.y) <= hh) return 'move';
    const near = Math.min(...[-1, 1].flatMap((hx) => [-1, 1].map((hy) => Math.hypot(q.x - hx * hw, q.y - hy * hh))));
    return near <= r * 5 ? 'rotate' : 'outside';
  }

  onDown(p: ToolPointer, host: ToolHost): void {
    const s = host.session;
    if (!this.lifted || !s.draft) {
      this.lifted = null;
      if (!this.begin(host)) return;
    }
    const l = this.lifted!;
    const pt = { x: p.fx, y: p.fy };
    const zoom = host.zoom ?? 8;
    const kind = this.hit(pt, zoom);
    if (kind === 'outside') {
      // Clicking away applies, like committing a floating selection.
      this.apply(host);
      return;
    }
    if (kind === 'scale-handle') {
      const q = this.local(pt, l.place);
      const hw = Math.abs((l.bounds.w * l.place.sx) / 2);
      const hh = Math.abs((l.bounds.h * l.place.sy) / 2);
      const r = Math.max(0.6, 6 / zoom);
      const pick = (v: number, half: number): -1 | 0 | 1 => (Math.abs(v - half) <= r ? 1 : Math.abs(v + half) <= r ? -1 : 0);
      this.drag = { kind: 'scale', hx: pick(q.x, hw), hy: pick(q.y, hh), from: { ...l.place } };
    } else if (kind === 'rotate') {
      this.drag = { kind: 'rotate', startAngle: Math.atan2(pt.y - l.place.cy, pt.x - l.place.cx), from: { ...l.place } };
    } else this.drag = { kind: 'move', start: { x: p.x, y: p.y }, from: { ...l.place } };
  }

  onMove(p: ToolPointer, host: ToolHost): void {
    const l = this.lifted;
    const d = this.drag;
    if (!l || !d || !host.session.draft) return;
    const pt = { x: p.fx, y: p.fy };
    if (d.kind === 'move') {
      l.place = { ...d.from, cx: d.from.cx + p.x - d.start.x, cy: d.from.cy + p.y - d.start.y };
    } else if (d.kind === 'rotate') {
      let a = d.from.angle + ((Math.atan2(pt.y - d.from.cy, pt.x - d.from.cx) - d.startAngle) * 180) / Math.PI;
      if (p.shift) a = Math.round(a / 15) * 15;
      a = ((((a + 180) % 360) + 360) % 360) - 180;
      l.place = { ...d.from, angle: Math.round(a * 10) / 10 };
    } else {
      const from = d.from;
      const q = this.local(pt, from);
      const fw = l.bounds.w * from.sx;
      const fh = l.bounds.h * from.sy;
      // The opposite side (or corner) stays put while the handle follows the pointer.
      const ax = (-d.hx * Math.abs(fw)) / 2;
      const ay = (-d.hy * Math.abs(fh)) / 2;
      let w = d.hx ? Math.max(1, (q.x - ax) * d.hx) : Math.abs(fw);
      let h = d.hy ? Math.max(1, (q.y - ay) * d.hy) : Math.abs(fh);
      if (p.shift && d.hx && d.hy) {
        const k = Math.max(w / Math.abs(fw), h / Math.abs(fh));
        w = Math.abs(fw) * k;
        h = Math.abs(fh) * k;
      }
      w = Math.round(w);
      h = Math.round(h);
      const lcx = d.hx ? ax + (d.hx * w) / 2 : 0;
      const lcy = d.hy ? ay + (d.hy * h) / 2 : 0;
      const c = Math.cos(rad(from.angle));
      const sn = Math.sin(rad(from.angle));
      l.place = {
        ...from,
        cx: from.cx + lcx * c - lcy * sn,
        cy: from.cy + lcx * sn + lcy * c,
        sx: Math.sign(from.sx) * (w / l.bounds.w),
        sy: Math.sign(from.sy) * (h / l.bounds.h),
      };
    }
    this.render(host);
  }

  onUp(): void {
    this.drag = null;
  }

  cancel(host: ToolHost): void {
    const had = !!this.lifted;
    this.lifted = null;
    this.drag = null;
    host.preview({ transformBox: null });
    if (had) {
      host.session.cancelDraft();
      this.changed();
    }
  }

  deactivate(host: ToolHost): void {
    if (this.lifted) this.apply(host);
  }

  isPending(): boolean {
    return !!this.lifted;
  }
}

export const transformTool = new TransformTool();
