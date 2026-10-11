import type { EditorSession } from '../editor/session';
import { composeFrame } from '../layers/compose';
import { frameSignature } from '../editor/signature';
import { PixelBuffer } from '../raster/pixel-buffer';
import { type Rect, intersectRect, rectIsEmpty, unionRect } from '../raster/rect';
import type { Point } from '../raster/rect';
import type { ViewTransform } from './viewport';

export interface OnionSkinSettings {
  enabled: boolean;
  before: number;
  after: number;
  /** 0..1 */
  opacity: number;
  beforeColor: string;
  afterColor: string;
}

export interface RenderSettings {
  pixelGrid: boolean;
  /** Minimum zoom at which the pixel grid is drawn. */
  pixelGridMinZoom: number;
  gridColor: string;
  tileGrid: boolean;
  tileGridColor: string;
  /** Draws faded copies of the image around it (seamless tile check). */
  tiledPreview?: boolean;
  checkerA: string;
  checkerB: string;
  /** Checker cell size in screen pixels. */
  checkerSize: number;
  workspace: string;
  /** Solid canvas background instead of the checkerboard, or null. */
  canvasBackground: string | null;
  showSymmetryAxes: boolean;
  showGuides: boolean;
  onion: OnionSkinSettings;
}

export interface Overlay {
  /** Pixels under the brush, drawn as an outline. */
  cursorPixels: Point[] | null;
  cursorColor: string;
  /** Marching selection outline in document pixels. */
  selection: { bounds: Rect; mask: Uint8Array } | null;
  /** Floating content being moved (drawn above the composite). */
  floating: { buffer: PixelBuffer; x: number; y: number } | null;
  /** Rectangle being dragged (selection tools). */
  marquee: Rect | null;
  /** Lasso path being drawn, in document pixels. */
  lasso: Point[] | null;
  /** Offset applied to the selection outline while it is being moved. */
  selectionOffset: Point | null;
  /** Ellipse being dragged by the elliptical selection tool. */
  ellipse: Rect | null;
  /** Curve control points (start, c1, c2, end) shown as handles. */
  handles: Point[] | null;
}

/**
 * Draws the document into the editor canvas: checkerboard, composite image,
 * grids and overlays. The composite is cached at document resolution and only
 * the regions that changed are recomposed, so drawing stays fast while
 * zoom/pan just re-blit the cached image.
 */
