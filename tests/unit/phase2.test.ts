import { describe, expect, it } from 'vitest';
import { rgba } from '../../src/raster/color';
import { PixelBuffer } from '../../src/raster/pixel-buffer';
import { celKey, findLayer, pixelLayers } from '../../src/project/model';
import {
  combineSelections,
  floodMask,
  invertSelection,
  isSelected,
  polygonSelection,
  rectSelection,
  selectionArea,
} from '../../src/editor/selection';
import { copySelection, cutSelection, flipSelectedH, moveSelected, pastePiece, rotateSelected } from '../../src/editor/selection-ops';
import { flipH, offset, rotate } from '../../src/editor/raster-ops';
import {
  clearCels,
  cropToSelection,
  flipDocument,
  invertCels,
  replaceColor,
  resizeCanvas,
  resizeContent,
  rotateDocument,
  trimDocument,
} from '../../src/editor/doc-ops';
import {
  addGroup,
  addLayer,
  deleteLayer,
  duplicateLayer,
  groupLayer,
  layerFromSelection,
  mergeDown,
  mergeVisible,
  moveLayerTo,
  setLayerProps,
  stepLayer,
  ungroup,
} from '../../src/editor/layer-ops';
import { panelRows } from '../../src/layers/tree';
import { parsePalette, writePalette, PaletteFormatError } from '../../src/palette/formats';
import { countColors, medianCut, nearestColor, outOfPalette, duplicateIndices } from '../../src/palette/analysis';
import { reduceColors, usedColors } from '../../src/editor/palette-ops';
import { activeImage, ascii, BLUE, drag, GREEN, makeHost, newSession, RED } from './helpers';

function paint(s: ReturnType<typeof newSession>, pts: [number, number][], color = RED): void {
  const h = makeHost(s);
  h.colors.primary = color;
  for (const [x, y] of pts) drag(h, 'pencil', [{ x, y }]);
}

describe('selection model', () => {
  it('combines with add, subtract and intersect', () => {
    const a = rectSelection({ x: 0, y: 0, w: 4, h: 4 });
    const b = rectSelection({ x: 2, y: 2, w: 4, h: 4 });
    expect(selectionArea(combineSelections(a, b, 'add')!)).toBe(28);
    expect(selectionArea(combineSelections(a, b, 'subtract')!)).toBe(12);
    expect(selectionArea(combineSelections(a, b, 'intersect')!)).toBe(4);
    expect(combineSelections(null, b, 'subtract')).toBeNull();
  });
  it('inverts inside the document', () => {
    const inv = invertSelection(rectSelection({ x: 1, y: 1, w: 2, h: 2 }), 4, 4)!;
    expect(selectionArea(inv)).toBe(12);
    expect(isSelected(inv, 0, 0)).toBe(true);
    expect(isSelected(inv, 1, 1)).toBe(false);
  });
  it('rasterises a lasso polygon', () => {
    const p = polygonSelection([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }])!;
    expect(selectionArea(p)).toBe(25);
  });
  it('flood fills with tolerance and contiguity', () => {
    const img = new PixelBuffer(5, 1);
    img.set(0, 0, RED);
    img.set(1, 0, rgba(250, 0, 0));
    img.set(2, 0, BLUE);
    img.set(3, 0, RED);
    expect(selectionArea(floodMask(img, 0, 0, { tolerance: 0, contiguous: true })!)).toBe(1);
    expect(selectionArea(floodMask(img, 0, 0, { tolerance: 5, contiguous: true })!)).toBe(2);
    expect(selectionArea(floodMask(img, 0, 0, { tolerance: 5, contiguous: false })!)).toBe(3);
  });
});

