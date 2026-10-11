import { alpha, blue, green, parseHex, red, rgba, toHex, type RGBA } from '../raster/color';
import { LIMITS } from '../project/limits';

/**
 * Palette file formats. Every parser is defensive: it accepts only the
 * documented syntax, caps the number of colours and never evaluates content.
 */
export type PaletteFormat = 'gpl' | 'hex' | 'json' | 'jasc' | 'act';

export const PALETTE_FORMATS: { id: PaletteFormat; label: string; ext: string }[] = [
  { id: 'gpl', label: 'GIMP Palette (.gpl)', ext: 'gpl' },
  { id: 'hex', label: 'Lista HEX (.hex)', ext: 'hex' },
  { id: 'json', label: 'JSON do PixelCraft (.json)', ext: 'json' },
  { id: 'jasc', label: 'JASC-PAL (.pal)', ext: 'pal' },
  { id: 'act', label: 'Adobe Color Table (.act)', ext: 'act' },
];

export class PaletteFormatError extends Error {}

export interface ParsedPalette {
  name: string | null;
  colors: RGBA[];
}

const MAX_TEXT = 1024 * 1024;

function decodeText(bytes: Uint8Array): string {
  if (bytes.length > MAX_TEXT) throw new PaletteFormatError('O arquivo de paleta é grande demais.');
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^﻿/, '');
}

function cap(colors: RGBA[]): RGBA[] {
  if (colors.length === 0) throw new PaletteFormatError('Nenhuma cor válida foi encontrada no arquivo.');
  if (colors.length > LIMITS.maxPaletteColors) throw new PaletteFormatError(`A paleta tem mais de ${LIMITS.maxPaletteColors} cores.`);
  return colors;
}

function byte(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new PaletteFormatError(`Valor de cor inválido: ${v.slice(0, 20)}`);
  return n;
}

export function parseGpl(text: string): ParsedPalette {
  const lines = text.split(/\r?\n/);
  if (!/^GIMP Palette\s*$/.test(lines[0]?.trim() ?? '')) throw new PaletteFormatError('Cabeçalho "GIMP Palette" ausente.');
  let name: string | null = null;
  const colors: RGBA[] = [];
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^Name:\s*(.*)$/i.exec(line);
    if (m) {
      name = m[1]!.trim().slice(0, LIMITS.maxNameLength) || null;
      continue;
    }
    if (/^Columns:/i.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) throw new PaletteFormatError(`Linha inválida: ${line.slice(0, 40)}`);
    colors.push(rgba(byte(parts[0]!), byte(parts[1]!), byte(parts[2]!)));
  }
  return { name, colors: cap(colors) };
}

export function writeGpl(name: string, colors: RGBA[]): string {
  const lines = ['GIMP Palette', `Name: ${name.replace(/[\r\n]/g, ' ')}`, 'Columns: 8', '#'];
  for (const c of colors) {
    const r = red(c);
    const g = green(c);
    const b = blue(c);
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${toHex(c).slice(1, 7)}`);
  }
  return lines.join('\n') + '\n';
}

/** One colour per line, "RRGGBB", "#RRGGBB" or "RRGGBBAA". Lospec's .hex format. */
export function parseHexList(text: string): ParsedPalette {
  const colors: RGBA[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;
    const c = parseHex(line.startsWith('#') ? line : `#${line}`);
    if (c === null) throw new PaletteFormatError(`Cor HEX inválida: ${line.slice(0, 20)}`);
    colors.push(c);
  }
  return { name: null, colors: cap(colors) };
}

export function writeHexList(colors: RGBA[]): string {
  return colors.map((c) => (alpha(c) === 255 ? toHex(c).slice(1, 7) : toHex(c).slice(1))).join('\n') + '\n';
}

export function parseJsonPalette(text: string): ParsedPalette {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PaletteFormatError('JSON inválido.');
  }
  const list = Array.isArray(data) ? data : (data as { colors?: unknown })?.colors;
  if (!Array.isArray(list)) throw new PaletteFormatError('O JSON precisa ter uma lista "colors" de cores HEX.');
  const colors = list.map((v) => {
    const c = typeof v === 'string' ? parseHex(v) : null;
    if (c === null) throw new PaletteFormatError(`Cor inválida: ${String(v).slice(0, 20)}`);
    return c;
  });
  const n = !Array.isArray(data) ? (data as { name?: unknown }).name : null;
  return { name: typeof n === 'string' ? n.slice(0, LIMITS.maxNameLength) : null, colors: cap(colors) };
}

