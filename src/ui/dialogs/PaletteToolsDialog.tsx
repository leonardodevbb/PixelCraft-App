import { useMemo, useState } from 'react';
import { applyPalette, reduceColors, setPalette, usedColors } from '../../editor/palette-ops';
import { composeFrame } from '../../layers/compose';
import { duplicateIndices, medianCut, nearestColor, outOfPalette } from '../../palette/analysis';
import { LIMITS } from '../../project/limits';
import { toCss, toHex, withAlpha, type RGBA } from '../../raster/color';
import { attempt } from '../../renderer/actions/edit';
import { useEditor } from '../../renderer/state/editor-store';
import { BufferView } from '../canvas/BufferView';
import { Button, Slider } from '../controls';
import { Dialog } from './Dialog';

function Chips({ colors, counts }: { colors: RGBA[]; counts?: Map<RGBA, number> }) {
  return (
    <div className="chip-grid">
      {colors.map((c) => (
        <span key={c} className="color-chip" data-tip={toHex(c)} data-tip-hint={counts ? `${counts.get(c) ?? 0} pixel(s)` : undefined}>
          <span style={{ background: toCss(c) }} />
        </span>
      ))}
    </div>
  );
}

export function PaletteToolsDialog() {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const revision = useEditor((s) => s.revision);
  const [tab, setTab] = useState<'analysis' | 'reduce'>('analysis');
  const [target, setTarget] = useState(16);
  const palette = session.state.palette;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const counts = useMemo(() => usedColors(session), [session, revision]);
  const opaque = useMemo(() => [...new Set([...counts.keys()].map((c) => withAlpha(c, 255)))], [counts]);
  const sorted = useMemo(() => [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c), [counts]);
  const outside = useMemo(() => outOfPalette(opaque, palette.colors), [opaque, palette]);
  const dups = duplicateIndices(palette.colors);
  const reduced = useMemo(() => (tab === 'reduce' ? medianCut(counts, target) : []), [tab, counts, target]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const before = useMemo(() => (tab === 'reduce' ? composeFrame(session.state, session.lookup, session.activeFrameId) : null), [tab, session, revision]);
  const preview = useMemo(() => {
    if (!before) return null;
    const img = before.clone();
    const cache = new Map<RGBA, RGBA>();
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const c = img.get(x, y);
        let n = cache.get(c);
        if (n === undefined) cache.set(c, (n = nearestColor(c, reduced)));
        img.set(x, y, n);
      }
    return img;
  }, [before, reduced]);

  return (
    <Dialog title="Ferramentas de paleta" onClose={close} width={560} testId="palette-tools-dialog" footer={<Button onClick={close}>Fechar</Button>}>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'analysis'} className={tab === 'analysis' ? 'is-active' : ''} onClick={() => setTab('analysis')}>
          Análise
        </button>
        <button type="button" role="tab" aria-selected={tab === 'reduce'} className={tab === 'reduce' ? 'is-active' : ''} onClick={() => setTab('reduce')}>
          Reduzir cores
        </button>
      </div>
      {tab === 'analysis' ? (
        <div className="form-grid">
          <p data-testid="color-count">
            O documento usa <strong>{counts.size}</strong> cor{counts.size === 1 ? '' : 'es'} ({opaque.length} sem contar transparência parcial), em todas as camadas e quadros.
          </p>
          {sorted.length > 0 && <Chips colors={sorted.slice(0, 128)} counts={counts} />}
          {sorted.length > 128 && <p className="muted">Mostrando as 128 mais usadas.</p>}
          <h3 className="mini-title">Fora da paleta "{palette.name}"</h3>
          {outside.length === 0 ? (
            <p className="muted">Todas as cores usadas estão na paleta.</p>
          ) : (
            <>
              <p data-testid="out-of-palette">{outside.length} cor(es) usadas não estão na paleta.</p>
              <Chips colors={outside.slice(0, 128)} />
              <div className="row">
                <Button
                  onClick={() => {
                    const colors = [...palette.colors, ...outside].slice(0, LIMITS.maxPaletteColors);
                    attempt((s) => setPalette(s, { ...palette, colors }, 'Adicionar cores usadas à paleta'));
                  }}
                >
                  Adicionar à paleta
                </Button>
                <Button onClick={() => attempt((s) => applyPalette(s, palette.colors, 'all', 'Ajustar pixels à paleta'))} disabled={palette.colors.length === 0}>
                  Ajustar pixels à paleta
                </Button>
              </div>
            </>
          )}
          <h3 className="mini-title">Duplicadas</h3>
          {dups.length === 0 ? (
            <p className="muted">Nenhuma cor repetida na paleta.</p>
          ) : (
            <div className="row">
              <span>{dups.length} cor(es) repetida(s).</span>
              <Button onClick={() => attempt((s) => setPalette(s, { ...palette, colors: palette.colors.filter((_, i) => !dups.includes(i)) }, 'Remover cores duplicadas'))}>
                Remover duplicadas
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="form-grid">
          <p className="dialog-note">
            Reduz todas as camadas e quadros para no máximo N cores (corte pela mediana) e troca a paleta do documento pelo resultado. Pode ser desfeito com Ctrl+Z.
          </p>
          <Slider label="Cores" value={target} min={2} max={256} onChange={setTarget} />
          <Chips colors={reduced} />
          <div className="row align-start">
            <div className="field">
              <span className="field-label">Antes</span>
              <BufferView buffer={before} label="Antes" />
            </div>
            <div className="field">
              <span className="field-label">Depois (quadro atual)</span>
              <BufferView buffer={preview} label="Depois" />
            </div>
          </div>
          <div className="row">
            <Button
              variant="primary"
              disabled={counts.size === 0}
              onClick={() => {
                const r = attempt((s) => reduceColors(s, target));
                if (r) useEditor.getState().toast('success', `Documento reduzido para ${r.length} cores.`);
              }}
              data-testid="reduce-apply"
            >
              Reduzir para {Math.min(target, opaque.length || target)} cores
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