export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private composite: PixelBuffer | null = null;
  private compositeCanvas: HTMLCanvasElement;
  private compositeCtx: CanvasRenderingContext2D;
  private imageData: ImageData | null = null;
  private dirty: Rect | null = null;
  private allDirty = true;
  private frame = 0;
  private checker: CanvasPattern | null = null;
  private checkerKey = '';
  private onionCanvas: HTMLCanvasElement | null = null;
  private onionKey = '';
  private floatingCanvas: HTMLCanvasElement | null = null;
  private floatingRef: PixelBuffer | null = null;
  private antsOffset = 0;
  private edgeCache: { sel: { bounds: Rect; mask: Uint8Array }; edges: Int32Array } | null = null;

  session: EditorSession | null = null;
  transform: ViewTransform = { zoom: 8, offsetX: 0, offsetY: 0 };
  settings: RenderSettings;
  overlay: Overlay = { cursorPixels: null, cursorColor: '#ffffff', selection: null, floating: null, marquee: null, lasso: null, selectionOffset: null, ellipse: null, handles: null };
  /** Renders a frame other than the active one (playback). */
  frameOverride: string | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    settings: RenderSettings,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D indisponível.');
    this.ctx = ctx;
    this.settings = settings;
    this.compositeCanvas = document.createElement('canvas');
    const cctx = this.compositeCanvas.getContext('2d');
    if (!cctx) throw new Error('Canvas 2D indisponível.');
    this.compositeCtx = cctx;
  }

  /** Marks a document region (or everything) as needing recomposition. */
  invalidate(rect?: Rect | null): void {
    if (!rect) this.allDirty = true;
    else this.dirty = unionRect(this.dirty, rect);
    this.request();
  }

  invalidateOnion(): void {
    this.onionKey = '';
    this.request();
  }

  request(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  dispose(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
  }

  get currentFrameId(): string | null {
    return this.frameOverride ?? this.session?.activeFrameId ?? null;
  }

  private updateComposite(): void {
    const s = this.session;
    const frameId = this.currentFrameId;
    if (!s || !frameId) return;
    const { width, height } = s.state;
    if (!this.composite || this.composite.width !== width || this.composite.height !== height) {
      this.composite = new PixelBuffer(width, height);
      this.compositeCanvas.width = width;
      this.compositeCanvas.height = height;
      this.imageData = new ImageData(width, height);
      this.allDirty = true;
    }
    if (!this.allDirty && !this.dirty) return;
    const region = this.allDirty ? this.composite.bounds : intersectRect(this.dirty!, this.composite.bounds);
    this.allDirty = false;
    this.dirty = null;
    if (rectIsEmpty(region)) return;
    const draft = s.draft;
    const overrides = draft && draft.frameId === frameId ? new Map([[draft.key, draft.buffer]]) : undefined;
    composeFrame(s.state, s.lookup, frameId, { region, overrides }, this.composite);
    const img = this.imageData!;
    // Copy the region into the ImageData then upload just that region.
    for (let y = region.y; y < region.y + region.h; y++) {
      const o = (y * width + region.x) * 4;
      img.data.set(this.composite.data.subarray(o, o + region.w * 4), o);
    }
    this.compositeCtx.putImageData(img, 0, 0, region.x, region.y, region.w, region.h);
  }

  private checkerPattern(): CanvasPattern | null {
    const { checkerA, checkerB, checkerSize } = this.settings;
    const key = `${checkerA}|${checkerB}|${checkerSize}`;
    if (this.checker && this.checkerKey === key) return this.checker;
    const c = document.createElement('canvas');
    c.width = c.height = checkerSize * 2;
    const g = c.getContext('2d')!;
    g.fillStyle = checkerA;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = checkerB;
    g.fillRect(checkerSize, 0, checkerSize, checkerSize);
    g.fillRect(0, checkerSize, checkerSize, checkerSize);
    this.checker = this.ctx.createPattern(c, 'repeat');
    this.checkerKey = key;
    return this.checker;
  }

  private onionLayer(): HTMLCanvasElement | null {
    const s = this.session;
    const o = this.settings.onion;
    const frameId = this.currentFrameId;
    if (!s || !o.enabled || !frameId || this.frameOverride) return null;
    const frames = s.state.frames;
    const idx = frames.findIndex((f) => f.id === frameId);
    const near: string[] = [];
    for (let i = idx - o.before; i <= idx + o.after; i++) if (i !== idx && frames[i]) near.push(frameSignature(s, frames[i]!.id));
    const key = `${near.join(';')}|${idx}|${o.before}|${o.after}|${o.opacity}|${o.beforeColor}|${o.afterColor}`;
    if (this.onionCanvas && this.onionKey === key) return this.onionCanvas;
    const { width, height } = s.state;
    const c = this.onionCanvas ?? document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, width, height);
    const tint = (frameIndex: number, color: string, alpha: number): void => {
      const f = frames[frameIndex];
      if (!f) return;
      const buf = composeFrame(s.state, s.lookup, f.id);
      const tmp = document.createElement('canvas');
      tmp.width = width;
      tmp.height = height;
      const tg = tmp.getContext('2d')!;
      tg.putImageData(new ImageData(new Uint8ClampedArray(buf.data), width, height), 0, 0);
      tg.globalCompositeOperation = 'source-atop';
      tg.globalAlpha = 0.5;
      tg.fillStyle = color;
      tg.fillRect(0, 0, width, height);
      g.globalAlpha = alpha;
      g.drawImage(tmp, 0, 0);
    };
    for (let i = o.before; i >= 1; i--) tint(idx - i, o.beforeColor, (o.opacity * (o.before - i + 1)) / o.before);
    for (let i = o.after; i >= 1; i--) tint(idx + i, o.afterColor, (o.opacity * (o.after - i + 1)) / o.after);
    g.globalAlpha = 1;
    this.onionCanvas = c;
    this.onionKey = key;
    return c;
  }

  /** Advances the marching-ants animation (called by a timer while a selection exists). */
  tickAnts(): void {
    this.antsOffset = (this.antsOffset + 1) % 8;
    this.request();
  }

  draw(): void {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const pw = Math.max(1, Math.round(cw * dpr));
    const ph = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.settings.workspace;
    ctx.fillRect(0, 0, cw, ch);
    const s = this.session;
    if (!s) return;
    this.updateComposite();
    const { zoom, offsetX, offsetY } = this.transform;
    const w = s.state.width * zoom;
    const h = s.state.height * zoom;

    // Transparency background
    ctx.save();
    if (this.settings.canvasBackground) ctx.fillStyle = this.settings.canvasBackground;
    else {
      const pat = this.checkerPattern();
      if (pat) {
        pat.setTransform(new DOMMatrix().translate(offsetX, offsetY));
        ctx.fillStyle = pat;
      }
    }
    ctx.fillRect(offsetX, offsetY, w, h);
    ctx.restore();

    if (this.settings.tiledPreview) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (dx || dy) ctx.drawImage(this.compositeCanvas, offsetX + dx * w, offsetY + dy * h, w, h);
      ctx.restore();
    }

    const onion = this.onionLayer();
    if (onion) ctx.drawImage(onion, offsetX, offsetY, w, h);
    ctx.drawImage(this.compositeCanvas, offsetX, offsetY, w, h);

    const fl = this.overlay.floating;
    if (fl) {
      if (this.floatingRef !== fl.buffer) {
        const c = this.floatingCanvas ?? document.createElement('canvas');
        c.width = fl.buffer.width;
        c.height = fl.buffer.height;
        c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(fl.buffer.data), fl.buffer.width, fl.buffer.height), 0, 0);
        this.floatingCanvas = c;
        this.floatingRef = fl.buffer;
      }
      ctx.drawImage(this.floatingCanvas!, offsetX + fl.x * zoom, offsetY + fl.y * zoom, fl.buffer.width * zoom, fl.buffer.height * zoom);
    }

    this.drawGrids(ctx, s.state.width, s.state.height, cw, ch);

    // Document border
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX - 0.5, offsetY - 0.5, w + 1, h + 1);

    if (this.settings.showGuides) {
      ctx.strokeStyle = 'rgba(0, 200, 255, 0.85)';
      ctx.beginPath();
      for (const g of s.state.guides) {
        if (g.axis === 'x') {
          const x = Math.round(offsetX + g.position * zoom) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, ch);
        } else {
          const y = Math.round(offsetY + g.position * zoom) + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(cw, y);
        }
      }
      ctx.stroke();
    }

    const sym = s.state.symmetry;
    if (this.settings.showSymmetryAxes && (sym.vertical || sym.horizontal)) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 79, 129, 0.9)';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (sym.vertical) {
        const x = Math.round(offsetX + sym.axisX * zoom) + 0.5;
        ctx.moveTo(x, offsetY - 8);
        ctx.lineTo(x, offsetY + h + 8);
      }
      if (sym.horizontal) {
        const y = Math.round(offsetY + sym.axisY * zoom) + 0.5;
        ctx.moveTo(offsetX - 8, y);
        ctx.lineTo(offsetX + w + 8, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    this.drawSelection(ctx);
    this.drawHandles(ctx);
    this.drawCursor(ctx);
  }

  /** Curve handles: lines from each end point to its control point, plus small squares. */
  private drawHandles(ctx: CanvasRenderingContext2D): void {
    const h = this.overlay.handles;
    if (!h || h.length !== 4) return;
    const { zoom, offsetX, offsetY } = this.transform;
    const at = (p: Point): [number, number] => [offsetX + (p.x + 0.5) * zoom, offsetY + (p.y + 0.5) * zoom];
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(46, 196, 182, 0.9)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (const [a, b] of [
      [h[0]!, h[1]!],
      [h[3]!, h[2]!],
    ] as const) {
      ctx.moveTo(...at(a));
      ctx.lineTo(...at(b));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of h) {
      const [x, y] = at(p);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 7, 7);
      ctx.strokeStyle = '#1b1726';
      ctx.strokeRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 8, 8);
    }
    ctx.restore();
  }

  private drawGrids(ctx: CanvasRenderingContext2D, dw: number, dh: number, cw: number, ch: number): void {
    const { zoom, offsetX, offsetY } = this.transform;
    const st = this.settings;
    const x0 = Math.max(0, Math.floor(-offsetX / zoom));
    const x1 = Math.min(dw, Math.ceil((cw - offsetX) / zoom));
    const y0 = Math.max(0, Math.floor(-offsetY / zoom));
    const y1 = Math.min(dh, Math.ceil((ch - offsetY) / zoom));
    if (st.pixelGrid && zoom >= st.pixelGridMinZoom) {
      ctx.strokeStyle = st.gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        const sx = Math.round(offsetX + x * zoom) + 0.5;
        ctx.moveTo(sx, offsetY + y0 * zoom);
        ctx.lineTo(sx, offsetY + y1 * zoom);
      }
      for (let y = y0; y <= y1; y++) {
        const sy = Math.round(offsetY + y * zoom) + 0.5;
        ctx.moveTo(offsetX + x0 * zoom, sy);
        ctx.lineTo(offsetX + x1 * zoom, sy);
      }
      ctx.stroke();
    }
    const t = this.session?.state.tiles;
    if (st.tileGrid && t && t.width * zoom >= 4 && t.height * zoom >= 4) {
      ctx.strokeStyle = st.tileGridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = t.offsetX % t.width; x <= dw; x += t.width) {
        const sx = Math.round(offsetX + x * zoom) + 0.5;
        ctx.moveTo(sx, offsetY);
        ctx.lineTo(sx, offsetY + dh * zoom);
      }
      for (let y = t.offsetY % t.height; y <= dh; y += t.height) {
        const sy = Math.round(offsetY + y * zoom) + 0.5;
        ctx.moveTo(offsetX, sy);
        ctx.lineTo(offsetX + dw * zoom, sy);
      }
      ctx.stroke();
    }
  }

  /** Active selection outline: explicit overlay wins over the session's selection. */
  get shownSelection(): { bounds: Rect; mask: Uint8Array } | null {
    return this.overlay.selection ?? this.session?.selection ?? null;
  }

  /** Boundary edges of a selection mask (x0,y0,x1,y1 quadruples in document pixels), cached per mask. */
  private selectionEdges(sel: { bounds: Rect; mask: Uint8Array }): Int32Array {
    if (this.edgeCache?.sel === sel) return this.edgeCache.edges;
    const { bounds: b, mask } = sel;
    const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < b.w && y < b.h && mask[y * b.w + x] === 1;
    const out: number[] = [];
    // Horizontal edges, merged into runs.
    for (let y = 0; y <= b.h; y++) {
      let run = -1;
      for (let x = 0; x <= b.w; x++) {
        const edge = x < b.w && at(x, y) !== at(x, y - 1);
        if (edge && run < 0) run = x;
        else if (!edge && run >= 0) {
          out.push(b.x + run, b.y + y, b.x + x, b.y + y);
          run = -1;
        }
      }
    }
    for (let x = 0; x <= b.w; x++) {
      let run = -1;
      for (let y = 0; y <= b.h; y++) {
        const edge = y < b.h && at(x, y) !== at(x - 1, y);
        if (edge && run < 0) run = y;
        else if (!edge && run >= 0) {
          out.push(b.x + x, b.y + run, b.x + x, b.y + y);
          run = -1;
        }
      }
    }
    const edges = Int32Array.from(out);
    this.edgeCache = { sel, edges };
    return edges;
  }

  /** True when marching ants need animating. */
  get hasAnts(): boolean {
    return !!(this.shownSelection || this.overlay.marquee || this.overlay.lasso || this.overlay.ellipse);
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    const { zoom, offsetX, offsetY } = this.transform;
    const path = new Path2D();
    const sel = this.shownSelection;
    if (sel) {
      const e = this.selectionEdges(sel);
      const ox = offsetX + (this.overlay.selectionOffset?.x ?? 0) * zoom;
      const oy = offsetY + (this.overlay.selectionOffset?.y ?? 0) * zoom;
      for (let i = 0; i < e.length; i += 4) {
        const horizontal = e[i + 1] === e[i + 3];
        const x0 = ox + e[i]! * zoom;
        const y0 = oy + e[i + 1]! * zoom;
        const x1 = ox + e[i + 2]! * zoom;
        const y1 = oy + e[i + 3]! * zoom;
        if (horizontal) {
          const sy = Math.round(y0) + 0.5;
          path.moveTo(x0, sy);
          path.lineTo(x1, sy);
        } else {
          const sx = Math.round(x0) + 0.5;
          path.moveTo(sx, y0);
          path.lineTo(sx, y1);
        }
      }
    }
    const m = this.overlay.marquee;
    if (m) path.rect(Math.round(offsetX + m.x * zoom) + 0.5, Math.round(offsetY + m.y * zoom) + 0.5, m.w * zoom, m.h * zoom);
    const lasso = this.overlay.lasso;
    if (lasso && lasso.length) {
      lasso.forEach((p, i) => {
        const sx = offsetX + (p.x + 0.5) * zoom;
        const sy = offsetY + (p.y + 0.5) * zoom;
        if (i === 0) path.moveTo(sx, sy);
        else path.lineTo(sx, sy);
      });
      path.closePath();
    }
    const el = this.overlay.ellipse;
    if (el) {
      const rx = (el.w * zoom) / 2;
      const ry = (el.h * zoom) / 2;
      path.moveTo(offsetX + el.x * zoom + 2 * rx, offsetY + el.y * zoom + ry);
      path.ellipse(offsetX + el.x * zoom + rx, offsetY + el.y * zoom + ry, rx, ry, 0, 0, Math.PI * 2);
    }
    if (!sel && !m && !lasso && !el) return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = this.antsOffset;
    ctx.stroke(path);
    ctx.strokeStyle = '#fff';
    ctx.lineDashOffset = this.antsOffset + 4;
    ctx.stroke(path);
    ctx.restore();
  }

  private drawCursor(ctx: CanvasRenderingContext2D): void {
    const px = this.overlay.cursorPixels;
    if (!px || px.length === 0) return;
    const { zoom, offsetX, offsetY } = this.transform;
    const set = new Set(px.map((p) => `${p.x},${p.y}`));
    const has = (x: number, y: number): boolean => set.has(`${x},${y}`);
    ctx.save();
    ctx.beginPath();
    for (const p of px) {
      const sx = offsetX + p.x * zoom;
      const sy = offsetY + p.y * zoom;
      if (!has(p.x, p.y - 1)) {
        ctx.moveTo(sx, sy + 0.5);
        ctx.lineTo(sx + zoom, sy + 0.5);
      }
      if (!has(p.x, p.y + 1)) {
        ctx.moveTo(sx, sy + zoom - 0.5);
        ctx.lineTo(sx + zoom, sy + zoom - 0.5);
      }
      if (!has(p.x - 1, p.y)) {
        ctx.moveTo(sx + 0.5, sy);
        ctx.lineTo(sx + 0.5, sy + zoom);
      }
      if (!has(p.x + 1, p.y)) {
        ctx.moveTo(sx + zoom - 0.5, sy);
        ctx.lineTo(sx + zoom - 0.5, sy + zoom);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.stroke();
    ctx.translate(0.0, 0.0);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = this.overlay.cursorColor;
    ctx.stroke();
    ctx.restore();
  }
}
