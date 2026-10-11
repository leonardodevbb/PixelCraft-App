/**
 * Keyboard shortcut strings use the form "Ctrl+Shift+S", "Alt+1", "B",
 * "Space", "Plus". Matching is done on the physical key's character where
 * possible (event.key), with "Ctrl" also matching the Meta key on macOS.
 */
export interface KeyChord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

const ALIASES: Record<string, string> = {
  ' ': 'Space',
  '+': 'Plus',
  '=': 'Plus',
  '-': 'Minus',
  _: 'Minus',
  Escape: 'Esc',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Delete: 'Delete',
  Backspace: 'Backspace',
};

export function normalizeKey(key: string): string {
  if (ALIASES[key]) return ALIASES[key]!;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function parseChord(s: string): KeyChord | null {
  const parts = s.split('+').map((p) => p.trim());
  // "Ctrl++" style: trailing empty parts mean the plus key.
  if (s.endsWith('++')) parts.splice(parts.length - 2, 2, 'Plus');
  let ctrl = false;
  let shift = false;
  let alt = false;
  let key = '';
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'ctrl' || l === 'control' || l === 'cmd') ctrl = true;
    else if (l === 'shift') shift = true;
    else if (l === 'alt') alt = true;
    else if (p) key = normalizeKey(p.length === 1 ? p : p[0]!.toUpperCase() + p.slice(1));
  }
  if (!key) return null;
  return { ctrl, shift, alt, key };
}

export function formatChord(c: KeyChord): string {
  return [c.ctrl && 'Ctrl', c.shift && 'Shift', c.alt && 'Alt', c.key].filter(Boolean).join('+');
}

/** Canonical form, used to compare and detect conflicts. */
export function canonical(s: string): string {
  const c = parseChord(s);
  return c ? formatChord(c) : '';
}

const PUNCT_CODES: Record<string, string> = {
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Backslash: '\\',
  Backquote: '`',
};

export function chordFromEvent(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'code'>): KeyChord | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
  let key = e.key;
  // With Shift held, event.key is the shifted symbol; use the physical digit/letter instead.
  if (e.code.startsWith('Key')) key = e.code.slice(3);
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else if (e.code === 'Equal' || e.code === 'NumpadAdd') key = '+';
  else if (e.code === 'Minus' || e.code === 'NumpadSubtract') key = '-';
  // Shift changes punctuation symbols ("'" → '"'); use the unshifted US symbol for the key position.
  else if (e.shiftKey && PUNCT_CODES[e.code]) key = PUNCT_CODES[e.code]!;
  return { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, key: normalizeKey(key) };
}

/** Pretty label for menus (Portuguese keyboard names). */
export function displayChord(s: string): string {
  return canonical(s)
    .replace('Space', 'Espaço')
    .replace('Plus', '+')
    .replace('Minus', '-')
    .replace('Delete', 'Del')
    .replace('Left', '←')
    .replace('Right', '→')
    .replace('Up', '↑')
    .replace('Down', '↓');
}

/** Returns groups of command ids that share the same shortcut. */
export function findConflicts(bindings: Record<string, string[]>): string[][] {
  const by = new Map<string, string[]>();
  for (const [id, keys] of Object.entries(bindings)) {
    for (const k of keys) {
      const c = canonical(k);
      if (!c) continue;
      by.set(c, [...(by.get(c) ?? []), id]);
    }
  }
  return [...by.values()].filter((ids) => ids.length > 1);
}

/** Shortcuts reserved by desktop environments that should not be bound. */
export const RESERVED = new Set(['Alt+F4', 'Alt+Tab', 'Ctrl+Alt+Delete', 'Ctrl+Alt+T', 'Ctrl+Alt+L', 'Ctrl+Q']);
