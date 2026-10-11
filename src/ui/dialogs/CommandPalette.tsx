import { useMemo, useRef, useState } from 'react';
import { commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { displayChord } from '../../shortcuts/keys';
import { fuzzyScore } from '../../shortcuts/fuzzy';


export function CommandPalette() {
  const close = useEditor((s) => s.closeDialog);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useMemo(() => {
    return commands
      .all()
      .filter((c) => !c.hidden && c.id !== 'help.commandPalette')
      .map((c) => ({ c, score: Math.max(fuzzyScore(c.label, q), fuzzyScore(`${c.category} ${c.label}`, q) * 0.8) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.c.label.localeCompare(b.c.label))
      .slice(0, 60)
      .map((x) => x.c);
  }, [q]);
  const run = (i: number): void => {
    const c = items[i];
    if (!c || !commands.isEnabled(c.id)) return;
    close();
    // Let the palette unmount before the command opens its own dialog.
    setTimeout(() => commands.execute(c.id), 0);
  };
  const move = (d: number): void => {
    const n = Math.max(0, Math.min(items.length - 1, sel + d));
    setSel(n);
    listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <div className="dialog-backdrop palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos" data-testid="command-palette">
        <input
          autoFocus
          className="search"
          placeholder="Digite uma ação… (ex.: girar, nova camada, exportar gif)"
          value={q}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={items[sel] ? `cmd-${items[sel]!.id}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              move(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              move(-1);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(sel);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
          data-testid="command-input"
        />
        <ul id="command-results" role="listbox" ref={listRef} className="command-results">
          {items.map((c, i) => {
            const enabled = commands.isEnabled(c.id);
            const key = commands.keysFor(c.id)[0];
            return (
              <li
                key={c.id}
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={i === sel}
                aria-disabled={!enabled}
                className={`command-item${i === sel ? ' is-selected' : ''}${enabled ? '' : ' is-disabled'}`}
                onPointerEnter={() => setSel(i)}
                onClick={() => run(i)}
              >
                <span className="command-cat">{c.category}</span>
                <span className="command-label">{c.label}</span>
                {key && <kbd>{displayChord(key)}</kbd>}
              </li>
            );
          })}
          {items.length === 0 && <li className="muted command-empty">Nenhuma ação encontrada.</li>}
        </ul>
      </div>
    </div>
  );
}
