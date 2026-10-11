import { describe, expect, it } from 'vitest';
import { rgba, TRANSPARENT } from '../../src/raster/color';
import { mapLayer } from '../../src/project/model';
import { activeImage, ascii, BLUE, drag, makeHost, newSession, RED } from './helpers';

describe('pencil', () => {
  it('draws a single pixel with the primary color', () => {
    const s = newSession(4, 4);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 1, y: 2 }]);
    expect(activeImage(s)!.get(1, 2)).toBe(RED);
    expect(s.history.entries).toHaveLength(1);
  });
  it('fills gaps between fast pointer samples', () => {
    const s = newSession(8, 3);
    drag(makeHost(s), 'pencil', [{ x: 0, y: 1 }, { x: 7, y: 1 }]);
    expect(ascii(activeImage(s), 8, 3)).toBe('........\n########\n........');
  });
  it('uses the secondary color with the right button', () => {
    const s = newSession(2, 2);
    drag(makeHost(s), 'pencil', [{ x: 0, y: 0 }], { slot: 'secondary' });
    expect(activeImage(s)!.get(0, 0)).toBe(BLUE);
  });
  it('makes one history entry per stroke', () => {
    const s = newSession(8, 8);
    drag(makeHost(s), 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 3 }, { x: 7, y: 0 }]);
    expect(s.history.entries).toHaveLength(1);
  });
  it('honours brush size', () => {
    const s = newSession(5, 5);
    drag(makeHost(s, { size: 3 }), 'pencil', [{ x: 2, y: 2 }]);
    expect(ascii(activeImage(s), 5, 5)).toBe('.....\n.###.\n.###.\n.###.\n.....');
  });
  it('ignores pixels outside the canvas', () => {
    const s = newSession(3, 3);
    drag(makeHost(s), 'pencil', [{ x: -5, y: -5 }, { x: 10, y: 10 }]);
    expect(ascii(activeImage(s), 3, 3)).toBe('#..\n.#.\n..#');
  });
  it('refuses to draw on a locked layer and reports why', () => {
    const s = newSession(3, 3);
    s.apply('Bloquear', (st) => ({ ...st, layers: mapLayer(st.layers, s.activeLayerId, (l) => ({ ...l, locked: true })) }));
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 1, y: 1 }]);
    expect(activeImage(s)).toBeUndefined();
    expect(h.messages[0]).toMatch(/bloqueada/);
  });
  it('mirrors strokes with symmetry enabled', () => {
    const s = newSession(6, 4);
    s.apply('Simetria', (st) => ({ ...st, symmetry: { ...st.symmetry, vertical: true } }));
    const h = makeHost(s);
    h.symmetryActive = true;
    drag(h, 'pencil', [{ x: 0, y: 1 }, { x: 1, y: 1 }]);
    expect(ascii(activeImage(s), 6, 4)).toBe('......\n##..##\n......\n......');
  });
});

describe('brush', () => {
  it('blends with opacity once per stroke even when crossing itself', () => {
    const s = newSession(4, 1);
    drag(makeHost(s, { opacity: 50 }), 'brush', [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 0 }]);
    const img = activeImage(s)!;
    for (let x = 0; x < 4; x++) expect(img.get(x, 0)).toBe(rgba(255, 0, 0, 128));
  });
});

describe('eraser', () => {
  it('erases to transparency only on the active layer', () => {
    const s = newSession(3, 1);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    drag(h, 'eraser', [{ x: 1, y: 0 }]);
    const img = activeImage(s)!;
    expect(img.get(0, 0)).toBe(RED);
    expect(img.get(1, 0)).toBe(TRANSPARENT);
    expect(img.get(2, 0)).toBe(RED);
  });
});

describe('shape tools', () => {
  it('previews while dragging and commits only the final shape', () => {
    const s = newSession(6, 6);
    const h = makeHost(s);
    drag(h, 'line', [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }]);
    expect(ascii(activeImage(s), 6, 6)).toBe('#.....\n#.....\n#.....\n#.....\n#.....\n#.....');
    expect(s.history.entries).toHaveLength(1);
  });
  it('constrains a line to 45 degrees with shift', () => {
    const s = newSession(5, 5);
    drag(makeHost(s), 'line', [{ x: 0, y: 0 }, { x: 4, y: 3 }], { shift: true });
    expect(ascii(activeImage(s), 5, 5)).toBe('#....\n.#...\n..#..\n...#.\n....#');
  });
  it('draws outline and filled rectangles', () => {
    const s = newSession(5, 4);
    const h = makeHost(s);
    drag(h, 'rect', [{ x: 0, y: 0 }, { x: 4, y: 3 }]);
    expect(ascii(activeImage(s), 5, 4)).toBe('#####\n#...#\n#...#\n#####');
    drag(h, 'rect-filled', [{ x: 1, y: 1 }, { x: 3, y: 2 }], { slot: 'secondary' });
    expect(activeImage(s)!.get(2, 1)).toBe(BLUE);
    expect(activeImage(s)!.get(0, 0)).toBe(RED);
  });
  it('makes squares with shift', () => {
    const s = newSession(6, 6);
    drag(makeHost(s), 'rect-filled', [{ x: 0, y: 0 }, { x: 3, y: 1 }], { shift: true });
    expect(activeImage(s)!.contentBounds()).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });
  it('draws ellipses inside the dragged box', () => {
    const s = newSession(8, 8);
    drag(makeHost(s), 'ellipse', [{ x: 1, y: 1 }, { x: 6, y: 5 }]);
    expect(activeImage(s)!.contentBounds()).toEqual({ x: 1, y: 1, w: 6, h: 5 });
    const s2 = newSession(8, 8);
    drag(makeHost(s2), 'ellipse-filled', [{ x: 0, y: 0 }, { x: 7, y: 7 }]);
    expect(activeImage(s2)!.get(4, 4)).toBe(RED);
    expect(activeImage(s2)!.get(0, 0)).toBe(TRANSPARENT);
  });
  it('draws from the centre with alt', () => {
    const s = newSession(9, 9);
    drag(makeHost(s), 'rect', [{ x: 4, y: 4 }, { x: 6, y: 5 }], { alt: true });
    expect(activeImage(s)!.contentBounds()).toEqual({ x: 2, y: 3, w: 5, h: 3 });
  });
});

describe('eyedropper', () => {
  it('samples the active layer into the chosen slot', () => {
    const s = newSession(3, 3);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 1, y: 1 }]);
    drag(h, 'eyedropper', [{ x: 1, y: 1 }], { slot: 'secondary' });
    expect(h.colors.secondary).toBe(RED);
    drag(h, 'eyedropper', [{ x: 0, y: 0 }]);
    expect(h.colors.primary).toBe(TRANSPARENT);
  });
});
