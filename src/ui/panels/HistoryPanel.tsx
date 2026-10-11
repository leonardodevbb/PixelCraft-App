import { useEffect, useRef } from 'react';
import { useEditor } from '../../renderer/state/editor-store';
import { Section } from '../controls';

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Undo history; clicking an entry undoes/redoes up to that point. */
export function HistoryPanel() {
  const session = useEditor((s) => s.session);
  useEditor((s) => s.revision);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' });
  });
  if (!session) return null;
  const h = session.history;
  const done = h.entries;
  const undone = [...h.redoEntries].reverse();
  const goTo = (doneCount: number): void => {
    while (h.entries.length > doneCount && session.undo());
    while (h.entries.length < doneCount && session.redo());
  };
  return (
    <Section title="Histórico">
      <ol className="history-list" ref={listRef} aria-label="Histórico de ações" data-testid="history-list">
        <li>
          <button type="button" className={`history-item${done.length === 0 ? ' is-current' : ''}`} onClick={() => goTo(0)}>
            Estado inicial
          </button>
        </li>
        {done.map((e, i) => (
          <li key={`d${i}`}>
            <button type="button" className={`history-item${i === done.length - 1 ? ' is-current' : ''}`} onClick={() => goTo(i + 1)} aria-current={i === done.length - 1 ? 'step' : undefined}>
              {e.label}
            </button>
          </li>
        ))}
        {undone.map((e, i) => (
          <li key={`u${i}`}>
            <button type="button" className="history-item is-undone" onClick={() => goTo(done.length + i + 1)}>
              {e.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="muted history-usage">
        {done.length + undone.length} de no máximo {h.options.maxEntries} passos · {formatBytes(h.usedBytes)} de {formatBytes(h.options.maxBytes)}
      </p>
    </Section>
  );
}
