import { PixelBuffer } from '../raster/pixel-buffer';
import { resizeNearest } from '../raster/scale';
import { composeFrame } from '../layers/compose';
import { drawOver, flipH, flipV, rotate } from './raster-ops';
import { clipSelection, rectSelection, translateSelection, type Selection } from './selection';
import { EditorError, type EditorSession } from './session';
import type { CustomBrush } from './painter';

/** Pixels lifted out of a selection, positioned in document coordinates. */
export interface Piece {
  buffer: PixelBuffer;
  x: number;
  y: number;
  /** Mask of the piece (1 = part of the content). */
  mask: Uint8Array;
}

export function wholeLayerSelection(s: EditorSession): Selection {
  return rectSelection({ x: 0, y: 0, w: s.state.width, h: s.state.height });
}

/** Copies the selected pixels (unselected pixels become transparent). */
export function extractPiece(img: PixelBuffer, sel: Selection): Piece {
  const b = sel.bounds;
  const buffer = img.extract(b);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) if (!sel.mask[y * b.w + x]) buffer.set(x, y, 0);
  return { buffer, x: b.x, y: b.y, mask: sel.mask };
}

function activeImageOrBlank(s: EditorSession): PixelBuffer {
  return s.celImage(s.activeLayerId, s.activeFrameId)?.clone() ?? new PixelBuffer(s.state.width, s.state.height);
}

function requireEditable(s: EditorSession): void {
  if (!s.canEditLayer()) throw new EditorError('A camada ativa está bloqueada ou não é uma camada de pixels.');
}

/** Writes a full replacement of the active cel restricted to its changed area. */
function commitActive(s: EditorSession, label: string, next: PixelBuffer, sel: Selection | null | undefined): void {
  const before = s.celImage(s.activeLayerId, s.activeFrameId) ?? new PixelBuffer(s.state.width, s.state.height);
  const rect = before.diffBounds(next);
  const ctx = sel === undefined ? undefined : { ...s.context, selection: sel };
  if (!rect) {
    if (ctx) s.setSelection(ctx.selection, label);
    return;
  }
  s.writeCel(label, s.activeLayerId, s.activeFrameId, [{ rect, pixels: next.extract(rect) }], ctx);
}

export function deleteSelected(s: EditorSession): void {
  requireEditable(s);
  const sel = s.selection ?? wholeLayerSelection(s);
  const img = activeImageOrBlank(s);
  const b = sel.bounds;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (sel.mask[y * b.w + x]) img.set(b.x + x, b.y + y, 0);
  commitActive(s, 'Apagar seleção', img, undefined);
}

/** Copy of the selection from the active layer, or from the visible composition. */
export function copySelection(s: EditorSession, merged = false): Piece | null {
  const sel = s.selection ?? wholeLayerSelection(s);
  const src = merged
    ? composeFrame(s.state, s.lookup, s.activeFrameId)
    : s.celImage(s.activeLayerId, s.activeFrameId) ?? new PixelBuffer(s.state.width, s.state.height);
  const piece = extractPiece(src, sel);
  return piece.buffer.isEmpty() ? null : piece;
}

export function cutSelection(s: EditorSession): Piece | null {
  requireEditable(s);
  const piece = copySelection(s);
  if (piece) deleteSelected(s);
  return piece;
}

/**
 * Pastes a piece over the active layer at (x, y), clipped to the document,
 * and selects the pasted area so it can be moved right away.
 */
export function pastePiece(s: EditorSession, piece: Piece, x: number, y: number, label = 'Colar'): void {
  requireEditable(s);
  const img = activeImageOrBlank(s);
  drawOver(img, piece.buffer, x, y);
  const sel = clipSelection({ bounds: { x, y, w: piece.buffer.width, h: piece.buffer.height }, mask: piece.mask }, s.state.width, s.state.height);
  commitActive(s, label, img, sel);
}

/**
 * Moves (or duplicates) the selected pixels by (dx, dy) in one history entry.
 * Without a selection the whole layer moves.
 */
