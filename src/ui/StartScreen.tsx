import { useEffect, useState } from 'react';
import { api } from '../renderer/api';
import { openPath, openProjectDialog, newProject, restoreRecovery } from '../renderer/actions/documents';
import { useEditor } from '../renderer/state/editor-store';
import type { AppInfo, RecentEntry, RecoveryEntry } from '../shared/ipc';
import { Button } from './controls';
import { Icon } from './Icon';
import { BUILTIN_PRESETS } from './dialogs/presets';

const QUICK = ['Ícone grande', 'Personagem 32', 'Tile 16×16', 'Tela 16:9'];

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function StartScreen() {
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const openDialog = useEditor((s) => s.openDialog);

  const refresh = (): void => {
    void api.recent.list().then(setRecent).catch(() => setRecent([]));
    void api.recovery.list().then(setRecovery).catch(() => setRecovery([]));
  };
  useEffect(() => {
    refresh();
    void api.app.info().then(setInfo);
  }, []);

  return (
    <main className="start" data-testid="start-screen">
      <div className="start-inner">
        <header className="start-hero">
          <img className="start-logo logo-on-dark" src="./logo-on-dark.svg" alt="PixelCraft" />
          <img className="start-logo logo-on-light" src="./logo-on-light.svg" alt="PixelCraft" />
          <p className="tagline">Pixel art, sprites e animação quadro a quadro.</p>
        </header>
        <div className="start-actions">
          <Button variant="primary" onClick={() => openDialog({ type: 'new-project' })} data-testid="start-new">
            <Icon name="new" /> Novo projeto
          </Button>
          <Button onClick={() => void openProjectDialog()} data-testid="start-open">
            <Icon name="folder" /> Abrir…
          </Button>
        </div>
        <section className="start-section">
          <h2>Começar rápido</h2>
          <div className="quick-presets">
            {BUILTIN_PRESETS.filter((p) => QUICK.includes(p.name)).map((p) => (
              <button
                key={p.name}
                type="button"
                className="quick-preset"
                onClick={() => void newProject({ name: 'Sem título', width: p.width, height: p.height })}
                data-testid={`quick-${p.width}x${p.height}`}
              >
                <span className="qp-box" style={{ aspectRatio: `${p.width} / ${p.height}` }} />
                <span>{p.name}</span>
                <small>
                  {p.width}×{p.height}
                </small>
              </button>
            ))}
          </div>
        </section>
        {recovery.length > 0 && (
          <section className="start-section recovery" aria-label="Recuperação">
            <h2>Recuperar trabalho não salvo</h2>
            <ul className="recent-list">
              {recovery.map((r) => (
                <li key={r.id}>
                  <button type="button" className="recent-item" onClick={() => void restoreRecovery(r.id, r.originalPath)}>
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-path">Salvo automaticamente em {when(r.savedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Descartar recuperação de ${r.name}`}
                    data-tip="Descartar esta cópia"
                    onClick={() => void api.recovery.remove(r.id).then(refresh)}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="start-section">
          <div className="section-head">
            <h2>Recentes</h2>
            {recent.length > 0 && (
              <button type="button" className="link" onClick={() => void api.recent.clear().then(refresh)}>
                Limpar lista
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="muted empty">Os projetos que você salvar ou abrir aparecem aqui.</p>
          ) : (
            <ul className="recent-list" data-testid="recent-list">
              {recent.map((r) => (
                <li key={r.path} className={r.exists ? '' : 'missing'}>
                  <button type="button" className="recent-item" disabled={!r.exists} onClick={() => void openPath(r.path)}>
                    <span className="recent-thumb checker">{r.thumbnail && <img src={r.thumbnail} alt="" className="pixelated" />}</span>
                    <span className="recent-text">
                      <span className="recent-name">{r.name}</span>
                      <span className="recent-path">{r.exists ? r.path : `Arquivo não encontrado: ${r.path}`}</span>
                    </span>
                    <span className="recent-date">{when(r.openedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remover ${r.name} da lista`}
                    data-tip="Remover da lista"
                    onClick={() => void api.recent.remove(r.path).then(refresh)}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <footer className="start-footer">
          <button type="button" className="link" onClick={() => openDialog({ type: 'shortcuts' })}>
            Atalhos de teclado
          </button>
          <button type="button" className="link" onClick={() => openDialog({ type: 'about' })}>
            Sobre
          </button>
          <span className="muted">Versão {info?.version ?? '…'}</span>
        </footer>
      </div>
    </main>
  );
}
