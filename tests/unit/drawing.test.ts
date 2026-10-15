import { describe, expect, it } from 'vitest';
import { rgba, TRANSPARENT } from '../../src/raster/color';
import { cubicBezier } from '../../src/raster/shapes';
import { getTool } from '../../src/editor/tools';
import { brushFromSelection } from '../../src/editor/selection-ops';
import { rectSelection } from '../../src/editor/selection';
import { activeImage, ascii, BLUE, drag, makeHost, newSession, RED } from './helpers';

/** Deterministic pseudo-random sequence for spray/jumble. */
function lcg(seed = 1): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

describe('pixel-perfect pencil', () => {
  it('drops the corner of an L so a stair stroke stays one pixel thin', () => {
    const s = newSession(5, 5);
    // A pointer moving right then down produces an L at every step.
    const path = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ];
    drag(makeHost(s, { pixelPerfect: true }), 'pencil', path);
    expect(ascii(activeImage(s), 5, 5)).toBe('#....\n.#...\n..#..\n...#.\n.....');
  });
  it('keeps the corners without the option', () => {
    const s = newSession(3, 2);
    drag(makeHost(s), 'pencil', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(ascii(activeImage(s), 3, 2)).toBe('##.\n.#.');
  });
  it('restores what was under the removed corner', () => {
    const s = newSession(3, 2);
    const h = makeHost(s);
    h.colors.primary = BLUE;
    drag(h, 'pencil', [{ x: 1, y: 0 }]);
    h.colors.primary = RED;
    h.options.pixelPerfect = true;
    drag(h, 'pencil', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    const img = activeImage(s)!;
    expect(img.get(1, 0)).toBe(BLUE);
    expect(img.get(0, 0)).toBe(RED);
    expect(img.get(1, 1)).toBe(RED);
  });
  it('is ignored for thicker brushes', () => {
    const s = newSession(6, 6);
    drag(makeHost(s, { pixelPerfect: true, size: 2 }), 'pencil', [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }]);
    expect(activeImage(s)!.get(3, 2)).toBe(RED);
  });
});

describe('inks', () => {
  it('lock alpha only recolours existing pixels and keeps their alpha', () => {
    const s = newSession(4, 1);
    const h = makeHost(s);
    h.colors.primary = rgba(0, 0, 255, 128);
    drag(h, 'pencil', [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    h.colors.primary = RED;
    h.options.ink = 'lock-alpha';
    drag(h, 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 0 }]);
    const img = activeImage(s)!;
    expect(img.get(0, 0)).toBe(TRANSPARENT);
    expect(img.get(1, 0)).toBe(rgba(255, 0, 0, 128));
    expect(img.get(2, 0)).toBe(rgba(255, 0, 0, 128));
    expect(img.get(3, 0)).toBe(TRANSPARENT);
  });
  it('shading moves colours one step along the palette and only once per stroke', () => {
    const s = newSession(4, 1);
    const ramp = [rgba(10, 10, 10), rgba(20, 20, 20), rgba(30, 30, 30)];
    s.apply('Paleta', (st) => ({ ...st, palette: { ...st.palette, colors: ramp } }));
    const h = makeHost(s);
    h.colors.primary = ramp[0]!;
    drag(h, 'pencil', [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    h.options.ink = 'shading';
    // Back and forth over the same pixels in one stroke: still one step.
    drag(h, 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 0 }]);
    const img = activeImage(s)!;
    expect(img.get(0, 0)).toBe(ramp[1]);
    expect(img.get(2, 0)).toBe(ramp[1]);
    // Transparent pixels are not on the ramp and stay empty.
    expect(img.get(3, 0)).toBe(TRANSPARENT);
    // The secondary button shades the other way and stops at the ramp end.
    drag(h, 'pencil', [{ x: 0, y: 0 }], { slot: 'secondary' });
    drag(h, 'pencil', [{ x: 0, y: 0 }], { slot: 'secondary' });
    expect(activeImage(s)!.get(0, 0)).toBe(ramp[0]);
  });
  it('shading leaves colours outside the palette alone', () => {
    const s = newSession(1, 1);
    s.apply('Paleta', (st) => ({ ...st, palette: { ...st.palette, colors: [BLUE, RED] } }));
    const h = makeHost(s);
    h.colors.primary = rgba(1, 2, 3);
    drag(h, 'pencil', [{ x: 0, y: 0 }]);
    h.options.ink = 'shading';
    drag(h, 'pencil', [{ x: 0, y: 0 }]);
    expect(activeImage(s)!.get(0, 0)).toBe(rgba(1, 2, 3));
  });
  it('shape tools use the ink too', () => {
    const s = newSession(5, 1);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 2, y: 0 }]);
    h.colors.primary = BLUE;
    h.options.ink = 'lock-alpha';
    drag(h, 'line', [{ x: 0, y: 0 }, { x: 4, y: 0 }]);
    expect(ascii(activeImage(s), 5, 1)).toBe('..#..');
    expect(activeImage(s)!.get(2, 0)).toBe(BLUE);
  });
});

describe('custom brush', () => {
  it('captures the selection and stamps it with its own colours', () => {
    const s = newSession(8, 8);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }]);
    h.colors.primary = BLUE;
    drag(h, 'pencil', [{ x: 1, y: 0 }]);
    s.setSelection(rectSelection({ x: 0, y: 0, w: 2, h: 1 }));
    const brush = brushFromSelection(s);
    expect(brush.pixels).toHaveLength(2);
    s.setSelection(null);
    h.options.customBrush = brush;
    drag(h, 'pencil', [{ x: 5, y: 5 }]);
    const img = activeImage(s)!;
    // Width 2: the pointer sits on the second pixel of the brush.
    expect(img.get(4, 5)).toBe(RED);
    expect(img.get(5, 5)).toBe(BLUE);
  });
  it('erases with the brush shape', () => {
    const s = newSession(4, 1);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 0 }]);
    h.options.customBrush = { pixels: [{ x: 0, y: 0, c: BLUE }, { x: 1, y: 0, c: BLUE }] };
    drag(h, 'eraser', [{ x: 1, y: 0 }]);
    expect(ascii(activeImage(s), 4, 1)).toBe('#..#');
  });
  it('refuses an empty selection', () => {
    const s = newSession(4, 4);
    s.setSelection(rectSelection({ x: 0, y: 0, w: 2, h: 2 }));
    expect(() => brushFromSelection(s)).toThrow(/vazia/);
  });
});

