import { useEditor } from '../../renderer/state/editor-store';
import { alpha, toCss, toHex } from '../../raster/color';

export function StatusBar() {
  const hover = useEditor((s) => s.hover);
  const session = useEditor((s) => s.session);
  const zoom = useEditor((s) => s.transform.zoom);
  const busy = useEditor((s) => s.busy);
  useEditor((s) => s.revision);
  const inside = hover && session && hover.x >= 0 && hover.y >= 0 && hover.x < session.state.width && hover.y < session.state.height;
  const frameIndex = session ? session.state.frames.findIndex((f) => f.id === session.activeFrameId) : -1;
  return (
    <footer className="statusbar" aria-label="Barra de status">
      {session ? (
        <>
          <span data-testid="status-pos">{inside ? `X ${hover!.x}  Y ${hover!.y}` : 'X –  Y –'}</span>
          <span className="status-color">
            {inside && hover!.color !== null ? (
              <>
                <span className="mini-swatch" style={{ background: toCss(hover!.color) }} />
                {alpha(hover!.color) === 0 ? 'transparente' : toHex(hover!.color)}
              </>
            ) : (
              '—'
            )}
          </span>
          <span>
            {session.state.width}×{session.state.height} px
          </span>
          {session.state.colorMode === 'indexed' && (
            <span data-testid="status-indexed" title="Modo indexado: só as cores da paleta são usadas">
              Indexado · {session.state.palette.colors.length} cores
            </span>
          )}
          <span>Zoom {Math.round(zoom * 100)}%</span>
          <span>
            Quadro {frameIndex + 1}/{session.state.frames.length}
          </span>
          <span className="status-path" title={session.filePath ?? ''}>
            {session.filePath ?? 'Não salvo'}
          </span>
        </>
      ) : (
        <span>Pronto</span>
      )}
      {busy && (
        <span className="status-busy" role="status">
          {busy}
        </span>
      )}
    </footer>
  );
}