export function moveSelected(s: EditorSession, dx: number, dy: number, duplicate = false): void {
  requireEditable(s);
  if (dx === 0 && dy === 0) return;
  const hadSelection = !!s.selection;
  const sel = s.selection ?? wholeLayerSelection(s);
  const img = activeImageOrBlank(s);
  const piece = extractPiece(img, sel);
  if (!duplicate) {
    const b = sel.bounds;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (sel.mask[y * b.w + x]) img.set(b.x + x, b.y + y, 0);
  }
  drawOver(img, piece.buffer, piece.x + dx, piece.y + dy);
  const moved = hadSelection ? translateSelection(sel, dx, dy) : null;
  commitActive(s, duplicate ? 'Duplicar seleção' : 'Mover', img, hadSelection ? moved : undefined);
}

/** Preview helper for the move tool: the layer with the piece lifted and re-placed. */
export function previewMove(original: PixelBuffer, sel: Selection, dx: number, dy: number, duplicate: boolean, out: PixelBuffer): void {
  out.paste(original, 0, 0);
  const piece = extractPiece(original, sel);
  if (!duplicate) {
    const b = sel.bounds;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (sel.mask[y * b.w + x]) out.set(b.x + x, b.y + y, 0);
  }
  drawOver(out, piece.buffer, piece.x + dx, piece.y + dy);
}

type PieceTransform = (b: PixelBuffer) => PixelBuffer;

/**
 * Applies a transform to the selected pixels (or the whole layer), keeping
 * the result centred on the original area, and updates the selection mask.
 */
export function transformSelected(s: EditorSession, label: string, fn: PieceTransform): void {
  requireEditable(s);
  const hadSelection = !!s.selection;
  const sel = s.selection ?? wholeLayerSelection(s);
  const img = activeImageOrBlank(s);
  const piece = extractPiece(img, sel);
  const b = sel.bounds;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (sel.mask[y * b.w + x]) img.set(b.x + x, b.y + y, 0);
  const maskBuf = new PixelBuffer(b.w, b.h);
  for (let i = 0; i < sel.mask.length; i++) if (sel.mask[i]) maskBuf.data[i * 4 + 3] = 255;
  const out = fn(piece.buffer);
  const outMask = fn(maskBuf);
  const nx = b.x + Math.floor((b.w - out.width) / 2);
  const ny = b.y + Math.floor((b.h - out.height) / 2);
  drawOver(img, out, nx, ny);
  const mask = new Uint8Array(out.width * out.height);
  for (let i = 0; i < mask.length; i++) mask[i] = outMask.data[i * 4 + 3]! > 0 ? 1 : 0;
  const nextSel = hadSelection ? clipSelection({ bounds: { x: nx, y: ny, w: out.width, h: out.height }, mask }, s.state.width, s.state.height) : undefined;
  commitActive(s, label, img, nextSel);
}

export const flipSelectedH = (s: EditorSession): void => transformSelected(s, 'Espelhar horizontalmente', flipH);
export const flipSelectedV = (s: EditorSession): void => transformSelected(s, 'Espelhar verticalmente', flipV);
export const rotateSelected = (s: EditorSession, deg: 90 | 180 | 270): void => transformSelected(s, `Girar ${deg}°`, (b) => rotate(b, deg));
export const scaleSelected = (s: EditorSession, w: number, h: number): void =>
  transformSelected(s, 'Redimensionar seleção', (b) => resizeNearest(b, w, h));

/** Selection from a piece placed at its position (used after pasting). */
export function pieceSelection(piece: Piece, x: number, y: number): Selection {
  return { bounds: { x, y, w: piece.buffer.width, h: piece.buffer.height }, mask: piece.mask };
}


/**
 * Captures the selected pixels of the active layer as a custom brush, centred
 * on the pointer like the round and square tips. Transparent pixels are not
 * part of the brush.
 */
export function brushFromSelection(s: EditorSession): CustomBrush {
  const sel = s.selection;
  if (!sel) throw new EditorError('Selecione a área que vai virar pincel.');
  const img = s.celImage(s.activeLayerId, s.activeFrameId);
  const b = sel.bounds;
  const pixels: CustomBrush['pixels'] = [];
  const ox = Math.floor(b.w / 2);
  const oy = Math.floor(b.h / 2);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (!sel.mask[y * b.w + x]) continue;
      const c = img?.get(b.x + x, b.y + y) ?? 0;
      if ((c & 255) !== 0) pixels.push({ x: x - ox, y: y - oy, c });
    }
  if (!pixels.length) throw new EditorError('A seleção está vazia nesta camada; não há pixels para o pincel.');
  if (pixels.length > 128 * 128) throw new EditorError('A seleção é grande demais para um pincel (máximo 128×128).');
  return { pixels };
}
