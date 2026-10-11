import { createDocument } from '../../src/project/create';
import { EditorSession } from '../../src/editor/session';
import { DEFAULT_TOOL_OPTIONS, getTool, type ColorSlot, type ToolHost, type ToolId, type ToolOptions } from '../../src/editor/tools';
import { rgba, type RGBA } from '../../src/raster/color';
import type { PixelBuffer } from '../../src/raster/pixel-buffer';

export const RED = rgba(255, 0, 0);
export const BLUE = rgba(0, 0, 255);
export const GREEN = rgba(0, 255, 0);

export function newSession(w = 16, h = 16): EditorSession {
  return new EditorSession(createDocument({ width: w, height: h, name: 'Teste' }));
}

export function makeHost(session: EditorSession, opts: Partial<ToolOptions> = {}): ToolHost & { colors: Record<ColorSlot, RGBA>; messages: string[] } {
  const colors: Record<ColorSlot, RGBA> = { primary: RED, secondary: BLUE };
  const messages: string[] = [];
  return {
    session,
    options: { ...DEFAULT_TOOL_OPTIONS, ...opts },
    colors,
    messages,
    color: (s) => colors[s],
    setColor: (s, c) => {
      colors[s] = c;
    },
    notify: (m) => messages.push(m),
    symmetryActive: false,
  };
}

interface Pt {
  x: number;
  y: number;
}

/** Simulates a drag with a tool through the given points. */
export function drag(host: ToolHost, tool: ToolId, points: Pt[], mods: { shift?: boolean; alt?: boolean; slot?: ColorSlot } = {}): void {
  const t = getTool(tool);
  if (!t) throw new Error(`tool ${tool}`);
  const ev = (p: Pt) => ({ x: p.x, y: p.y, fx: p.x + 0.5, fy: p.y + 0.5, slot: mods.slot ?? 'primary', shift: !!mods.shift, ctrl: false, alt: !!mods.alt });
  t.onDown(ev(points[0]!), host);
  for (const p of points.slice(1)) t.onMove(ev(p), host);
  t.onUp(ev(points.at(-1)!), host);
}

export function activeImage(session: EditorSession): PixelBuffer | undefined {
  return session.celImage(session.activeLayerId, session.activeFrameId);
}

/** ASCII rendering of non-transparent pixels, for readable assertions. */
export function ascii(img: PixelBuffer | undefined, w: number, h: number): string {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) r += img && (img.get(x, y) & 255) !== 0 ? '#' : '.';
    rows.push(r);
  }
  return rows.join('\n');
}
