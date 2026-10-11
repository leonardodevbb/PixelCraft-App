import { z } from 'zod';
import { BLEND_MODES } from '../raster/blend';
import { LIMITS } from './limits';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'identificador inválido');
const name = z.string().max(LIMITS.maxNameLength);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{8}$/, 'cor inválida');
const dim = z.number().int().min(1).max(LIMITS.maxDimension);

const layerBase = {
  id,
  name,
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: z.number().min(0).max(100),
  blendMode: z.enum(BLEND_MODES),
  colorTag: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  exportable: z.boolean(),
};

export type LayerJson =
  | ({ type: 'pixel' } & z.infer<z.ZodObject<typeof layerBase>>)
  | ({ type: 'group'; expanded: boolean; children: LayerJson[] } & z.infer<z.ZodObject<typeof layerBase>>);

export const layerSchema: z.ZodType<LayerJson> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ ...layerBase, type: z.literal('pixel') }),
    z.object({ ...layerBase, type: z.literal('group'), expanded: z.boolean(), children: z.array(layerSchema) }),
  ]),
);

export const frameSchema = z.object({
  id,
  duration: z.number().int().min(LIMITS.minFrameDuration).max(LIMITS.maxFrameDuration),
  tag: z.string().max(LIMITS.maxNameLength).optional(),
});

export const documentSchema = z.object({
  id,
  name,
  width: dim,
  height: dim,
  layers: z.array(layerSchema).min(1),
  frames: z.array(frameSchema).min(1).max(LIMITS.maxFrames),
  cels: z.record(z.string().max(140), id),
  palette: z.object({ id, name, colors: z.array(hexColor).max(LIMITS.maxPaletteColors) }),
  animation: z.object({
    fps: z.number().min(1).max(60),
    loop: z.enum(['loop', 'once', 'pingpong']),
    direction: z.enum(['forward', 'reverse']),
  }),
  tiles: z.object({
    width: dim,
    height: dim,
    offsetX: z.number().int().min(0).max(LIMITS.maxDimension),
    offsetY: z.number().int().min(0).max(LIMITS.maxDimension),
  }),
  guides: z.array(z.object({ axis: z.enum(['x', 'y']), position: z.number().min(0).max(LIMITS.maxDimension) })).max(256),
  symmetry: z.object({
    horizontal: z.boolean(),
    vertical: z.boolean(),
    axisX: z.number().min(0).max(LIMITS.maxDimension),
    axisY: z.number().min(0).max(LIMITS.maxDimension),
  }),
});

export const imageEntrySchema = z.object({
  file: z.string().regex(/^images\/[A-Za-z0-9_-]{1,64}\.png$/),
  width: dim,
  height: dim,
});

export const CURRENT_FORMAT_VERSION = 1;

export const manifestSchema = z.object({
  format: z.literal('pixelcraft'),
  version: z.literal(CURRENT_FORMAT_VERSION),
  generator: z.string().max(200),
  createdWith: z.string().max(200).optional(),
  savedAt: z.string().max(64),
  document: documentSchema,
  images: z.record(id, imageEntrySchema),
});

export type Manifest = z.infer<typeof manifestSchema>;
