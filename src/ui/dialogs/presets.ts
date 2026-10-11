import { z } from 'zod';

export interface SizePreset {
  name: string;
  width: number;
  height: number;
  category: 'Ícones' | 'Personagens' | 'Tiles' | 'Objetos' | 'Telas' | 'Personalizadas';
}

/** Built-in presets. Users can add their own (stored in preferences). */
export const BUILTIN_PRESETS: SizePreset[] = [
  { name: 'Ícone pequeno', width: 16, height: 16, category: 'Ícones' },
  { name: 'Ícone', width: 32, height: 32, category: 'Ícones' },
  { name: 'Ícone grande', width: 64, height: 64, category: 'Ícones' },
  { name: 'Personagem 16', width: 16, height: 24, category: 'Personagens' },
  { name: 'Personagem 32', width: 32, height: 32, category: 'Personagens' },
  { name: 'Personagem 48', width: 48, height: 48, category: 'Personagens' },
  { name: 'Retrato', width: 64, height: 96, category: 'Personagens' },
  { name: 'Tile 8×8', width: 8, height: 8, category: 'Tiles' },
  { name: 'Tile 16×16', width: 16, height: 16, category: 'Tiles' },
  { name: 'Tile 32×32', width: 32, height: 32, category: 'Tiles' },
  { name: 'Tileset 8×8 tiles', width: 128, height: 128, category: 'Tiles' },
  { name: 'Item', width: 24, height: 24, category: 'Objetos' },
  { name: 'Objeto', width: 48, height: 32, category: 'Objetos' },
  { name: 'Tela retrô', width: 160, height: 144, category: 'Telas' },
  { name: 'Tela 16:9', width: 320, height: 180, category: 'Telas' },
  { name: 'Tela 4:3', width: 320, height: 240, category: 'Telas' },
];

export const customPresetSchema = z.array(
  z.object({ name: z.string().max(60), width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096) }),
);
