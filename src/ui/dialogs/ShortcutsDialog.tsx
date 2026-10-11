import { useMemo, useState } from 'react';
import { commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { displayChord } from '../../shortcuts/keys';
import { Button } from '../controls';
import { Dialog } from './Dialog';

/** Searchable list of every command and its shortcut. */
export function ShortcutsDialog() {
  const close = useEditor((s) => s.closeDialog);
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = commands
      .all()
      .filter((c) => !c.hidden)
      .filter((c) => !term || c.label.toLowerCase().includes(term) || c.category.toLowerCase().includes(term) || commands.keysFor(c.id).some((k) => k.toLowerCase().includes(term)));
    const by = new Map<string, typeof all>();
    for (const c of all) by.set(c.category, [...(by.get(c.category) ?? []), c]);
    return [...by.entries()];
  }, [q]);
  return (
    <Dialog title="Atalhos de teclado" onClose={close} width={620} testId="shortcuts-dialog" footer={<Button onClick={close}>Fechar</Button>}>
      <input className="search" placeholder="Buscar ação ou tecla…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar atalhos" autoFocus />
      <div className="shortcut-list">
        {groups.map(([cat, cmds]) => (
          <section key={cat}>
            <h3>{cat}</h3>
            <table>
              <tbody>
                {cmds.map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td className="keys">
                      {commands.keysFor(c.id).map((k) => (
                        <kbd key={k}>{displayChord(k)}</kbd>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {groups.length === 0 && <p className="muted">Nenhuma ação encontrada.</p>}
      </div>
      <p className="muted small">
        Dicas: segure <kbd>Espaço</kbd> e arraste para mover a vista; segure <kbd>Alt</kbd> para usar o conta-gotas; botão do meio também move a vista; a roda do mouse aplica zoom no ponto do cursor.
      </p>
    </Dialog>
  );
}
