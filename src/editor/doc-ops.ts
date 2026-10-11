import { composeFrame } from '../layers/compose';
import { checkDimensions } from '../project/limits';
import { celKey, findLayer, pixelLayers, type DocState, type ImageId } from '../project/model';
import { colorDistance, type RGBA } from '../raster/color';
import { PixelBuffer } from '../raster/pixel-buffer';
import type { Rect } from '../raster/rect';
import { resizeNearest } from '../raster/scale';
import { drawOver, flipH, flipV, invertColors, offset, rotate } from './raster-ops';
import type { Selection } from './selection';
import { EditorError, type EditorContext, type EditorSession } from './session';

/** Which cels an image operation touches. */
export type CelScope = 'cel' | 'frame' | 'layer' | 'all';

export const SCOPE_LABELS: Record<CelScope, string> = {
  cel: 'Camada atual, quadro atual',
  frame: 'Todas as camadas do quadro atual',
  layer: 'Camada atual, todos os quadros',
  all: 'Documento inteiro',
};

/** Anchor as fractions: 0 = left/top, 0.5 = centre, 1 = right/bottom. */
export interface Anchor {
  ax: 0 | 0.5 | 1;
  ay: 0 | 0.5 | 1;
}

function celKeysInScope(s: EditorSession, scope: CelScope, editableOnly: boolean): string[] {
  const st = s.state;
  const layers = pixelLayers(st.layers).filter((l) => !editableOnly || s.canEditLayer(l.id));
  const frames = st.frames;
  const keys: string[] = [];
  for (const l of layers) {
    if ((scope === 'cel' || scope === 'layer') && l.id !== s.activeLayerId) continue;
    for (const f of frames) {
      if ((scope === 'cel' || scope === 'frame') && f.id !== s.activeFrameId) continue;
      keys.push(celKey(l.id, f.id));
    }
  }
  return keys;
}

/**
 * Replaces the images of the given cels with `fn(image)` in one history entry.
 * Linked cels (sharing an image) stay linked. Returns false if nothing changed.
 */
function mapCels(
  s: EditorSession,
  label: string,
  keys: string[],
  fn: (img: PixelBuffer, key: string) => PixelBuffer | null,
  patch?: (st: DocState) => DocState,
  ctx?: Partial<EditorContext>,
  includeEmpty = false,
): boolean {
  s.cancelDraft();
  const st = s.state;
  const cels: Record<string, ImageId> = { ...st.cels };
  const mapped = new Map<ImageId, ImageId | null>();
  const newImages: ImageId[] = [];
  let changed = false;
  for (const key of keys) {
    const id = st.cels[key];
    if (!id && !includeEmpty) continue;
    if (id && mapped.has(id)) {
      const m = mapped.get(id);
      if (m) cels[key] = m;
      continue;
    }
    const src = id ? s.image(id) : new PixelBuffer(st.width, st.height);
    if (!src) continue;
    const out = fn(src, key);
    if (!out || (out.width === src.width && out.height === src.height && out.equals(src))) {
      if (id) mapped.set(id, null);
      continue;
    }
    const nid = s.addImage(out);
    newImages.push(nid);
    if (id) mapped.set(id, nid);
    cels[key] = nid;
    changed = true;
  }
  const next = patch ? patch({ ...st, cels }) : { ...st, cels };
  if (!changed && !patch) {
    s.collectGarbage();
    return false;
  }
  s.commit(label, next, [], newImages, ctx ? { ...s.context, ...ctx } : undefined);
  return true;
}

function requireAnyEditable(s: EditorSession, keys: string[]): void {
  if (keys.length === 0) throw new EditorError('Nenhuma camada editável no escopo escolhido (camadas bloqueadas ou grupos).');
}

/* ---------------- document geometry ---------------- */

function assertDimensions(w: number, h: number): void {
  const err = checkDimensions(w, h);
  if (err) throw new EditorError(err);
}

function adjustGeometry(st: DocState, w: number, h: number, dx: number, dy: number): DocState {
  const guides = st.guides
    .map((g) => ({ ...g, position: g.position + (g.axis === 'x' ? dx : dy) }))
    .filter((g) => g.position >= 0 && g.position <= (g.axis === 'x' ? w : h));
  const sym = st.symmetry;
  const axisX = sym.axisX + dx;
  const axisY = sym.axisY + dy;
  return {
    ...st,
    width: w,
    height: h,
    guides,
    symmetry: {
      ...sym,
      axisX: axisX > 0 && axisX < w ? axisX : w / 2,
      axisY: axisY > 0 && axisY < h ? axisY : h / 2,
    },
  };
}

