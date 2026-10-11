import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { decodePng, encodePng, readPngInfo, PngError } from '../import-export/png';
import { composeFrame } from '../layers/compose';
import { parseHex, toHex } from '../raster/color';
import { type PixelBuffer } from '../raster/pixel-buffer';
import { LIMITS } from './limits';
import { FormatVersionError, migrateManifest } from './migrations';
import { CURRENT_FORMAT_VERSION, manifestSchema, type LayerJson, type Manifest } from './schema';
import { allLayers, parseCelKey, type DocState, type LayerNode, type ProjectDocument } from './model';

export const PROJECT_MIME = 'application/x-pixelcraft';
export const PROJECT_EXTENSION = 'pixelcraft';

export class ProjectFormatError extends Error {}

export interface SerializeOptions {
  generator: string;
  /** Embed a thumbnail.png of the first frame (for file managers / recent list). */
  thumbnail?: boolean;
}

function layersToJson(layers: LayerNode[]): LayerJson[] {
  return layers.map((l) => {
    const base = {
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      blendMode: l.blendMode,
      colorTag: l.colorTag,
      exportable: l.exportable,
    };
    return l.type === 'group'
      ? { ...base, type: 'group', expanded: l.expanded, children: layersToJson(l.children) }
      : { ...base, type: 'pixel' };
  });
}

function layersFromJson(layers: LayerJson[]): LayerNode[] {
  return layers.map((l) =>
    l.type === 'group' ? { ...l, children: layersFromJson(l.children) } : { ...l },
  );
}

/** Builds the .pixelcraft archive (ZIP: mimetype, manifest.json, images/*.png). */
export function serializeProject(doc: ProjectDocument, opts: SerializeOptions): Uint8Array {
  const s = doc.state;
  const files: Zippable = {
    mimetype: [strToU8(PROJECT_MIME), { level: 0 }],
  };
  const imagesJson: Manifest['images'] = {};
  const used = new Set(Object.values(s.cels));
  const pngs: Record<string, Uint8Array> = {};
  for (const id of used) {
    const img = doc.images.get(id);
    if (!img) throw new ProjectFormatError(`Imagem ${id} ausente no documento.`);
    const file = `images/${id}.png`;
    pngs[file] = encodePng(img);
    imagesJson[id] = { file, width: img.width, height: img.height };
  }
  const manifest: Manifest = {
    format: 'pixelcraft',
    version: CURRENT_FORMAT_VERSION,
    generator: opts.generator,
    savedAt: new Date().toISOString(),
    document: {
      id: doc.id,
      name: doc.name,
      width: s.width,
      height: s.height,
      layers: layersToJson(s.layers),
      frames: s.frames.map((f) => ({ id: f.id, duration: f.duration })),
      tags: s.tags.map((t) => ({ ...t })),
      cels: { ...s.cels },
      palette: { id: s.palette.id, name: s.palette.name, colors: s.palette.colors.map((c) => toHex(c, true)) },
      animation: { ...s.animation },
      tiles: { ...s.tiles },
      guides: s.guides.map((g) => ({ ...g })),
      symmetry: { ...s.symmetry },
    },
    images: imagesJson,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1));
  for (const [file, data] of Object.entries(pngs)) files[file] = [data, { level: 0 }];
  if (opts.thumbnail !== false && s.frames[0]) {
    const thumb = composeFrame(s, (id) => doc.images.get(id), s.frames[0].id, { exportOnly: true });
    files['thumbnail.png'] = [encodePng(thumb), { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}

const ALLOWED_ENTRY = /^(mimetype|manifest\.json|thumbnail\.png|images\/[A-Za-z0-9_-]{1,64}\.png)$/;

/**
 * Reads and fully validates a .pixelcraft archive. Nothing is extracted to
 * disk: entries are looked up in memory by exact, whitelisted names, so a
 * crafted archive cannot write outside any directory ("zip slip"). Declared
 * sizes are checked before inflating and decompression output is bounded.
 */
export function deserializeProject(bytes: Uint8Array): ProjectDocument {
  if (bytes.length > LIMITS.maxProjectFileBytes) throw new ProjectFormatError('O arquivo é grande demais para ser aberto.');
  let entries: Record<string, Uint8Array>;
  let count = 0;
  let declared = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        if (++count > LIMITS.maxArchiveEntries) throw new ProjectFormatError('O arquivo contém entradas demais.');
        if (!ALLOWED_ENTRY.test(f.name)) return false; // ignore unknown entries, never extract them
        const max = f.name === 'manifest.json' ? LIMITS.maxManifestBytes : LIMITS.maxDimension * LIMITS.maxDimension * 8;
        if (f.originalSize > max) throw new ProjectFormatError(`Entrada grande demais no arquivo: ${f.name}`);
        declared += f.originalSize;
        if (declared > LIMITS.maxTotalImageBytes * 2) throw new ProjectFormatError('O conteúdo descompactado é grande demais.');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ProjectFormatError) throw e;
    throw new ProjectFormatError('O arquivo não é um projeto PixelCraft válido (ZIP ilegível).');
  }
  const mimetype = entries['mimetype'];
  if (!mimetype || strFromU8(mimetype) !== PROJECT_MIME) {
    throw new ProjectFormatError('O arquivo não é um projeto PixelCraft (identificação ausente).');
  }
  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) throw new ProjectFormatError('O projeto não contém manifest.json.');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new ProjectFormatError('manifest.json não é um JSON válido.');
  }
  let migrated: unknown;
  try {
    migrated = migrateManifest(raw);
  } catch (e) {
    if (e instanceof FormatVersionError) throw new ProjectFormatError(e.message);
    throw e;
  }
  const parsed = manifestSchema.safeParse(migrated);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ProjectFormatError(
      `Manifesto inválido${issue ? ` em "${issue.path.join('.')}": ${issue.message}` : ''}.`,
    );
  }
  const m = parsed.data;
  const d = m.document;
  const layers = layersFromJson(d.layers);
  validateStructure(layers, d.frames.map((f) => f.id), d.cels, m.images, d.width, d.height);
  const frameIds = new Set(d.frames.map((f) => f.id));
  for (const t of d.tags) if (!frameIds.has(t.from) || !frameIds.has(t.to)) throw new ProjectFormatError(`A tag "${t.name}" aponta para um quadro inexistente.`);

  const images = new Map<string, PixelBuffer>();
  let total = 0;
  for (const [id, entry] of Object.entries(m.images)) {
    const data = entries[entry.file];
    if (!data) throw new ProjectFormatError(`Imagem ausente no arquivo: ${entry.file}`);
    try {
      const info = readPngInfo(data);
      if (info.width !== d.width || info.height !== d.height) {
        throw new ProjectFormatError(`A imagem ${entry.file} não tem as dimensões do documento.`);
      }
      total += info.width * info.height * 4;
      if (total > LIMITS.maxTotalImageBytes) throw new ProjectFormatError('O projeto excede o limite de memória de imagens.');
      images.set(id, decodePng(data, { maxPixels: LIMITS.maxPixels }));
    } catch (e) {
      if (e instanceof PngError) throw new ProjectFormatError(`Imagem corrompida (${entry.file}): ${e.message}`);
      throw e;
    }
  }

  const colors = d.palette.colors.map((h) => parseHex(h)!);
  const state: DocState = {
    width: d.width,
    height: d.height,
    layers,
    frames: d.frames.map((f) => ({ ...f })),
    tags: d.tags.map((t) => ({ ...t })),
    cels: { ...d.cels },
    palette: { id: d.palette.id, name: d.palette.name, colors },
    animation: { ...d.animation },
    tiles: { ...d.tiles },
    guides: d.guides.map((g) => ({ ...g })),
    symmetry: { ...d.symmetry },
  };
  return { id: d.id, name: d.name, state, images };
}

