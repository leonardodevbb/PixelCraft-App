import { parseHex, type RGBA } from '../raster/color';
import type { Palette } from '../project/model';

/**
 * "PixelCraft 32": the default palette, assembled for this project. It covers
 * warm and cool ramps, skin tones, foliage and a neutral ramp, which is enough
 * for beginners to shade sprites without building a palette first.
 */
const PIXELCRAFT_32 = [
  '#000000', '#1b1726', '#3a3450', '#5f5a78', '#8e8aa6', '#c4c1d6', '#f4f2fa', '#ffffff',
  '#5c1f2e', '#a3273d', '#e8434f', '#ff8a6b', '#7a3b1c', '#c26a2e', '#f2a541', '#ffe08a',
  '#2b4a1f', '#3f7d2c', '#73b73e', '#c2e86b', '#173f4a', '#1f7a7a', '#36c2b0', '#9ff0d9',
  '#1c2560', '#2f4fbf', '#4f9cff', '#a8d8ff', '#3b1f5c', '#7240b8', '#c06be0', '#ffb3e6',
];

export function hexList(list: string[]): RGBA[] {
  return list.map((h) => {
    const c = parseHex(h);
    if (c === null) throw new Error(`Cor inválida na paleta padrão: ${h}`);
    return c;
  });
}

export function defaultPalette(): Palette {
  return { id: 'pixelcraft-32', name: 'PixelCraft 32', colors: hexList(PIXELCRAFT_32) };
}