export function writeJsonPalette(name: string, colors: RGBA[]): string {
  return JSON.stringify({ format: 'pixelcraft-palette', version: 1, name, colors: colors.map((c) => toHex(c)) }, null, 2) + '\n';
}

export function parseJasc(text: string): ParsedPalette {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== 'JASC-PAL') throw new PaletteFormatError('Cabeçalho "JASC-PAL" ausente.');
  const count = Number(lines[2]);
  if (!Number.isInteger(count) || count < 1) throw new PaletteFormatError('Quantidade de cores inválida.');
  if (count > LIMITS.maxPaletteColors) throw new PaletteFormatError(`A paleta tem mais de ${LIMITS.maxPaletteColors} cores.`);
  const colors: RGBA[] = [];
  for (let i = 0; i < count; i++) {
    const parts = (lines[3 + i] ?? '').split(/\s+/);
    if (parts.length < 3) throw new PaletteFormatError('O arquivo termina antes do número de cores declarado.');
    colors.push(rgba(byte(parts[0]!), byte(parts[1]!), byte(parts[2]!)));
  }
  return { name: null, colors: cap(colors) };
}

export function writeJasc(colors: RGBA[]): string {
  return ['JASC-PAL', '0100', String(colors.length), ...colors.map((c) => `${red(c)} ${green(c)} ${blue(c)}`)].join('\r\n') + '\r\n';
}

/** 768 bytes of RGB, optionally followed by a 16-bit count and transparent index. */
export function parseAct(bytes: Uint8Array): ParsedPalette {
  if (bytes.length !== 768 && bytes.length !== 772) throw new PaletteFormatError('Arquivos ACT têm 768 ou 772 bytes.');
  let count = 256;
  let transparent = -1;
  if (bytes.length === 772) {
    count = (bytes[768]! << 8) | bytes[769]!;
    transparent = (bytes[770]! << 8) | bytes[771]!;
    if (count < 1 || count > 256) count = 256;
    if (transparent > 255) transparent = -1;
  }
  const colors: RGBA[] = [];
  for (let i = 0; i < count; i++) {
    if (i === transparent) continue;
    colors.push(rgba(bytes[i * 3]!, bytes[i * 3 + 1]!, bytes[i * 3 + 2]!));
  }
  return { name: null, colors: cap(colors) };
}

export function writeAct(colors: RGBA[]): Uint8Array {
  const out = new Uint8Array(772);
  const list = colors.slice(0, 256);
  list.forEach((c, i) => {
    out[i * 3] = red(c);
    out[i * 3 + 1] = green(c);
    out[i * 3 + 2] = blue(c);
  });
  out[768] = list.length >> 8;
  out[769] = list.length & 255;
  out[770] = 0xff;
  out[771] = 0xff;
  return out;
}

export function detectPaletteFormat(fileName: string, bytes: Uint8Array): PaletteFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'act') return 'act';
  const head = decodeText(bytes.subarray(0, 64)).trimStart();
  if (head.startsWith('GIMP Palette')) return 'gpl';
  if (head.startsWith('JASC-PAL')) return 'jasc';
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  if (ext === 'gpl') return 'gpl';
  if (ext === 'pal') return 'jasc';
  if (ext === 'json') return 'json';
  if ((bytes.length === 768 || bytes.length === 772) && ext !== 'hex' && ext !== 'txt') return 'act';
  return 'hex';
}

export function parsePalette(fileName: string, bytes: Uint8Array): ParsedPalette {
  const fmt = detectPaletteFormat(fileName, bytes);
  if (fmt === 'act') return parseAct(bytes);
  const text = decodeText(bytes);
  switch (fmt) {
    case 'gpl':
      return parseGpl(text);
    case 'jasc':
      return parseJasc(text);
    case 'json':
      return parseJsonPalette(text);
    default:
      return parseHexList(text);
  }
}

export function writePalette(format: PaletteFormat, name: string, colors: RGBA[]): Uint8Array {
  if (format === 'act') return writeAct(colors);
  const text =
    format === 'gpl' ? writeGpl(name, colors) : format === 'jasc' ? writeJasc(colors) : format === 'json' ? writeJsonPalette(name, colors) : writeHexList(colors);
  return new TextEncoder().encode(text);
}