function validateStructure(
  layers: LayerNode[],
  frameIds: string[],
  cels: Record<string, string>,
  images: Manifest['images'],
  width: number,
  height: number,
): void {
  const all = allLayers(layers);
  if (all.length > LIMITS.maxLayers) throw new ProjectFormatError('O projeto tem camadas demais.');
  const ids = new Set<string>();
  for (const l of all) {
    if (ids.has(l.id)) throw new ProjectFormatError('Identificadores de camada duplicados.');
    ids.add(l.id);
  }
  const depth = (ls: LayerNode[], d: number): void => {
    if (d > LIMITS.maxGroupDepth) throw new ProjectFormatError('Grupos aninhados em excesso.');
    for (const l of ls) if (l.type === 'group') depth(l.children, d + 1);
  };
  depth(layers, 0);
  const frames = new Set(frameIds);
  if (frames.size !== frameIds.length) throw new ProjectFormatError('Identificadores de quadro duplicados.');
  const pixelIds = new Set(all.filter((l) => l.type === 'pixel').map((l) => l.id));
  for (const [key, imageId] of Object.entries(cels)) {
    const { layerId, frameId } = parseCelKey(key);
    if (!pixelIds.has(layerId) || !frames.has(frameId)) throw new ProjectFormatError(`Célula inválida: ${key}`);
    const img = images[imageId];
    if (!img) throw new ProjectFormatError(`Célula referencia imagem inexistente: ${imageId}`);
    if (img.width !== width || img.height !== height) throw new ProjectFormatError('Dimensões de imagem inconsistentes.');
  }
}
