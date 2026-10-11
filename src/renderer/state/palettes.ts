import { z } from 'zod';
import { create } from 'zustand';
import { defaultPalette, hexList } from '../../palette/defaults';
import { newId } from '../../project/ids';
import { LIMITS } from '../../project/limits';
import type { Palette } from '../../project/model';
import { parseHex, toHex } from '../../raster/color';
import { api } from '../api';

/** Palettes shipped with the app (colour lists made for PixelCraft). */
export const BUILTIN_PALETTES: Palette[] = [
  defaultPalette(),
  {
    id: 'builtin-gray-8',
    name: 'Escala de cinza 8',
    colors: hexList(['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff']),
  },
  { id: 'builtin-green-4', name: 'Verde portátil 4', colors: hexList(['#0f380f', '#306230', '#8bac0f', '#9bbc0f']) },
  {
    id: 'builtin-warm-16',
    name: 'Quentes 16',
    colors: hexList([
      '#1a0f14', '#3d1a24', '#6b2533', '#9c3340', '#c94a45', '#e8714a', '#f29b5c', '#f7c27a',
      '#fbe2a6', '#4a2a1a', '#7a4523', '#a8662d', '#d18f3e', '#e8b85a', '#f5dc8c', '#fff6d6',
    ]),
  },
];

const fileSchema = z.object({
  version: z.literal(1),
  palettes: z
    .array(
      z.object({
        id: z.string().max(80),
        name: z.string().max(LIMITS.maxNameLength),
        colors: z.array(z.string().regex(/^#[0-9a-fA-F]{8}$/)).max(LIMITS.maxPaletteColors),
      }),
    )
    .max(500),
});

interface PaletteLibrary {
  loaded: boolean;
  /** User palettes stored in the config directory (shared by all projects). */
  user: Palette[];
  load(): Promise<void>;
  save(p: Palette): Promise<void>;
  remove(id: string): Promise<void>;
}

async function persist(list: Palette[]): Promise<void> {
  await api.palettes.save({ version: 1, palettes: list.map((p) => ({ id: p.id, name: p.name, colors: p.colors.map((c) => toHex(c)) })) });
}

export const usePalettes = create<PaletteLibrary>((set, get) => ({
  loaded: false,
  user: [],
  async load() {
    try {
      const raw = await api.palettes.load();
      const parsed = raw ? fileSchema.safeParse(raw) : null;
      const user =
        parsed?.success === true
          ? parsed.data.palettes.map((p) => ({ id: p.id, name: p.name, colors: p.colors.map((h) => parseHex(h)!).filter((c) => c !== null) }))
          : [];
      set({ user, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async save(p) {
    const list = get().user;
    const i = list.findIndex((x) => x.id === p.id);
    const next = i >= 0 ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
    set({ user: next });
    await persist(next);
  },
  async remove(id) {
    const next = get().user.filter((p) => p.id !== id);
    set({ user: next });
    await persist(next);
  },
}));

export function libraryPalette(name: string, colors: Palette['colors']): Palette {
  return { id: newId('P'), name: name.slice(0, LIMITS.maxNameLength), colors: colors.slice(0, LIMITS.maxPaletteColors) };
}