describe('bucket, wand and selection tools', () => {
  it('fills an enclosed area in one undo step', () => {
    const s = newSession(5, 5);
    const h = makeHost(s);
    drag(h, 'rect', [{ x: 0, y: 0 }, { x: 4, y: 4 }]);
    h.colors.primary = BLUE;
    drag(h, 'bucket', [{ x: 2, y: 2 }]);
    expect(activeImage(s)!.get(2, 2)).toBe(BLUE);
    expect(activeImage(s)!.get(0, 0)).toBe(RED);
    s.undo();
    expect(activeImage(s)!.get(2, 2)).toBe(0);
  });
  it('limits the fill to the selection', () => {
    const s = newSession(4, 1);
    s.setSelection(rectSelection({ x: 0, y: 0, w: 2, h: 1 }));
    drag(makeHost(s), 'bucket', [{ x: 0, y: 0 }]);
    expect(ascii(activeImage(s), 4, 1)).toBe('##..');
  });
  it('rect select with shift adds and alt subtracts', () => {
    const s = newSession(8, 8);
    const h = makeHost(s);
    drag(h, 'select-rect', [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(selectionArea(s.selection!)).toBe(4);
    drag(h, 'select-rect', [{ x: 4, y: 4 }, { x: 5, y: 5 }], { shift: true });
    expect(selectionArea(s.selection!)).toBe(8);
    drag(h, 'select-rect', [{ x: 0, y: 0 }, { x: 0, y: 1 }], { alt: true });
    expect(selectionArea(s.selection!)).toBe(6);
    s.undo();
    expect(selectionArea(s.selection!)).toBe(8);
    drag(h, 'select-rect', [{ x: 3, y: 3 }]);
    expect(s.selection).toBeNull();
  });
  it('magic wand selects same colour', () => {
    const s = newSession(4, 1);
    paint(s, [[0, 0], [1, 0], [3, 0]]);
    drag(makeHost(s), 'magic-wand', [{ x: 0, y: 0 }]);
    expect(selectionArea(s.selection!)).toBe(2);
  });
});

describe('move, copy and paste', () => {
  it('moves selected pixels and the selection together in one step', () => {
    const s = newSession(5, 1);
    paint(s, [[0, 0]]);
    s.setSelection(rectSelection({ x: 0, y: 0, w: 1, h: 1 }));
    const n = s.history.entries.length;
    drag(makeHost(s), 'move', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }]);
    expect(ascii(activeImage(s), 5, 1)).toBe('...#.');
    expect(s.selection!.bounds.x).toBe(3);
    expect(s.history.entries.length).toBe(n + 1);
    s.undo();
    expect(ascii(activeImage(s), 5, 1)).toBe('#....');
    expect(s.selection!.bounds.x).toBe(0);
  });
  it('alt-move duplicates', () => {
    const s = newSession(4, 1);
    paint(s, [[0, 0]]);
    s.setSelection(rectSelection({ x: 0, y: 0, w: 1, h: 1 }));
    drag(makeHost(s), 'move', [{ x: 0, y: 0 }, { x: 2, y: 0 }], { alt: true });
    expect(ascii(activeImage(s), 4, 1)).toBe('#.#.');
  });
  it('moves the whole layer without a selection', () => {
    const s = newSession(3, 1);
    paint(s, [[0, 0]]);
    moveSelected(s, 1, 0);
    expect(ascii(activeImage(s), 3, 1)).toBe('.#.');
  });
  it('cut and paste round trip', () => {
    const s = newSession(4, 1);
    paint(s, [[0, 0]]);
    s.setSelection(rectSelection({ x: 0, y: 0, w: 2, h: 1 }));
    const piece = cutSelection(s)!;
    expect(ascii(activeImage(s), 4, 1)).toBe('....');
    pastePiece(s, piece, 2, 0);
    expect(ascii(activeImage(s), 4, 1)).toBe('..#.');
    expect(s.selection!.bounds).toEqual({ x: 2, y: 0, w: 2, h: 1 });
    expect(copySelection(s)!.buffer.get(0, 0)).toBe(RED);
  });
  it('flips and rotates the selection content', () => {
    const s = newSession(3, 3);
    paint(s, [[0, 0]]);
    s.setSelection(rectSelection({ x: 0, y: 0, w: 3, h: 3 }));
    flipSelectedH(s);
    expect(activeImage(s)!.get(2, 0)).toBe(RED);
    rotateSelected(s, 90);
    expect(activeImage(s)!.get(2, 2)).toBe(RED);
  });
});

describe('raster ops', () => {
  it('rotate and flip are reversible', () => {
    const b = new PixelBuffer(3, 2);
    b.set(0, 0, RED);
    b.set(2, 1, BLUE);
    expect(rotate(rotate(b, 90), 270).equals(b)).toBe(true);
    expect(flipH(flipH(b)).equals(b)).toBe(true);
    expect(rotate(b, 90).width).toBe(2);
  });
  it('offset wraps', () => {
    const b = new PixelBuffer(3, 1);
    b.set(2, 0, RED);
    expect(offset(b, 1, 0, true).get(0, 0)).toBe(RED);
    expect(offset(b, 1, 0, false).isEmpty()).toBe(true);
  });
});

