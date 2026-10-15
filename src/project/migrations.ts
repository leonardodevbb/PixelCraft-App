import { CURRENT_FORMAT_VERSION } from './schema';

export class FormatVersionError extends Error {}

/**
 * Upgrades a raw manifest object to the current format version. Each step
 * converts version N into N+1. Version 0 was the pre-release layout used by
 * development builds (single "layers" array without groups, palette as a
 * plain list); it is accepted so early test files keep opening.
 */
type Migration = (m: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  0: (m) => {
    const doc = { ...(m.document as Record<string, unknown>) };
    if (Array.isArray(doc.palette)) {
      doc.palette = { id: 'legacy', name: 'Paleta', colors: doc.palette };
    }
    doc.guides ??= [];
    doc.tiles ??= { width: 16, height: 16, offsetX: 0, offsetY: 0 };
    doc.animation ??= { fps: 10, loop: 'loop', direction: 'forward' };
    doc.symmetry ??= {
      horizontal: false,
      vertical: false,
      axisX: Number(doc.width) / 2,
      axisY: Number(doc.height) / 2,
    };
    if (Array.isArray(doc.layers)) {
      doc.layers = (doc.layers as Record<string, unknown>[]).map((l) => ({
        type: 'pixel',
        locked: false,
        blendMode: 'normal',
        colorTag: null,
        exportable: true,
        opacity: 100,
        visible: true,
        ...l,
      }));
    }
    return { ...m, version: 1, document: doc };
  },
  // v1 marked tags with a label on their first frame, running until the next
  // label. v2 stores tags as ranges with their own colour and direction.
  1: (m) => {
    const doc = { ...(m.document as Record<string, unknown>) };
    const frames = Array.isArray(doc.frames) ? (doc.frames as Record<string, unknown>[]) : [];
    const tags: Record<string, unknown>[] = [];
    const colors = ['#ff7a3d', '#2ec4b6', '#7b5cff', '#ffd23f', '#ff4f81', '#3ccf91', '#4aa8ff', '#c08a5b'];
    frames.forEach((f, i) => {
      if (typeof f.tag !== 'string' || !f.tag) return;
      const prev = tags.at(-1);
      if (prev) prev.to = frames[i - 1]!.id;
      tags.push({ id: `T${tags.length + 1}`, name: f.tag, from: f.id, to: frames.at(-1)!.id, color: colors[tags.length % colors.length], direction: 'forward', repeat: 0 });
    });
    doc.frames = frames.map(({ tag: _tag, ...rest }) => rest);
    doc.tags = tags;
    return { ...m, version: 2, document: doc };
  },
};

export function migrateManifest(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) throw new FormatVersionError('Manifesto ausente ou inválido.');
  let m = raw as Record<string, unknown>;
  const v = m.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new FormatVersionError('Versão do formato ausente ou inválida.');
  }
  if (v > CURRENT_FORMAT_VERSION) {
    throw new FormatVersionError(
      `Este projeto foi salvo por uma versão mais nova do PixelCraft (formato v${v}). Atualize o aplicativo para abri-lo.`,
    );
  }
  for (let cur = v; cur < CURRENT_FORMAT_VERSION; cur++) {
    const step = MIGRATIONS[cur];
    if (!step) throw new FormatVersionError(`Não há migração disponível do formato v${cur}.`);
    m = step(m);
  }
  return m;
}
