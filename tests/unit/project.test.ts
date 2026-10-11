import { strToU8, zipSync, unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDocument } from '../../src/project/create';
import { deserializeProject, ProjectFormatError, serializeProject } from '../../src/project/serialize';
import { celKey, makeFrame, makeGroupLayer, makePixelLayer } from '../../src/project/model';
import { EditorSession } from '../../src/editor/session';
import { composeFrame } from '../../src/layers/compose';
import { rgba } from '../../src/raster/color';
import { drag, makeHost, newSession, RED } from './helpers';

const OPTS = { generator: 'PixelCraft test' };

function richSession(): EditorSession {
  const s = newSession(8, 6);
  const h = makeHost(s);
  drag(h, 'pencil', [{ x: 0, y: 0 }, { x: 7, y: 5 }]);
  const top = makePixelLayer('Topo', { opacity: 60, blendMode: 'multiply', colorTag: '#ff8800' });
  const group = makeGroupLayer('Grupo', [top], { expanded: false });
  const guide = makePixelLayer('Guia', { exportable: false, locked: true, visible: false });
  const f2 = makeFrame(250);
  s.apply('estrutura', (st) => ({
    ...st,
    layers: [...st.layers, group, guide],
    frames: [...st.frames, { ...f2, tag: 'andar' }],
    animation: { fps: 12, loop: 'pingpong', direction: 'reverse' },
    guides: [{ axis: 'x', position: 3 }],
  }), { layerId: top.id });
  drag(h, 'rect-filled', [{ x: 2, y: 2 }, { x: 4, y: 4 }], { slot: 'secondary' });
  // half-transparent pixel must survive exactly
  h.colors.primary = rgba(10, 20, 30, 77);
  drag(h, 'pencil', [{ x: 7, y: 0 }]);
  // linked cel: frame 2 shares frame 1's image on the base layer
  const base = s.state.layers[0]!.id;
  const img = s.state.cels[celKey(base, s.state.frames[0]!.id)]!;
  s.apply('link', (st) => ({ ...st, cels: { ...st.cels, [celKey(base, f2.id)]: img } }));
  return s;
}

describe('.pixelcraft format', () => {
  it('round-trips structure, settings and pixels exactly', () => {
    const s = richSession();
    const bytes = serializeProject(s.doc, OPTS);
    const doc = deserializeProject(bytes);
    expect(doc.name).toBe('Teste');
    expect(doc.state.width).toBe(8);
    expect(doc.state.layers).toEqual(s.state.layers);
    expect(doc.state.frames).toEqual(s.state.frames);
    expect(doc.state.cels).toEqual(s.state.cels);
    expect(doc.state.palette).toEqual(s.state.palette);
    expect(doc.state.animation).toEqual(s.state.animation);
    expect(doc.state.guides).toEqual(s.state.guides);
    for (const id of Object.values(s.state.cels)) expect(doc.images.get(id)!.equals(s.doc.images.get(id)!)).toBe(true);
    // linked cels stay linked (one image stored)
    expect(new Set(Object.values(doc.state.cels)).size).toBe(doc.images.size);
    for (const f of s.state.frames) {
      const a = composeFrame(s.state, s.lookup, f.id);
      const b = composeFrame(doc.state, (id) => doc.images.get(id), f.id);
      expect(b.equals(a)).toBe(true);
    }
  });

  it('can be saved again after reopening and editing', () => {
    const s = richSession();
    const reopened = new EditorSession(deserializeProject(serializeProject(s.doc, OPTS)));
    drag(makeHost(reopened), 'pencil', [{ x: 5, y: 1 }]);
    const again = deserializeProject(serializeProject(reopened.doc, OPTS));
    const id = again.state.cels[celKey(reopened.activeLayerId, reopened.activeFrameId)]!;
    expect(again.images.get(id)!.get(5, 1)).toBe(RED);
  });

  it('stores a mimetype entry first and a readable manifest', () => {
    const bytes = serializeProject(createDocument({ width: 4, height: 4 }), OPTS);
    expect(strFromU8(bytes.subarray(30, 38))).toBe('mimetype');
    const files = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    expect(manifest.format).toBe('pixelcraft');
    expect(manifest.version).toBe(1);
    expect(files['thumbnail.png']).toBeDefined();
  });

  function tamper(mutate: (m: Record<string, any>) => void, extra: Record<string, Uint8Array> = {}): Uint8Array {
    const s = richSession();
    const files = unzipSync(serializeProject(s.doc, OPTS));
    const m = JSON.parse(strFromU8(files['manifest.json']!));
    mutate(m);
    files['manifest.json'] = strToU8(JSON.stringify(m));
    return zipSync({ ...files, ...extra });
  }

  it('rejects files that are not projects', () => {
    expect(() => deserializeProject(new Uint8Array([1, 2, 3, 4]))).toThrow(ProjectFormatError);
    expect(() => deserializeProject(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/identificação/);
  });

  it('rejects newer format versions with an actionable message', () => {
    expect(() => deserializeProject(tamper((m) => (m.version = 99)))).toThrow(/versão mais nova/);
  });

  it('validates manifest contents', () => {
    expect(() => deserializeProject(tamper((m) => (m.document.width = 0)))).toThrow(/Manifesto inválido/);
    expect(() => deserializeProject(tamper((m) => (m.document.width = 100000)))).toThrow(ProjectFormatError);
    expect(() => deserializeProject(tamper((m) => (m.document.layers[0].id = '../../etc')))).toThrow(ProjectFormatError);
    expect(() => deserializeProject(tamper((m) => (m.document.cels['nope/x'] = Object.values(m.document.cels)[0])))).toThrow(/Célula inválida/);
    expect(() => deserializeProject(tamper((m) => { const k = Object.keys(m.images)[0]!; m.images[k].file = '../evil.png'; }))).toThrow(ProjectFormatError);
    expect(() => deserializeProject(tamper((m) => (m.document.layers.push({ ...m.document.layers[0] }))))).toThrow(/duplicados/);
  });

  it('rejects images whose size does not match the document', () => {
    const bytes = tamper((m) => {
      m.document.width = 9;
      for (const k of Object.keys(m.images)) m.images[k].width = 9;
    });
    expect(() => deserializeProject(bytes)).toThrow(/dimensões/);
  });

  it('ignores unexpected archive entries such as path traversal names', () => {
    const bytes = tamper(() => {}, { '../../evil.sh': strToU8('rm -rf /'), 'images/../../x.png': strToU8('x') });
    expect(() => deserializeProject(bytes)).not.toThrow();
  });

  it('migrates legacy v0 manifests', () => {
    const bytes = tamper((m) => {
      m.version = 0;
      m.document.palette = m.document.palette.colors;
      delete m.document.guides;
      delete m.document.symmetry;
    });
    const doc = deserializeProject(bytes);
    expect(doc.state.palette.colors.length).toBeGreaterThan(0);
    expect(doc.state.guides).toEqual([]);
  });
});
