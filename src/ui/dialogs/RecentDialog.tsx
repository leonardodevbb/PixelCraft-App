import { useEffect, useState } from 'react';
import { openPath } from '../../renderer/actions/documents';
import { api } from '../../renderer/api';
import { useEditor } from '../../renderer/state/editor-store';
import type { RecentEntry } from '../../shared/ipc';
import { Button } from '../controls';
import { Icon } from '../Icon';
import { Dialog } from './Dialog';

/** Arquivo › Abrir recentes: the same list as the start screen. */
export function RecentDialog() {
  const close = useEditor((s) => s.closeDialog);
  const [recent, setRecent] = useState<RecentEntry[] | null>(null);
  const refresh = (): void => void api.recent.list().then(setRecent, () => setRecent([]));
  useEffect(refresh, []);
  return (
    <Dialog
      title="Abrir recentes"
      onClose={close}
      width={560}
      testId="recent-dialog"
      footer={
        <>
          <Button variant="ghost" disabled={!recent?.length} onClick={() => void api.recent.clear().then(refresh)}>
            Limpar lista
          </Button>
          <Button onClick={close}>Fechar</Button>
        </>
      }
    >
      {recent === null ? (
        <p className="muted">Carregando…</p>
      ) : recent.length === 0 ? (
        <p className="muted">Os projetos que você salvar ou abrir aparecem aqui.</p>
      ) : (
        <ul className="recent-list">
          {recent.map((r) => (
            <li key={r.path} className={r.exists ? '' : 'missing'}>
              <button
                type="button"
                className="recent-item"
                disabled={!r.exists}
                onClick={() => {
                  close();
                  void openPath(r.path);
                }}
              >
                <span className="recent-thumb checker">{r.thumbnail && <img src={r.thumbnail} alt="" className="pixelated" />}</span>
                <span className="recent-text">
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-path">{r.exists ? r.path : `Arquivo não encontrado: ${r.path}`}</span>
                </span>
              </button>
              <button type="button" className="icon-btn" aria-label={`Remover ${r.name} da lista`} onClick={() => void api.recent.remove(r.path).then(refresh)}>
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
