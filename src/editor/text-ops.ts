import { PIXELCRAFT_SANS, renderText, type TextLayoutOptions, type TextMask } from '../raster/bitmap-font';
import type { RGBA } from '../raster/color';
import { PixelBuffer } from '../raster/pixel-buffer';
import type { Rect } from '../raster/rect';
import { Painter } from './painter';
import type { EditorSession } from './session';

export interface TextStampOptions extends TextLayoutOptions {
  color: RGBA;
  /**
   * A mask already rasterized by another font (a system or loaded TTF font,
   * see ui/text/system-font). When absent the built-in pixel font is used.
   */
  mask?: TextMask;
}

function maskFor(text: string, opts: TextLayoutOptions & { mask?: TextMask }): TextMask {
  return opts.mask ?? renderText(text, PIXELCRAFT_SANS, opts);
}

/** Bounds of the text block placed with its top-left corner at (x, y). */
export function textBounds(text: string, x: number, y: number, opts: TextLayoutOptions & { mask?: TextMask }): Rect {
  const m = maskFor(text, opts);
  return { x, y, w: m.width, h: m.height };
}

/**
 * Draws text into the session's current draft (which must exist), replacing
 * whatever was previewed before. Respects the selection. Returns the dirty rect.
 */
export function drawTextIntoDraft(session: EditorSession, text: string, x: number, y: number, opts: TextStampOptions): Rect | null {
  const draft = session.draft;
  if (!draft) return null;
  session.resetDraft();
  if (!text) return null;
  const m = maskFor(text, opts);
  const painter = new Painter(draft.buffer, {
    color: opts.color,
    size: 1,
    shape: 'square',
    mode: 'replace',
    opacity: 1,
    selection: session.selection,
    symmetry: null,
  });
  for (let py = 0; py < m.height; py++)
    for (let px = 0; px < m.width; px++) if (m.mask[py * m.width + px]) painter.dot(x + px, y + py);
  session.touchDraft(painter.dirty);
  return painter.dirty;
}

/** Stamps text on the active cel as one history entry. */
export function stampText(session: EditorSession, text: string, x: number, y: number, opts: TextStampOptions): boolean {
  session.beginDraft();
  drawTextIntoDraft(session, text, x, y, opts);
  return session.commitDraft('Texto');
}

/** Text drawn alone on a transparent image of the given size (for a new layer). */
export function textImage(width: number, height: number, text: string, x: number, y: number, opts: TextStampOptions): PixelBuffer {
  const out = new PixelBuffer(width, height);
  const m = maskFor(text, opts);
  for (let py = 0; py < m.height; py++)
    for (let px = 0; px < m.width; px++) if (m.mask[py * m.width + px] && out.inBounds(x + px, y + py)) out.set(x + px, y + py, opts.color);
  return out;
}