/** Changes the canvas size without scaling; content is placed by the anchor. */
export function resizeCanvas(s: EditorSession, w: number, h: number, anchor: Anchor): void {
  assertDimensions(w, h);
  const st = s.state;
  if (w === st.width && h === st.height) return;
  const dx = Math.round((w - st.width) * anchor.ax);
  const dy = Math.round((h - st.height) * anchor.ay);
  mapCels(
    s,
    'Redimensionar tela',
    Object.keys(st.cels),
    (img) => {
      const out = new PixelBuffer(w, h);
      out.paste(img, dx, dy);
      return out;
    },
    (next) => adjustGeometry(next, w, h, dx, dy),
    { selection: null },
  );
}

/** Scales every cel with nearest neighbour (pixel art never gets blurred). */
export function resizeContent(s: EditorSession, w: number, h: number): void {
  assertDimensions(w, h);
  const st = s.state;
  if (w === st.width && h === st.height) return;
  const sx = w / st.width;
  const sy = h / st.height;
  mapCels(
    s,
    'Redimensionar imagem',
    Object.keys(st.cels),
    (img) => resizeNearest(img, w, h),
    (next) => ({
      ...adjustGeometry(next, w, h, 0, 0),
      guides: next.guides.map((g) => ({ ...g, position: Math.round(g.position * (g.axis === 'x' ? sx : sy)) })),
      symmetry: { ...next.symmetry, axisX: w / 2, axisY: h / 2 },
    }),
    { selection: null },
  );
}

/** Crops the document to a rectangle (clipped to the canvas). */
export function cropTo(s: EditorSession, r: Rect): void {
  const st = s.state;
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(st.width, r.x + r.w);
  const y1 = Math.min(st.height, r.y + r.h);
  if (x1 <= x0 || y1 <= y0) throw new EditorError('A área de recorte está vazia.');
  const w = x1 - x0;
  const h = y1 - y0;
  if (w === st.width && h === st.height) return;
  mapCels(
    s,
    'Recortar',
    Object.keys(st.cels),
    (img) => img.extract({ x: x0, y: y0, w, h }),
    (next) => adjustGeometry(next, w, h, -x0, -y0),
    { selection: null },
  );
}

export function cropToSelection(s: EditorSession): void {
  const sel = s.selection;
  if (!sel) throw new EditorError('Faça uma seleção antes de recortar.');
  cropTo(s, sel.bounds);
}

/** Bounds of all visible content across every frame, or null if empty. */
export function contentBoundsAllFrames(s: EditorSession): Rect | null {
  let out: Rect | null = null;
  for (const f of s.state.frames) {
    const img = composeFrame(s.state, s.lookup, f.id, { includeHidden: true });
    const b = img.contentBounds();
    if (!b) continue;
    if (!out) out = b;
    else {
      const x0 = Math.min(out.x, b.x);
      const y0 = Math.min(out.y, b.y);
      out = { x: x0, y: y0, w: Math.max(out.x + out.w, b.x + b.w) - x0, h: Math.max(out.y + out.h, b.y + b.h) - y0 };
    }
  }
  return out;
}

/** Removes transparent borders shared by all frames. */
export function trimDocument(s: EditorSession): void {
  const b = contentBoundsAllFrames(s);
  if (!b) throw new EditorError('O documento está vazio; não há o que aparar.');
  cropTo(s, b);
}

export function rotateDocument(s: EditorSession, deg: 90 | 180 | 270): void {
  const st = s.state;
  const swap = deg !== 180;
  const w = swap ? st.height : st.width;
  const h = swap ? st.width : st.height;
  mapCels(
    s,
    deg === 90 ? 'Girar 90° horário' : deg === 270 ? 'Girar 90° anti-horário' : 'Girar 180°',
    Object.keys(st.cels),
    (img) => rotate(img, deg),
    (next) => ({ ...next, width: w, height: h, guides: [], symmetry: { ...next.symmetry, axisX: w / 2, axisY: h / 2 } }),
    { selection: null },
  );
}

export function flipDocument(s: EditorSession, axis: 'h' | 'v'): void {
  const st = s.state;
  mapCels(s, axis === 'h' ? 'Espelhar documento horizontalmente' : 'Espelhar documento verticalmente', Object.keys(st.cels), (img) =>
    axis === 'h' ? flipH(img) : flipV(img),
  );
}

/* ---------------- pixel operations on cels ---------------- */

function maskOf(sel: Selection | null): ((x: number, y: number) => boolean) | undefined {
  if (!sel) return undefined;
  const b = sel.bounds;
  return (x, y) => {
    const lx = x - b.x;
    const ly = y - b.y;
    return lx >= 0 && ly >= 0 && lx < b.w && ly < b.h && sel.mask[ly * b.w + lx] === 1;
  };
}