describe('document operations', () => {
  it('resizes the canvas with an anchor and undoes atomically', () => {
    const s = newSession(2, 2);
    paint(s, [[0, 0]]);
    resizeCanvas(s, 4, 4, { ax: 1, ay: 1 });
    expect(s.state.width).toBe(4);
    expect(activeImage(s)!.get(2, 2)).toBe(RED);
    s.undo();
    expect(s.state.width).toBe(2);
    expect(activeImage(s)!.get(0, 0)).toBe(RED);
    s.redo();
    expect(activeImage(s)!.width).toBe(4);
  });
  it('resizes content with nearest neighbour', () => {
    const s = newSession(2, 1);
    paint(s, [[0, 0]]);
    resizeContent(s, 4, 2);
    expect(ascii(activeImage(s), 4, 2)).toBe('##..\n##..');
  });
  it('rejects invalid sizes', () => {
    const s = newSession(2, 2);
    expect(() => resizeCanvas(s, 0, 4, { ax: 0, ay: 0 })).toThrow();
    expect(() => resizeContent(s, 99999, 4)).toThrow();
  });
  it('crops to the selection and trims', () => {
    const s = newSession(6, 6);
    paint(s, [[2, 2], [3, 4]]);
    trimDocument(s);
    expect([s.state.width, s.state.height]).toEqual([2, 3]);
    expect(ascii(activeImage(s), 2, 3)).toBe('#.\n..\n.#');
    s.setSelection(rectSelection({ x: 0, y: 0, w: 1, h: 1 }));
    cropToSelection(s);
    expect([s.state.width, s.state.height]).toEqual([1, 1]);
    expect(s.selection).toBeNull();
  });
  it('rotates and flips the whole document', () => {
    const s = newSession(3, 1);
    paint(s, [[0, 0]]);
    rotateDocument(s, 90);
    expect([s.state.width, s.state.height]).toEqual([1, 3]);
    expect(activeImage(s)!.get(0, 0)).toBe(RED);
    flipDocument(s, 'v');
    expect(activeImage(s)!.get(0, 2)).toBe(RED);
  });
  it('inverts, replaces and clears', () => {
    const s = newSession(2, 1);
    paint(s, [[0, 0]]);
    invertCels(s);
    expect(activeImage(s)!.get(0, 0)).toBe(rgba(0, 255, 255));
    expect(activeImage(s)!.get(1, 0)).toBe(0);
    expect(replaceColor(s, rgba(0, 255, 255), GREEN, 0)).toBe(1);
    expect(activeImage(s)!.get(0, 0)).toBe(GREEN);
    clearCels(s);
    expect(activeImage(s)!.isEmpty()).toBe(true);
  });
  it('keeps linked cels linked', () => {
    const s = newSession(2, 1);
    paint(s, [[0, 0]]);
    const f2 = 'F-linked';
    const img = s.state.cels[celKey(s.activeLayerId, s.activeFrameId)]!;
    s.apply('link', (st) => ({ ...st, frames: [...st.frames, { id: f2, duration: 100 }], cels: { ...st.cels, [celKey(s.activeLayerId, f2)]: img } }));
    flipDocument(s, 'h');
    const a = s.state.cels[celKey(s.activeLayerId, s.activeFrameId)];
    expect(s.state.cels[celKey(s.activeLayerId, f2)]).toBe(a);
  });
});

