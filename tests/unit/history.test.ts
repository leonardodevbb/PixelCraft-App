import { describe, expect, it } from 'vitest';
import { celKey, makeFrame, makePixelLayer } from '../../src/project/model';
import { activeImage, ascii, drag, makeHost, newSession, RED } from './helpers';

describe('undo / redo', () => {
  it('undoes and redoes strokes exactly', () => {
    const s = newSession(4, 4);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 0 }]);
    const afterFirst = ascii(activeImage(s), 4, 4);
    drag(h, 'line', [{ x: 0, y: 3 }, { x: 3, y: 3 }]);
    const afterSecond = ascii(activeImage(s), 4, 4);
    expect(s.undo()).toBe(true);
    expect(ascii(activeImage(s), 4, 4)).toBe(afterFirst);
    expect(s.undo()).toBe(true);
    expect(activeImage(s)).toBeUndefined();
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(true);
    expect(ascii(activeImage(s), 4, 4)).toBe(afterFirst);
    expect(s.redo()).toBe(true);
    expect(ascii(activeImage(s), 4, 4)).toBe(afterSecond);
    expect(s.redo()).toBe(false);
  });

  it('drops the redo branch after a new edit', () => {
    const s = newSession(4, 4);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }]);
    s.undo();
    drag(h, 'pencil', [{ x: 1, y: 1 }]);
    expect(s.history.canRedo).toBe(false);
    expect(ascii(activeImage(s), 2, 2)).toBe('..\n.#');
  });

  it('tracks dirty state relative to the last save', () => {
    const s = newSession(4, 4);
    expect(s.isDirty).toBe(false);
    drag(makeHost(s), 'pencil', [{ x: 0, y: 0 }]);
    expect(s.isDirty).toBe(true);
    s.markSaved();
    expect(s.isDirty).toBe(false);
    s.undo();
    expect(s.isDirty).toBe(true);
    s.redo();
    expect(s.isDirty).toBe(false);
  });

  it('restores structure and active layer on undo', () => {
    const s = newSession(4, 4);
    const before = s.state;
    const layer = makePixelLayer('Nova');
    s.apply('Nova camada', (st) => ({ ...st, layers: [...st.layers, layer] }), { layerId: layer.id });
    expect(s.activeLayerId).toBe(layer.id);
    s.undo();
    expect(s.state).toBe(before);
    expect(s.activeLayerId).toBe(before.layers[0]!.id);
  });

  it('copies shared (linked) cels on write instead of editing both', () => {
    const s = newSession(2, 1);
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }]);
    const f2 = makeFrame();
    const l = s.activeLayerId;
    const img = s.state.cels[celKey(l, s.activeFrameId)]!;
    s.apply('Duplicar quadro', (st) => ({ ...st, frames: [...st.frames, f2], cels: { ...st.cels, [celKey(l, f2.id)]: img } }));
    s.setActiveFrame(f2.id);
    drag(h, 'pencil', [{ x: 1, y: 0 }]);
    expect(ascii(activeImage(s), 2, 1)).toBe('##');
    const first = s.celImage(l, s.state.frames[0]!.id)!;
    expect(ascii(first, 2, 1)).toBe('#.');
    s.undo();
    expect(s.state.cels[celKey(l, f2.id)]).toBe(img);
  });

  it('evicts oldest entries beyond the memory budget but keeps the document intact', () => {
    const s = newSession(64, 64);
    s.history.setOptions({ maxBytes: 64 * 64 * 4 * 3 });
    const h = makeHost(s);
    for (let i = 0; i < 10; i++) drag(h, 'rect-filled', [{ x: 0, y: 0 }, { x: 63, y: 63 }], { slot: i % 2 ? 'primary' : 'secondary' });
    expect(s.history.entries.length).toBeLessThan(10);
    expect(s.history.usedBytes).toBeLessThanOrEqual(64 * 64 * 4 * 3);
    expect(activeImage(s)!.get(10, 10)).toBe(RED);
    while (s.undo());
    // whatever remains after eviction is a consistent earlier state
    expect(activeImage(s)).toBeDefined();
  });

  it('garbage-collects images that nothing references', () => {
    const s = newSession(4, 4);
    s.history.setOptions({ maxEntries: 1 });
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }]);
    drag(h, 'pencil', [{ x: 1, y: 1 }]);
    expect(s.doc.images.size).toBe(1);
  });
});
