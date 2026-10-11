import { PIXELCRAFT_SANS, renderText, type TextLayoutOptions } from '../raster/bitmap-font';
import type { RGBA } from '../raster/color';
import type { Rect } from '../raster/rect';
import { Painter } from './painter';
import type { EditorSession } from './session';

export interface TextStampOptions extends TextLayoutOptions {
  color: RGBA;
}

/** Bounds of the text block placed with its top-left corner at (x, y). */
export function textBounds(text: string, x: number, y: number, opts: TextLayoutOptions): Rect {
  const m = renderText(text, PIXELCRAFT_SANS, opts);
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
  const m = renderText(text, PIXELCRAFT_SANS, opts);
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