describe('layer operations', () => {
  it('adds, renames, duplicates, deletes with undo', () => {
    const s = newSession(2, 2);
    paint(s, [[0, 0]]);
    const base = s.activeLayerId;
    const id = addLayer(s);
    expect(s.activeLayerId).toBe(id);
    setLayerProps(s, id, { name: 'Contorno' });
    expect(findLayer(s.state.layers, id)!.layer.name).toBe('Contorno');
    s.setActiveLayer(base);
    const dup = duplicateLayer(s);
    expect(s.celImage(dup, s.activeFrameId)!.get(0, 0)).toBe(RED);
    expect(s.state.cels[celKey(dup, s.activeFrameId)]).not.toBe(s.state.cels[celKey(base, s.activeFrameId)]);
    deleteLayer(s, dup);
    expect(findLayer(s.state.layers, dup)).toBeNull();
    s.undo();
    expect(findLayer(s.state.layers, dup)).not.toBeNull();
  });
  it('never deletes the last pixel layer', () => {
    const s = newSession(2, 2);
    expect(() => deleteLayer(s)).toThrow();
  });
  it('merges down applying opacity', () => {
    const s = newSession(1, 1);
    paint(s, [[0, 0]], BLUE);
    const top = addLayer(s);
    paint(s, [[0, 0]], RED);
    setLayerProps(s, top, { opacity: 50 });
    mergeDown(s);
    expect(pixelLayers(s.state.layers)).toHaveLength(1);
    const c = activeImage(s)!.get(0, 0);
    expect(c >>> 24).toBeGreaterThan(100);
    expect((c >>> 8) & 255).toBeGreaterThan(100);
  });
  it('merges visible layers only', () => {
    const s = newSession(2, 1);
    paint(s, [[0, 0]]);
    const b = addLayer(s);
    paint(s, [[1, 0]], BLUE);
    const hidden = addLayer(s);
    setLayerProps(s, hidden, { visible: false });
    mergeVisible(s);
    const layers = pixelLayers(s.state.layers);
    expect(layers.map((l) => l.id)).toContain(hidden);
    expect(layers.map((l) => l.id)).not.toContain(b);
    expect(ascii(activeImage(s), 2, 1)).toBe('##');
  });
  it('groups, reorders and ungroups', () => {
    const s = newSession(2, 2);
    const a = s.activeLayerId;
    const b = addLayer(s);
    const g = groupLayer(s, b);
    expect(findLayer(s.state.layers, b)!.parent!.id).toBe(g);
    expect(panelRows(s.state.layers).map((r) => r.depth)).toEqual([0, 1, 0]);
    moveLayerTo(s, a, { parentId: g, index: 0 });
    expect(findLayer(s.state.layers, a)!.parent!.id).toBe(g);
    expect(() => moveLayerTo(s, g, { parentId: g, index: 0 })).toThrow();
    ungroup(s, g);
    expect(findLayer(s.state.layers, g)).toBeNull();
    expect(s.state.layers.map((l) => l.id)).toEqual([a, b]);
    stepLayer(s, a, 1);
    expect(s.state.layers.map((l) => l.id)).toEqual([b, a]);
    const g2 = addGroup(s);
    expect(findLayer(s.state.layers, g2)!.layer.type).toBe('group');
  });
  it('creates a layer from the selection', () => {
    const s = newSession(3, 1);
    paint(s, [[0, 0], [2, 0]]);
    const base = s.activeLayerId;
    s.setSelection(rectSelection({ x: 0, y: 0, w: 1, h: 1 }));
    const id = layerFromSelection(s, true);
    expect(ascii(s.celImage(id, s.activeFrameId), 3, 1)).toBe('#..');
    expect(ascii(s.celImage(base, s.activeFrameId), 3, 1)).toBe('..#');
  });
  it('blocks painting on locked layers', () => {
    const s = newSession(2, 2);
    setLayerProps(s, s.activeLayerId, { locked: true });
    const h = makeHost(s);
    drag(h, 'pencil', [{ x: 0, y: 0 }]);
    expect(activeImage(s)?.get(0, 0) ?? 0).toBe(0);
    expect(h.messages.length).toBeGreaterThan(0);
  });
});

describe('palettes', () => {
  const colors = [RED, GREEN, BLUE];
  it.each(['gpl', 'hex', 'json', 'jasc', 'act'] as const)('round trips %s', (fmt) => {
    const ext = { gpl: 'gpl', hex: 'hex', json: 'json', jasc: 'pal', act: 'act' }[fmt];
    const bytes = writePalette(fmt, 'Teste', colors);
    expect(parsePalette(`p.${ext}`, bytes).colors).toEqual(colors);
  });
  it('rejects malformed files', () => {
    const enc = (t: string) => new TextEncoder().encode(t);
    expect(() => parsePalette('a.gpl', enc('GIMP Palette\n300 0 0\n'))).toThrow(PaletteFormatError);
    expect(() => parsePalette('a.hex', enc('zzzzzz\n'))).toThrow(PaletteFormatError);
    expect(() => parsePalette('a.json', enc('{"colors": 5}'))).toThrow(PaletteFormatError);
    expect(() => parsePalette('a.pal', enc('JASC-PAL\n0100\n3\n1 2 3\n'))).toThrow(PaletteFormatError);
    expect(() => parsePalette('a.hex', enc(''))).toThrow(PaletteFormatError);
  });
  it('parses the GIMP name', () => {
    const p = parsePalette('x.gpl', new TextEncoder().encode('GIMP Palette\nName: Retro\n#\n255 0 0 red\n'));
    expect(p).toEqual({ name: 'Retro', colors: [RED] });
  });
  it('analyses colours', () => {
    const b = new PixelBuffer(3, 1);
    b.set(0, 0, RED);
    b.set(1, 0, RED);
    b.set(2, 0, BLUE);
    const counts = countColors([b]);
    expect(counts.get(RED)).toBe(2);
    expect(outOfPalette(counts.keys(), [RED])).toEqual([BLUE]);
    expect(nearestColor(rgba(250, 10, 10), colors)).toBe(RED);
    expect(duplicateIndices([RED, BLUE, RED])).toEqual([2]);
    expect(medianCut(counts, 1)).toHaveLength(1);
  });
  it('reduces document colours in one undo step', () => {
    const s = newSession(4, 1);
    paint(s, [[0, 0]], RED);
    paint(s, [[1, 0]], rgba(240, 0, 0));
    paint(s, [[2, 0]], BLUE);
    const n = s.history.entries.length;
    reduceColors(s, 2);
    expect(usedColors(s).size).toBe(2);
    expect(s.state.palette.colors).toHaveLength(2);
    expect(s.history.entries.length).toBe(n + 1);
  });
});
