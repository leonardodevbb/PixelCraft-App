/**
 * "PixelCraft Sans 5×7": a bitmap font drawn for this project (MIT, same
 * license as the code). Each glyph is a list of rows separated by "/", where
 * "#" is ink. Rows 0–6 are the cap height (baseline under row 6); optional
 * rows 7–8 are descenders. Accented Latin letters used in Portuguese and
 * Spanish are composed from a base glyph plus a diacritic mark.
 */

export interface BitmapFont {
  name: string;
  /** Rows from the top of an accent to the bottom of descenders. */
  lineHeight: number;
  /** Rows reserved above the cap height for accents on capitals. */
  ascent: number;
  glyphs: Map<string, Glyph>;
  fallback: Glyph;
}

export interface Glyph {
  width: number;
  /** Rows relative to cap top; may be negative (accents) or > 6 (descenders). */
  pixels: { x: number; y: number }[];
}

const BASE: Record<string, string> = {
  ' ': '.../.../.../.../.../.../...',
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.####',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '###/.#./.#./.#./.#./.#./###',
  J: '..###/...#./...#./...#./#..#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
  N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  a: '..../..../.##./...#/.###/#..#/.###',
  b: '#.../#.../###./#..#/#..#/#..#/###.',
  c: '..../..../.###/#.../#.../#.../.###',
  d: '...#/...#/.###/#..#/#..#/#..#/.###',
  e: '..../..../.##./#..#/####/#.../.###',
  f: '..##/.#../.#../###./.#../.#../.#..',
  g: '..../..../.###/#..#/#..#/#..#/.###/...#/.##.',
  h: '#.../#.../###./#..#/#..#/#..#/#..#',
  i: '#/./#/#/#/#/#',
  j: '..#/.../..#/..#/..#/..#/..#/..#/##.',
  k: '#.../#.../#..#/#.#./##../#.#./#..#',
  l: '#./#./#./#./#./#./.#',
  m: '...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#',
  n: '..../..../###./#..#/#..#/#..#/#..#',
  o: '..../..../.##./#..#/#..#/#..#/.##.',
  p: '..../..../###./#..#/#..#/#..#/###./#.../#...',
  q: '..../..../.###/#..#/#..#/#..#/.###/...#/...#',
  r: '..../..../#.##/##../#.../#.../#...',
  s: '..../..../.###/#.../.##./...#/###.',
  t: '.#../.#../###./.#../.#../.#../..##',
  u: '..../..../#..#/#..#/#..#/#..#/.###',
  v: '...../...../#...#/#...#/.#.#./.#.#./..#..',
  w: '...../...../#...#/#.#.#/#.#.#/#.#.#/.#.#.',
  x: '..../..../#..#/#..#/.##./#..#/#..#',
  y: '..../..../#..#/#..#/#..#/#..#/.###/...#/.##.',
  z: '..../..../####/...#/.##./#.../####',
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  '1': '.#./##./.#./.#./.#./.#./###',
  '2': '.###./#...#/....#/...#./..#../.#.../#####',
  '3': '####./....#/....#/.###./....#/....#/####.',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#.',
  '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '.###./#..../#..../####./#...#/#...#/.###.',
  '7': '#####/....#/...#./..#../.#.../.#.../.#...',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
  '9': '.###./#...#/#...#/.####/....#/....#/.###.',
  '!': '#/#/#/#/#/./#',
  '"': '#.#/#.#/.../.../.../.../...',
  '#': '...../.#.#./#####/.#.#./#####/.#.#./.....',
  $: '..#../.####/#.#../.###./..#.#/####./..#..',
  '%': '##..#/##.#./...#./..#../.#.../.#.##/#..##',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#',
  "'": '#/#/./././././.',
  '(': '.#/#./#./#./#./#./.#',
  ')': '#./.#/.#/.#/.#/.#/#.',
  '*': '...../..#../#.#.#/.###./#.#.#/..#../.....',
  '+': '...../..#../..#../#####/..#../..#../.....',
  ',': '../../../../../.#/.#/#.',
  '-': '..../..../..../####/..../..../....',
  '.': '././././././#',
  '/': '....#/...#./...#./..#../.#.../.#.../#....',
  ':': '././#/./././#',
  ';': '../../.#/../../.#/.#/#.',
  '<': '...#/..#./.#../#.../.#../..#./...#',
  '=': '..../..../####/..../####/..../....',
  '>': '#.../.#../..#./...#/..#./.#../#...',
  '?': '.###./#...#/....#/...#./..#../...../..#..',
  '@': '.###./#...#/#.###/#.#.#/#.###/#..../.####',
  '[': '##/#./#./#./#./#./##',
  '\\': '#..../.#.../.#.../..#../...#./...#./....#',
  ']': '##/.#/.#/.#/.#/.#/##',
  '^': '..#../.#.#./#...#/...../...../...../.....',
  _: '..../..../..../..../..../..../####',
  '`': '#./.#/../../../../..',
  '{': '..#/.#./.#./#../.#./.#./..#',
  '|': '#/#/#/#/#/#/#',
  '}': '#../.#./.#./..#/.#./.#./#..',
  '~': '...../...../.#.../#.#.#/...#./...../.....',
  // dotless i, used as the base for accented i
  ı: './././#/#/#/#',
  '°': '.#./#.#/.#./.../.../.../...',
  '–': '...../...../...../#####/...../...../.....',
};

const MARKS: Record<string, string[]> = {
  acute: ['..#', '.#.'],
  grave: ['#..', '.#.'],
  circumflex: ['.#.', '#.#'],
  tilde: ['.#.#', '#.#.'],
  diaeresis: ['#.#', '...'],
};

