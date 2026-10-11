import { useMemo, useState } from 'react';
import { exportPng } from '../../renderer/actions/export';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs } from '../../renderer/state/preferences';
import { MAX_EXPORT_DIMENSION } from '../../import-export/export-image';
import { parseHex, rgba } from '../../raster/color';
import { Button, Checkbox, NumberField, Select } from '../controls';
import { Dialog } from './Dialog';

const SCALES = [1, 2, 3, 4, 8];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ExportPngDialog() {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const prefs = usePrefs((s) => s.prefs);
  const [scale, setScale] = useState(prefs.defaultExportScale);
  const [solid, setSolid] = useState(false);
  const [bg, setBg] = useState('#ffffff');
  const [frameId, setFrameId] = useState(session.activeFrameId);
  const w = session.state.width * scale;
  const h = session.state.height * scale;
  const tooBig = w > MAX_EXPORT_DIMENSION || h > MAX_EXPORT_DIMENSION;
  // Rough estimate: PNG of pixel art compresses well, scaled copies even more.
  const estimate = useMemo(() => Math.round(w * h * 4 * (scale > 1 ? 0.02 : 0.15)) + 200, [w, h, scale]);
  const bgColor = parseHex(bg) ?? rgba(255, 255, 255);

  const run = async (): Promise<void> => {
    close();
    usePrefs.getState().set({ defaultExportScale: scale });
    await exportPng({ scale, background: solid ? bgColor : null, frameId });
  };

  return (
    <Dialog
      title="Exportar PNG"
      onClose={close}
      testId="export-png-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={run} disabled={tooBig} data-testid="export-confirm">
            Exportar…
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <span className="field-label">Escala</span>
          <div className="segmented" role="radiogroup" aria-label="Escala">
            {SCALES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scale === s} className={scale === s ? 'is-active' : ''} onClick={() => setScale(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
        <NumberField label="Escala personalizada" value={scale} min={1} max={64} onChange={setScale} suffix="×" />
        {session.state.frames.length > 1 && (
          <Select
            label="Quadro"
            value={frameId}
            options={session.state.frames.map((f, i) => ({ value: f.id, label: `Quadro ${i + 1}` }))}
            onChange={setFrameId}
          />
        )}
        <Checkbox label="Fundo sólido (sem transparência)" checked={solid} onChange={setSolid} />
        {solid && (
          <label className="field">
            <span className="field-label">Cor de fundo</span>
            <input type="color" value={bg.slice(0, 7)} onChange={(e) => setBg(e.target.value)} />
          </label>
        )}
      </div>
      <dl className="export-summary" aria-label="Resumo da exportação">
        <dt>Formato</dt>
        <dd>PNG RGBA de 8 bits{solid ? ' (opaco)' : ' com transparência'}</dd>
        <dt>Dimensões finais</dt>
        <dd data-testid="export-dims">
          {w}×{h} px
        </dd>
        <dt>Escala</dt>
        <dd>{scale}× vizinho mais próximo (pixels preservados)</dd>
        <dt>Tamanho estimado</dt>
        <dd>~{formatBytes(estimate)} (estimativa, não garantia)</dd>
        <dt>Camadas</dt>
        <dd>Visíveis e exportáveis; guias e onion skin não são exportados</dd>
      </dl>
      {tooBig && (
        <p className="form-error" role="alert">
          A imagem final excederia {MAX_EXPORT_DIMENSION} pixels. Reduza a escala.
        </p>
      )}
    </Dialog>
  );
}
