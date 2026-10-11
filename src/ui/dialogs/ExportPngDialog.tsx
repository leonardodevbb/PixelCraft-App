import { useEffect, useState } from 'react';
import { exportImage, renderExport } from '../../renderer/actions/export';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs } from '../../renderer/state/preferences';
import { MAX_EXPORT_DIMENSION } from '../../import-export/export-image';
import { IMAGE_FORMATS, type ImageFormat } from '../../import-export/browser-encode';
import { parseHex, rgba } from '../../raster/color';
import { Button, Checkbox, NumberField, Select, Slider } from '../controls';
import { Dialog } from './Dialog';

const SCALES = [1, 2, 3, 4, 8];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Single-frame image export (PNG, BMP, JPEG, WebP). */
export function ExportPngDialog() {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const prefs = usePrefs((s) => s.prefs);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [scale, setScale] = useState(prefs.defaultExportScale);
  const [solid, setSolid] = useState(false);
  const [bg, setBg] = useState('#ffffff');
  const [quality, setQuality] = useState(92);
  const [frameId, setFrameId] = useState(session.activeFrameId);
  const [size, setSize] = useState<number | null>(null);
  const fmt = IMAGE_FORMATS.find((f) => f.id === format)!;
  const w = session.state.width * scale;
  const h = session.state.height * scale;
  const tooBig = w > MAX_EXPORT_DIMENSION || h > MAX_EXPORT_DIMENSION;
  const needsBg = !fmt.alpha;
  const useBg = solid || needsBg;
  const bgColor = parseHex(bg) ?? rgba(255, 255, 255);
  const req = { format, scale, background: useBg ? bgColor : null, frameId, quality: quality / 100 };
  const small = w * h <= 4_000_000;

  // Encode in the background to show the real file size.
  const reqKey = JSON.stringify(req);
  useEffect(() => {
    setSize(null);
    if (tooBig || !small) return;
    let alive = true;
    const t = setTimeout(() => {
      void renderExport(req)
        .then((r) => alive && r && setSize(r.bytes.length))
        .catch(() => alive && setSize(null));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, tooBig, small]);

  const run = async (): Promise<void> => {
    close();
    usePrefs.getState().set({ defaultExportScale: scale });
    await exportImage(req);
  };

  return (
    <Dialog
      title="Exportar imagem"
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
        <Select<ImageFormat> label="Formato" value={format} options={IMAGE_FORMATS.map((f) => ({ value: f.id, label: f.label }))} onChange={setFormat} />
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
        {fmt.lossy && <Slider label="Qualidade" value={quality} min={10} max={100} onChange={setQuality} format={(v) => `${v}%`} />}
        {needsBg ? (
          <p className="dialog-note">{fmt.label} não tem transparência: áreas transparentes recebem a cor de fundo.</p>
        ) : (
          <Checkbox label="Fundo sólido (sem transparência)" checked={solid} onChange={setSolid} />
        )}
        {useBg && (
          <label className="field">
            <span className="field-label">Cor de fundo</span>
            <input type="color" value={bg.slice(0, 7)} onChange={(e) => setBg(e.target.value)} />
          </label>
        )}
      </div>
      <dl className="export-summary" aria-label="Resumo da exportação">
        <dt>Formato</dt>
        <dd>
          {fmt.label}
          {fmt.lossy ? ' com perda (os pixels podem mudar levemente)' : ' sem perda'}
          {useBg ? ', opaco' : ', com transparência'}
        </dd>
        <dt>Dimensões finais</dt>
        <dd data-testid="export-dims">
          {w}×{h} px
        </dd>
        <dt>Escala</dt>
        <dd>{scale}× vizinho mais próximo (pixels preservados)</dd>
        <dt>Tamanho do arquivo</dt>
        <dd data-testid="export-size">{size !== null ? `${formatBytes(size)} (calculado)` : small ? 'calculando…' : 'grande demais para calcular antes'}</dd>
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
