import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayChord } from '../../src/shortcuts/keys';

// docs/SHORTCUTS.md is generated from the command registry so it never drifts.
// Regenerate with: npm run docs:shortcuts
(globalThis as { window?: unknown }).window ??= {};
const { commands, registerCommands } = await import('../../src/renderer/commands');

const FILE = new URL('../../docs/SHORTCUTS.md', import.meta.url);

function render(): string {
  const byCat = new Map<string, string[]>();
  for (const c of commands.all()) {
    if (c.hidden) continue;
    const keys = (c.keys ?? []).map((k) => `<kbd>${displayChord(k).replace(/\|/g, '\\|')}</kbd>`).join(' ou ');
    const rows = byCat.get(c.category) ?? [];
    rows.push(`| ${c.label.replace(/\|/g, '\\|')} | ${keys || '—'} |`);
    byCat.set(c.category, rows);
  }
  const parts = [
    '# Atalhos de teclado',
    '',
    'Gerado a partir do registro de comandos (`npm run docs:shortcuts`). Todos podem ser alterados em',
    '**Ajuda › Atalhos de teclado** (F1); a paleta de comandos (Ctrl+K) encontra qualquer ação pelo nome.',
    '',
    'Gestos que não são comandos:',
    '',
    '* **Espaço**: toque para reproduzir a animação; segure e arraste para mover a vista.',
    '* **Botão do meio** arrastando: move a vista. **Roda do mouse**: zoom no ponto do cursor.',
    '* **Alt** com uma ferramenta de desenho: conta-gotas temporário.',
    '* **Botão direito**: desenha com a cor secundária.',
    '* **Shift** em linha, retângulo, elipse e degradê: trava ângulo ou proporção. **Alt** em formas: desenha a partir do centro.',
    '* Seleção: **Shift** adiciona, **Alt** subtrai, **Shift+Alt** intersecta.',
    '',
  ];
  for (const [cat, rows] of byCat) parts.push(`## ${cat}`, '', '| Ação | Atalho |', '|---|---|', ...rows, '');
  return parts.join('\n');
}

describe('docs/SHORTCUTS.md', () => {
  registerCommands();
  it('matches the command registry', () => {
    const text = render();
    if (process.env.UPDATE_DOCS === '1') writeFileSync(FILE, text);
    expect(existsSync(FILE) ? readFileSync(FILE, 'utf8') : '').toBe(text);
  });
});