/** char → [base, mark] */
const COMPOSED: Record<string, [string, keyof typeof MARKS | 'cedilla']> = {
  á: ['a', 'acute'], à: ['a', 'grave'], â: ['a', 'circumflex'], ã: ['a', 'tilde'], ä: ['a', 'diaeresis'],
  é: ['e', 'acute'], è: ['e', 'grave'], ê: ['e', 'circumflex'], ë: ['e', 'diaeresis'],
  í: ['ı', 'acute'], ì: ['ı', 'grave'], î: ['ı', 'circumflex'], ï: ['ı', 'diaeresis'],
  ó: ['o', 'acute'], ò: ['o', 'grave'], ô: ['o', 'circumflex'], õ: ['o', 'tilde'], ö: ['o', 'diaeresis'],
  ú: ['u', 'acute'], ù: ['u', 'grave'], û: ['u', 'circumflex'], ü: ['u', 'diaeresis'],
  ñ: ['n', 'tilde'], ç: ['c', 'cedilla'],
  Á: ['A', 'acute'], À: ['A', 'grave'], Â: ['A', 'circumflex'], Ã: ['A', 'tilde'], Ä: ['A', 'diaeresis'],
  É: ['E', 'acute'], È: ['E', 'grave'], Ê: ['E', 'circumflex'], Ë: ['E', 'diaeresis'],
  Í: ['I', 'acute'], Ì: ['I', 'grave'], Î: ['I', 'circumflex'], Ï: ['I', 'diaeresis'],
  Ó: ['O', 'acute'], Ò: ['O', 'grave'], Ô: ['O', 'circumflex'], Õ: ['O', 'tilde'], Ö: ['O', 'diaeresis'],
  Ú: ['U', 'acute'], Ù: ['U', 'grave'], Û: ['U', 'circumflex'], Ü: ['U', 'diaeresis'],
  Ñ: ['N', 'tilde'], Ç: ['C', 'cedilla'],
};

function parse(src: string): Glyph {
  const rows = src.split('/');
  const width = Math.max(...rows.map((r) => r.length));
  const pixels: Glyph['pixels'] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') pixels.push({ x, y });
  });
  return { width, pixels };
}

function compose(base: Glyph, mark: keyof typeof MARKS | 'cedilla', capital: boolean): Glyph {
  const pixels = [...base.pixels];
  if (mark === 'cedilla') {
    const cx = Math.floor(base.width / 2);
    pixels.push({ x: cx, y: 7 }, { x: cx - 1, y: 8 });
    return { width: base.width, pixels };
  }
  const m = MARKS[mark]!;
  const mw = m[0]!.length;
  const ox = Math.floor((base.width - mw) / 2);
  const top = capital ? -2 : 0;
  m.forEach((row, dy) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') pixels.push({ x: ox + x, y: top + dy });
  });
  return { width: Math.max(base.width, ox + mw), pixels };
}

function build(): BitmapFont {
  const glyphs = new Map<string, Glyph>();
  for (const [ch, src] of Object.entries(BASE)) glyphs.set(ch, parse(src));
  for (const [ch, [base, mark]] of Object.entries(COMPOSED)) {
    const b = glyphs.get(base)!;
    glyphs.set(ch, compose(b, mark, base === base.toUpperCase() && base !== 'ı'));
  }
  return {
    name: 'PixelCraft Sans 5×7',
    lineHeight: 11,
    ascent: 2,
    glyphs,
    fallback: parse('#####/#...#/#...#/#...#/#...#/#...#/#####'),
  };
}

export const PIXELCRAFT_SANS = build();

export interface TextLayoutOptions {
  letterSpacing?: number;
  /** Extra pixels between lines. */
  lineSpacing?: number;
  align?: 'left' | 'center' | 'right';
  /** Integer pixel scale of each font pixel. */
  scale?: number;
}

export interface TextMask {
  width: number;
  height: number;
  /** 1 = ink */
  mask: Uint8Array;
}

/** Rasterizes text to a 1-bit mask. Unknown characters render as a box. */
export function renderText(text: string, font: BitmapFont = PIXELCRAFT_SANS, opts: TextLayoutOptions = {}): TextMask {
  const ls = opts.letterSpacing ?? 1;
  const lineGap = opts.lineSpacing ?? 1;
  const scale = Math.max(1, Math.floor(opts.scale ?? 1));
  const lines = text.split('\n');
  const layout = lines.map((line) => {
    const chars = [...line].map((ch) => font.glyphs.get(ch) ?? font.fallback);
    const width = chars.reduce((w, g, i) => w + g.width + (i > 0 ? ls : 0), 0);
    return { chars, width };
  });
  const innerW = Math.max(1, ...layout.map((l) => l.width));
  const innerH = lines.length * font.lineHeight + (lines.length - 1) * lineGap;
  const width = innerW * scale;
  const height = innerH * scale;
  const mask = new Uint8Array(width * height);
  layout.forEach((line, li) => {
    let x = opts.align === 'center' ? Math.floor((innerW - line.width) / 2) : opts.align === 'right' ? innerW - line.width : 0;
    const baseY = li * (font.lineHeight + lineGap) + font.ascent;
    for (const g of line.chars) {
      for (const p of g.pixels) {
        const px = x + p.x;
        const py = baseY + p.y;
        if (px < 0 || py < 0 || px >= innerW || py >= innerH) continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++) mask[(py * scale + sy) * width + px * scale + sx] = 1;
      }
      x += g.width + ls;
    }
  });
  return { width, height, mask };
}