describe('spray', () => {
  it('scatters pixels inside the circle and makes one undo step', () => {
    const s = newSession(21, 21);
    const tool = getTool('spray') as unknown as { random: () => number };
    tool.random = lcg(7);
    drag(makeHost(s, { size: 10, sprayDensity: 50 }), 'spray', [{ x: 10, y: 10 }, { x: 10, y: 10 }]);
    const img = activeImage(s)!;
    let n = 0;
    for (let y = 0; y < 21; y++)
      for (let x = 0; x < 21; x++)
        if (img.get(x, y) !== TRANSPARENT) {
          n++;
          expect(Math.hypot(x - 10, y - 10)).toBeLessThanOrEqual(5.8);
        }
    expect(n).toBeGreaterThan(3);
    expect(s.history.entries).toHaveLength(1);
  });
});

describe('contour', () => {
  it('fills the area enclosed by the freehand outline', () => {
    const s = newSession(6, 6);
    drag(makeHost(s), 'contour', [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }, { x: 1, y: 4 }]);
    expect(ascii(activeImage(s), 6, 6)).toBe('......\n.####.\n.####.\n.####.\n.####.\n......');
  });
});

describe('curve', () => {
  it('rasterizes a straight Bézier exactly like a line', () => {
    const pts: string[] = [];
    cubicBezier({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 0 }, (x, y) => pts.push(`${x},${y}`));
    expect(pts).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0']);
  });
  it('has no gaps on a bent curve', () => {
    const pts: { x: number; y: number }[] = [];
    cubicBezier({ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 0 }, (x, y) => pts.push({ x, y }));
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i]!.x - pts[i - 1]!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i]!.y - pts[i - 1]!.y)).toBeLessThanOrEqual(1);
    }
  });
  it('is placed in three gestures and committed as one entry', () => {
    const s = newSession(9, 9);
    const h = makeHost(s);
    drag(h, 'curve', [{ x: 0, y: 8 }, { x: 8, y: 8 }]);
    expect(s.history.entries).toHaveLength(0);
    expect(s.draft).not.toBeNull();
    drag(h, 'curve', [{ x: 0, y: 0 }]);
    drag(h, 'curve', [{ x: 8, y: 0 }]);
    expect(s.history.entries).toHaveLength(1);
    const img = activeImage(s)!;
    expect(img.get(0, 8)).toBe(RED);
    expect(img.get(8, 8)).toBe(RED);
    // The control points pull the middle of the curve up.
    expect(img.get(4, 8)).toBe(TRANSPARENT);
    expect(img.get(4, 2)).toBe(RED);
  });
  it('drops the half-made curve when the tool is switched', () => {
    const s = newSession(5, 5);
    const h = makeHost(s);
    drag(h, 'curve', [{ x: 0, y: 0 }, { x: 4, y: 4 }]);
    getTool('curve')!.deactivate!(h);
    expect(s.draft).toBeNull();
    expect(activeImage(s)).toBeUndefined();
  });
});

describe('blur and jumble', () => {
  it('blur averages a hard edge', () => {
    const s = newSession(3, 1);
    const h = makeHost(s);
    h.colors.primary = rgba(0, 0, 0);
    drag(h, 'pencil', [{ x: 0, y: 0 }]);
    h.colors.primary = rgba(255, 255, 255);
    drag(h, 'pencil', [{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    drag(h, 'blur', [{ x: 1, y: 0 }]);
    // (0 + 255 + 255) / 3 = 170
    expect(activeImage(s)!.get(1, 0)).toBe(rgba(170, 170, 170));
  });
  it('jumble keeps the same set of colours', () => {
    const s = newSession(4, 4);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 0 }]);
    const before = activeImage(s)!.clone();
    (getTool('jumble') as unknown as { random: () => number }).random = lcg(3);
    drag(makeHost(s, { size: 4 }), 'jumble', [{ x: 2, y: 2 }]);
    const count = (img: typeof before) => {
      let n = 0;
      for (let i = 3; i < img.data.length; i += 4) n += img.data[i]! > 0 ? 1 : 0;
      return n;
    };
    expect(count(activeImage(s)!)).toBe(count(before));
  });
});

describe('elliptical selection', () => {
  it('selects the same pixels the filled ellipse tool paints', () => {
    const s = newSession(7, 5);
    drag(makeHost(s), 'select-ellipse', [{ x: 0, y: 0 }, { x: 6, y: 4 }]);
    const sel = s.selection!;
    const t = newSession(7, 5);
    drag(makeHost(t), 'ellipse-filled', [{ x: 0, y: 0 }, { x: 6, y: 4 }]);
    const img = activeImage(t)!;
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 7; x++) {
        const inSel = x >= sel.bounds.x && y >= sel.bounds.y && x < sel.bounds.x + sel.bounds.w && y < sel.bounds.y + sel.bounds.h && sel.mask[(y - sel.bounds.y) * sel.bounds.w + x - sel.bounds.x] === 1;
        expect(inSel).toBe(img.get(x, y) !== TRANSPARENT);
      }
  });
});
