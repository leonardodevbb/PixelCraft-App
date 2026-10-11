import { useEffect, useMemo, useState } from 'react';
import { commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs } from '../../renderer/state/preferences';
import { canonical, chordFromEvent, displayChord, formatChord, RESERVED } from '../../shortcuts/keys';
import { Button } from '../controls';
import { Dialog } from './Dialog';

interface Pending {
  id: string;
  chord: string;
  conflict: string | null;
}

/** Searchable list of every command; shortcuts can be changed, removed and reset. */
export function ShortcutsDialog() {
  const close = useEditor((s) => s.closeDialog);
  const overrides = usePrefs((s) => s.prefs.shortcuts);
  const [q, setQ] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = (next: Record<string, string[]>): void => {
    usePrefs.getState().set({ shortcuts: next });
    commands.setOverrides(next);
  };
  const setKeys = (id: string, keys: string[]): void => {
    const next = { ...usePrefs.getState().prefs.shortcuts };
    const def = commands.get(id)?.keys ?? [];
    if (keys.length === def.length && keys.every((k, i) => canonical(k) === canonical(def[i]!))) delete next[id];
    else next[id] = keys;
    save(next);
  };
  const owner = (chord: string, except: string): string | null => {
    const c = canonical(chord);
    for (const cmd of commands.all()) if (cmd.id !== except && commands.keysFor(cmd.id).some((k) => canonical(k) === c)) return cmd.id;
    return null;
  };
  const apply = (p: Pending): void => {
    if (p.conflict) setKeys(p.conflict, commands.keysFor(p.conflict).filter((k) => canonical(k) !== canonical(p.chord)));
    setKeys(p.id, [p.chord, ...commands.keysFor(p.id).filter((k) => canonical(k) !== canonical(p.chord))].slice(0, 4));
    setPending(null);
    setMessage(`Atalho ${displayChord(p.chord)} definido para "${commands.get(p.id)?.label}".`);
  };

  // While recording, the next key press becomes the shortcut (Esc cancels).
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(null);
      const chord = chordFromEvent(e);
      if (!chord) return;
      const s = formatChord(chord);
      setRecording(null);
      if (RESERVED.has(s)) return setMessage(`${displayChord(s)} é reservado pelo sistema e não pode ser usado.`);
      if (!chord.ctrl && !chord.alt && ['Tab'].includes(chord.key)) return setMessage('Tab sozinho é usado para navegar pela interface.');
      const conflict = owner(s, recording);
      const p = { id: recording, chord: s, conflict };
      if (conflict) setPending(p);
      else apply(p);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = commands
      .all()
      .filter((c) => !c.hidden)
      .filter((c) => !term || c.label.toLowerCase().includes(term) || c.category.toLowerCase().includes(term) || commands.keysFor(c.id).some((k) => displayChord(k).toLowerCase().includes(term)));
    const by = new Map<string, typeof all>();
    for (const c of all) by.set(c.category, [...(by.get(c.category) ?? []), c]);
    return [...by.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, overrides]);
  const customized = Object.keys(overrides).length;

  return (
    <Dialog
      title="Atalhos de teclado"
      onClose={() => (recording ? setRecording(null) : close())}
      width={680}
      testId="shortcuts-dialog"
      footer={
        <>
          <Button
            variant="ghost"
            disabled={customized === 0}
            onClick={() => {
              save({});
              setMessage('Todos os atalhos voltaram ao padrão.');
            }}
          >
            Restaurar padrões{customized ? ` (${customized})` : ''}
          </Button>
          <Button onClick={close}>Fechar</Button>
        </>
      }
    >
      <input className="search" placeholder="Buscar ação ou tecla…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar atalhos" autoFocus />
      {message && (
        <p className="dialog-note" role="status">
          {message}
        </p>
      )}
      {pending && (
        <div className="conflict-box" role="alert">
          <span>
            {displayChord(pending.chord)} já é usado por "{commands.get(pending.conflict!)?.label}". Passar para "{commands.get(pending.id)?.label}"?
          </span>
          <Button variant="primary" onClick={() => apply(pending)} data-testid="shortcut-replace">
            Substituir
          </Button>
          <Button onClick={() => setPending(null)}>Cancelar</Button>
        </div>
      )}
      <div className="shortcut-list">
        {groups.map(([cat, cmds]) => (
          <section key={cat}>
            <h3>{cat}</h3>
            <table>
              <tbody>
                {cmds.map((c) => {
                  const keys = commands.keysFor(c.id);
                  const custom = c.id in overrides;
                  return (
                    <tr key={c.id} data-testid={`shortcut-${c.id}`}>
                      <td>
                        {c.label}
                        {custom && <span className="layer-badge">alterado</span>}
                      </td>
                      <td className="keys">
                        {keys.map((k) => (
                          <kbd key={k}>
                            {displayChord(k)}
                            <button type="button" className="kbd-remove" aria-label={`Remover ${displayChord(k)}`} onClick={() => setKeys(c.id, keys.filter((x) => x !== k))}>
                              ×
                            </button>
                          </kbd>
                        ))}
                        <button
                          type="button"
                          className={`link-btn${recording === c.id ? ' is-recording' : ''}`}
                          onClick={() => {
                            setMessage(null);
                            setRecording(c.id);
                          }}
                          data-testid="shortcut-record"
                        >
                          {recording === c.id ? 'Pressione as teclas… (Esc cancela)' : '+ atalho'}
                        </button>
                        {custom && (
                          <button type="button" className="link-btn" onClick={() => setKeys(c.id, c.keys ?? [])}>
                            padrão
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
        {groups.length === 0 && <p className="muted">Nenhuma ação encontrada.</p>}
      </div>
      <p className="muted small">
        Dicas: toque em <kbd>Espaço</kbd> para reproduzir; segure e arraste para mover a vista. Segure <kbd>Alt</kbd> para usar o conta-gotas. A roda do mouse aplica zoom no ponto do cursor.
      </p>
    </Dialog>
  );
}