/** Offsets the content of the cels in scope, optionally wrapping around. */
export function offsetContent(s: EditorSession, dx: number, dy: number, wrap: boolean, scope: CelScope = 'cel'): void {
  if (!dx && !dy) return;
  const keys = celKeysInScope(s, scope, true);
  requireAnyEditable(s, keys);
  mapCels(s, 'Deslocar', keys, (img) => offset(img, dx, dy, wrap));
}

/** Moves the active layer content so its bounding box is centred. */
export function centerContent(s: EditorSession, scope: CelScope = 'cel'): void {
  const keys = celKeysInScope(s, scope, true);
  requireAnyEditable(s, keys);
  mapCels(s, 'Centralizar conteúdo', keys, (img) => {
    const b = img.contentBounds();
    if (!b) return null;
    const dx = Math.floor((img.width - b.w) / 2) - b.x;
    const dy = Math.floor((img.height - b.h) / 2) - b.y;
    return offset(img, dx, dy, false);
  });
}

export function invertCels(s: EditorSession, scope: CelScope = 'cel'): void {
  const keys = celKeysInScope(s, scope, true);
  requireAnyEditable(s, keys);
  const m = maskOf(s.selection);
  mapCels(s, 'Inverter cores', keys, (img) => invertColors(img, m));
}

/** Clears pixels in scope (limited to the selection if there is one). */
export function clearCels(s: EditorSession, scope: CelScope = 'cel'): void {
  const keys = celKeysInScope(s, scope, true);
  requireAnyEditable(s, keys);
  const m = maskOf(s.selection);
  const label = scope === 'cel' ? 'Limpar camada' : scope === 'frame' ? 'Limpar quadro' : scope === 'layer' ? 'Limpar camada em todos os quadros' : 'Limpar documento';
  mapCels(s, label, keys, (img) => {
    if (!m) return img.isEmpty() ? null : new PixelBuffer(img.width, img.height);
    const out = img.clone();
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (m(x, y)) out.set(x, y, 0);
    return out;
  });
}

/** Fills the selection (or the whole cel) with a colour. */
export function fillCels(s: EditorSession, color: RGBA, scope: CelScope = 'cel'): void {
  const keys = celKeysInScope(s, scope, true);
  requireAnyEditable(s, keys);
  const m = maskOf(s.selection);
  mapCels(
    s,
    'Preencher seleção',
    keys,
    (img) => {
      const out = img.clone();
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (!m || m(x, y)) out.set(x, y, color);
      return out;
    },
    undefined,
    undefined,
    true,
  );
}

/**
 * Replaces one colour by another. Tolerance 0 matches exactly; alpha is
 * compared too, so transparent pixels only match a transparent source.
 */
export function replaceColor(s: EditorSession, from: RGBA, to: RGBA, tolerance: number, scope: CelScope = 'cel'): number {
  const keys = celKeysInScope(s, scope, true);
  requireAnyEditable(s, keys);
  const m = maskOf(s.selection);
  let count = 0;
  mapCels(s, 'Substituir cor', keys, (img) => {
    let out: PixelBuffer | null = null;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        if (m && !m(x, y)) continue;
        const c = img.get(x, y);
        if (c === from || (tolerance > 0 && colorDistance(c, from) <= tolerance)) {
          out ??= img.clone();
          out.set(x, y, to);
          count++;
        }
      }
    return out;
  });
  return count;
}

/** Applies a pure pixel mapping (used by palette reduction). */
export function mapColors(s: EditorSession, label: string, fn: (c: RGBA) => RGBA, scope: CelScope = 'all', patch?: (st: DocState) => DocState): void {
  const keys = celKeysInScope(s, scope, true);
  requireAnyEditable(s, keys);
  const m = maskOf(s.selection);
  mapCels(s, label, keys, (img) => {
    let out: PixelBuffer | null = null;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        if (m && !m(x, y)) continue;
        const c = img.get(x, y);
        const n = fn(c);
        if (n !== c) {
          out ??= img.clone();
          out.set(x, y, n);
        }
      }
    return out;
  }, patch);
}

/** Composites a full-size buffer over the active cel (used by import as layer, etc.). */
export function stampOnActive(s: EditorSession, label: string, buf: PixelBuffer, x = 0, y = 0): void {
  const key = celKey(s.activeLayerId, s.activeFrameId);
  if (!s.canEditLayer()) throw new EditorError('A camada ativa está bloqueada ou não é uma camada de pixels.');
  mapCels(
    s,
    label,
    [key],
    (img) => {
      const out = img.clone();
      drawOver(out, buf, x, y);
      return out;
    },
    undefined,
    undefined,
    true,
  );
}

export function layerName(s: EditorSession): string {
  return findLayer(s.state.layers, s.activeLayerId)?.layer.name ?? '';
}
