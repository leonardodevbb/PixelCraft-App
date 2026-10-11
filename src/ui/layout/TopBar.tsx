import { commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { ZOOM_LEVELS } from '../../renderer-engine/viewport';
import { zoomTo } from '../../renderer/actions/view';
import { IconButton } from '../controls';
import { MenuBar } from './MenuBar';
import { buildMenus } from './menus';

function zoomLabel(z: number): string {
  return `${Math.round(z * 100)}%`;
}

export function TopBar() {
  const session = useEditor((s) => s.session);
  useEditor((s) => s.revision);
  const zoom = useEditor((s) => s.transform.zoom);
  const dirty = session?.isDirty ?? false;
  const k = (id: string) => commands.keysFor(id)[0];

  return (
    <header className="topbar">
      <div className="brand" aria-label="PixelCraft">
        <img src="./symbol.svg" alt="" width={22} height={22} />
      </div>
      <MenuBar menus={buildMenus()} />
      <div className="doc-title" data-testid="doc-title">
        {session ? (
          <>
            <span className="doc-name">{session.doc.name}</span>
            {dirty && (
              <span className="dirty-dot" role="status" aria-label="Alterações não salvas" data-tip="Alterações não salvas">
                ●
              </span>
            )}
            <span className="doc-dims">
              {session.state.width}×{session.state.height}
            </span>
          </>
        ) : (
          <span className="doc-name muted">Nenhum projeto aberto</span>
        )}
      </div>
      <div className="topbar-actions">
        <IconButton
          icon="undo"
          label={session?.history.undoLabel ? `Desfazer: ${session.history.undoLabel}` : 'Desfazer'}
          shortcut={k('edit.undo')}
          disabled={!session?.history.canUndo}
          onClick={() => commands.execute('edit.undo')}
          data-testid="undo"
        />
        <IconButton
          icon="redo"
          label={session?.history.redoLabel ? `Refazer: ${session.history.redoLabel}` : 'Refazer'}
          shortcut={k('edit.redo')}
          disabled={!session?.history.canRedo}
          onClick={() => commands.execute('edit.redo')}
          data-testid="redo"
        />
        <span className="divider" />
        <IconButton icon="zoom-out" label="Diminuir zoom" shortcut={k('view.zoomOut')} disabled={!session} onClick={() => commands.execute('view.zoomOut')} />
        <select
          className="zoom-select"
          aria-label="Nível de zoom"
          value={String(zoom)}
          disabled={!session}
          onChange={(e) => zoomTo(Number(e.target.value))}
          data-testid="zoom-select"
        >
          {!ZOOM_LEVELS.includes(zoom) && <option value={String(zoom)}>{zoomLabel(zoom)}</option>}
          {ZOOM_LEVELS.map((z) => (
            <option key={z} value={String(z)}>
              {zoomLabel(z)}
            </option>
          ))}
        </select>
        <IconButton icon="zoom-in" label="Aumentar zoom" shortcut={k('view.zoomIn')} disabled={!session} onClick={() => commands.execute('view.zoomIn')} />
        <IconButton icon="fit" label="Ajustar à tela" shortcut={k('view.fit')} disabled={!session} onClick={() => commands.execute('view.fit')} />
        <IconButton icon="grid" label="Grade de pixels" shortcut={k('view.pixelGrid')} active={commands.get('view.pixelGrid')?.checked?.()} onClick={() => commands.execute('view.pixelGrid')} />
        <IconButton icon="fullscreen" label="Tela cheia" shortcut={k('view.fullscreen')} onClick={() => commands.execute('view.fullscreen')} />
      </div>
    </header>
  );
}
