import { describe, expect, it } from 'vitest';
import { setColorMode } from '../../src/editor/color-mode';
import { filterCels } from '../../src/editor/doc-ops';
import { addRamp, colorRamp, paletteFromDrawing, removePaletteColor, removeUnusedColors, setPaletteColor, sortPalette } from '../../src/editor/palette-ops';
import { rectSelection } from '../../src/editor/selection';
import { deserializeProject, serializeProject } from '../../src/project/serialize';
import { brightnessContrast, despeckle, grayscale, hueSaturation, outline } from '../../src/raster/adjust';
import { rgba, rgbToHsl } from '../../src/raster/color';
import { PixelBuffer } from '../../src/raster/pixel-buffer';
import { activeImage, ascii, BLUE, drag, GREEN, makeHost, newSession, RED } from './helpers';

const DARK_RED = rgba(120, 0, 0);
const BLACK = rgba(0, 0, 0);

function paletteSession(colors = [RED, BLUE, BLACK]) {
  const s = newSession(8, 8);
  s.apply('pal', (st) => ({ ...st, palette: { ...st.palette, colors } }));
  return s;
}

describe('indexed colour mode', () => {
  it('converting snaps every pixel to the palette in one undo step', () => {
    const s = paletteSession();
    const host = makeHost(s);
    host.setColor('primary', rgba(200, 20, 20));
    drag(host, 'pencil', [{ x: 1, y: 1 }]);
    host.setColor('primary', rgba(10, 10, 200));
    drag(host, 'pencil', [{ x: 2, y: 1 }]);
    const steps = s.history.entries.length;
    setColorMode(s, 'indexed');
    expect(s.state.colorMode).toBe('indexed');
    expect(s.history.entries.length).toBe(steps + 1);
    expect(activeImage(s)!.get(1, 1)).toBe(RED);
    expect(activeImage(s)!.get(2, 1)).toBe(BLUE);
    s.undo();
    expect(s.state.colorMode).toBeUndefined();
    expect(activeImage(s)!.get(1, 1)).toBe(rgba(200, 20, 20));
  });

  it('painting in indexed mode always lands on palette colours', () => {
    const s = paletteSession();
    setColorMode(s, 'indexed');
    const host = makeHost(s);
    host.setColor('primary', rgba(240, 30, 20));
    drag(host, 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 0 }]);
    expect(activeImage(s)!.get(2, 0)).toBe(RED);
    // A filter that invents colours is snapped too.
    filterCels(s, 'Brilho', (img, m) => brightnessContrast(img, { brightness: -80, contrast: 0 }, m));
    expect(activeImage(s)!.get(2, 0)).toBe(BLACK);
  });

  it('editing a palette entry recolours its pixels; removing one remaps to the nearest', () => {
    const s = paletteSession([RED, BLUE, DARK_RED]);
    setColorMode(s, 'indexed');
    const host = makeHost(s);
    drag(host, 'pencil', [{ x: 0, y: 0 }]);
    host.setColor('primary', BLUE);
    drag(host, 'pencil', [{ x: 1, y: 0 }]);
    setPaletteColor(s, 0, GREEN);
    expect(activeImage(s)!.get(0, 0)).toBe(GREEN);
    expect(activeImage(s)!.get(1, 0)).toBe(BLUE);
    expect(s.history.entries.at(-1)!.label).toBe('Alterar cor da paleta');
    s.undo();
    expect(activeImage(s)!.get(0, 0)).toBe(RED);
    expect(s.state.palette.colors[0]).toBe(RED);
    s.redo();
    removePaletteColor(s, 0);
    // Green left the palette; the nearest remaining colour wins.
    expect(s.state.palette.colors).toEqual([BLUE, DARK_RED]);
    expect([BLUE, DARK_RED]).toContain(activeImage(s)!.get(0, 0));
  });

  it('in RGB mode palette edits never touch pixels', () => {
    const s = paletteSession();
    drag(makeHost(s), 'pencil', [{ x: 0, y: 0 }]);
    setPaletteColor(s, 0, GREEN);
    expect(activeImage(s)!.get(0, 0)).toBe(RED);
  });

  it('is saved in the project file', () => {
    const s = paletteSession();
    setColorMode(s, 'indexed');
    const back = deserializeProject(serializeProject(s.doc, { generator: 't' }));
    expect(back.state.colorMode).toBe('indexed');
    const plain = deserializeProject(serializeProject(newSession().doc, { generator: 't' }));
    expect(plain.state.colorMode).toBeUndefined();
  });
});

describe('colour adjustments and filters', () => {
  const img = (): PixelBuffer => {
    const b = new PixelBuffer(5, 5);
    b.set(2, 2, RED);
    b.set(1, 2, rgba(200, 100, 50));
    return b;
  };

  it('hue rotation turns red into green and keeps transparency', () => {
    const out = hueSaturation(img(), { hue: 120, saturation: 0, lightness: 0 });
    expect(out.get(2, 2)).toBe(GREEN);
    expect(out.get(0, 0)).toBe(0);
    const grey = hueSaturation(img(), { hue: 0, saturation: -100, lightness: 0 });
    expect(rgbToHsl(grey.get(1, 2)).s).toBe(0);
  });

  it('brightness and contrast move channels as expected', () => {
    const b = new PixelBuffer(1, 1);
    b.set(0, 0, rgba(100, 128, 200));
    expect(brightnessContrast(b, { brightness: 20, contrast: 0 }).get(0, 0)).toBe(rgba(151, 179, 251));
    expect(brightnessContrast(b, { brightness: 0, contrast: 50 }).get(0, 0)).toBe(rgba(72, 128, 255));
    expect(grayscale(b).get(0, 0)).toBe(rgba(128, 128, 128));
  });

  it('outline draws around (4 or 8 neighbours) or inside the shape', () => {
    const b = new PixelBuffer(5, 5);
    b.set(2, 2, RED);
    expect(ascii(outline(b, { color: BLUE, shape: 'circle', place: 'outside' }), 5, 5)).toBe(['.....', '..#..', '.###.', '..#..', '.....'].join('\n'));
    expect(ascii(outline(b, { color: BLUE, shape: 'square', place: 'outside' }), 5, 5)).toBe(['.....', '.###.', '.###.', '.###.', '.....'].join('\n'));
    const o = outline(b, { color: BLUE, shape: 'circle', place: 'outside' });
    expect([o.get(2, 1), o.get(2, 2)]).toEqual([BLUE, RED]);
    const sq = new PixelBuffer(5, 5);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) sq.set(x, y, RED);
    const inside = outline(sq, { color: BLUE, shape: 'circle', place: 'inside' });
    expect([inside.get(1, 1), inside.get(2, 1), inside.get(2, 2)]).toEqual([BLUE, BLUE, RED]);
  });

  it('despeckle removes a lone pixel but keeps a solid block', () => {
    const b = new PixelBuffer(7, 7);
    b.set(1, 1, RED);
    for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) b.set(x, y, BLUE);
    const out = despeckle(b);
    expect(out.get(1, 1)).toBe(0);
    expect(out.get(5, 5)).toBe(BLUE);
  });

  it('filters respect the selection and make one undo step', () => {
    const s = newSession(4, 1);
    const host = makeHost(s);
    drag(host, 'pencil', [{ x: 0, y: 0 }, { x: 3, y: 0 }]);
    s.setSelection(rectSelection({ x: 2, y: 0, w: 2, h: 1 }));
    const steps = s.history.entries.length;
    filterCels(s, 'Matiz e saturação', (i, m) => hueSaturation(i, { hue: 240, saturation: 0, lightness: 0 }, m));
    const out = activeImage(s)!;
    expect([out.get(0, 0), out.get(3, 0)]).toEqual([RED, BLUE]);
    expect(s.history.entries.length).toBe(steps + 1);
  });
});

describe('palette tools', () => {
  it('builds a ramp from dark to light with both ends included', () => {
    const r = colorRamp(rgba(40, 20, 80), rgba(250, 230, 150), 5);
    expect(r).toHaveLength(5);
    expect(r[0]).toBe(rgba(40, 20, 80));
    expect(r[4]).toBe(rgba(250, 230, 150));
    const l = r.map((c) => rgbToHsl(c).l);
    for (let i = 1; i < l.length; i++) expect(l[i]!).toBeGreaterThan(l[i - 1]!);
    const s = paletteSession([RED]);
    expect(addRamp(s, RED, BLUE, 4)).toBe(3);
    expect(s.state.palette.colors).toHaveLength(4);
  });

  it('sorts by lightness and by usage, without touching pixels', () => {
    const white = rgba(255, 255, 255);
    const s = paletteSession([white, BLACK, RED]);
    sortPalette(s, 'lightness');
    expect(s.state.palette.colors).toEqual([BLACK, RED, white]);
    const host = makeHost(s);
    host.setColor('primary', white);
    drag(host, 'pencil', [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    sortPalette(s, 'usage');
    expect(s.state.palette.colors[0]).toBe(white);
  });

  it('creates a palette from the drawing and removes unused colours', () => {
    const s = paletteSession([RED, BLUE, BLACK]);
    const host = makeHost(s);
    drag(host, 'pencil', [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    host.setColor('primary', GREEN);
    drag(host, 'pencil', [{ x: 0, y: 1 }]);
    expect(removeUnusedColors(s)).toBe(2);
    expect(s.state.palette.colors).toEqual([RED]);
    expect(paletteFromDrawing(s)).toBe(2);
    expect(s.state.palette.colors).toEqual([RED, GREEN]);
  });
});
