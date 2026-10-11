import { useEffect, useMemo, useState } from 'react';
import { playbackOrder } from '../../animation/playback';
import { exportGif, exportSequence, exportSpritesheet, framesInRange, rangeOptions } from '../../import-export/animation-export';
import { MAX_EXPORT_DIMENSION } from '../../import-export/export-image';
import { sheetFits, sheetGeometry, type SheetLayout } from '../../import-export/spritesheet';
import { parseHex, rgba } from '../../raster/color';
import { api } from '../../renderer/api';
import { GENERATOR } from '../../renderer/actions/documents';
import { useEditor } from '../../renderer/state/editor-store';
import { Button, Checkbox, NumberField, Select } from '../controls';
import { Dialog } from './Dialog';

export type AnimationExportKind = 'gif' | 'sequence' | 'spritesheet';

const TITLES: Record<AnimationExportKind, string> = {
  gif: 'Exportar GIF animado',
  sequence: 'Exportar sequência de PNG',
  spritesheet: 'Exportar spritesheet',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type LoopChoice = 'forever' | 'once' | 'count';

export function AnimationExportDialog({ kind }: { kind: AnimationExportKind }) {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const st = session.state;
  const [range, setRange] = useState('all');
  const [scale, setScale] = useState(1);
  const [solid, setSolid] = useState(false);
  const [bg, setBg] = useState('#ffffff');
  const [loopChoice, setLoopChoice] = useState<LoopChoice>(st.animation.loop === 'once' ? 'once' : 'forever');
  const [loopCount, setLoopCount] = useState(2);
  const [threshold, setThreshold] = useState(128);
  const [layout, setLayout] = useState<SheetLayout>('horizontal');
  const [columns, setColumns] = useState(Math.ceil(Math.sqrt(st.frames.length)));
  const [padding, setPadding] = useState(0);
  const [margin, setMargin] = useState(0);
  const [withJson, setWithJson] = useState(true);
  const [measured, setMeasured] = useState<{ bytes: number; quantized: boolean; rounded: boolean; colors: number } | null>(null);

  const background = solid ? (parseHex(bg) ?? rgba(255, 255, 255)) : null;
  const frames = framesInRange(st, range);
  const w = st.width * scale;
  const h = st.height * scale;
  const tooBig = w > MAX_EXPORT_DIMENSION || h > MAX_EXPORT_DIMENSION;
  const geometry = kind === 'spritesheet' ? sheetGeometry(frames.length, st.width, st.height, { layout, columns, padding, margin, scale }) : null;
  const sheetTooBig = !!geometry && !sheetFits(geometry);
  const gifFrames = kind === 'gif' ? playbackOrder(frames.length, st.animation).length : frames.length;
  const loop = loopChoice === 'forever' ? 0 : loopChoice === 'once' ? null : Math.max(1, loopCount - 1);

  // For small animations, encode in the background to show the real GIF size.
  const small = w * h * frames.length <= 4_000_000;
  const gifKey = useMemo(() => JSON.stringify({ range, scale, bg: background, loop, threshold }), [range, scale, background, loop, threshold]);
  useEffect(() => {
    if (kind !== 'gif' || !small || tooBig) return setMeasured(null);
    const t = setTimeout(() => {
      try {
        const r = exportGif(st, session.lookup, { range, scale, background, loop, alphaThreshold: threshold });
        setMeasured({ bytes: r.bytes.length, quantized: r.quantized, rounded: r.delaysRounded, colors: r.colors });
      } catch {
        setMeasured(null);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gifKey, kind, small, tooBig]);

  const toast = useEditor.getState().toast;
  const setBusy = useEditor.getState().setBusy;
  const name = session.doc.name;

  const run = async (): Promise<void> => {
    try {
      if (kind === 'gif') {
        const path = await api.file.saveDialog({ kind: 'gif', defaultName: `${name}${scale > 1 ? `@${scale}x` : ''}.gif`, title: TITLES.gif, extensions: ['gif'], filterName: 'GIF animado' });
        if (!path) return;
        close();
        setBusy('Exportando GIF…');
        const r = exportGif(st, session.lookup, { range, scale, background, loop, alphaThreshold: threshold });
        await api.file.write(path, r.bytes);
        toast('success', `GIF exportado: ${r.frameCount} quadros, ${r.colors} cores, ${formatBytes(r.bytes.length)}.${r.quantized ? ' Cores reduzidas para caber em 256.' : ''}`, {
          label: 'Mostrar na pasta',
          run: () => void api.file.showInFolder(path),
        });
      } else if (kind === 'sequence') {
        const dir = await api.file.chooseDirectory('Pasta para os PNGs');
        if (!dir) return;
        close();
        setBusy('Exportando quadros…');
        const files = exportSequence(st, session.lookup, { range, scale, background, baseName: safeBase(name), generator: GENERATOR });
        for (const f of files) await api.file.writeInDirectory(dir, f.name, f.data);
        toast('success', `${files.length} PNGs exportados (${files[0]!.name} …).`, { label: 'Abrir pasta', run: () => void api.file.showInFolder(dir) });
      } else {
        const path = await api.file.saveDialog({ kind: 'image', defaultName: `${name}-sheet.png`, title: TITLES.spritesheet, extensions: ['png'], filterName: 'Imagem PNG' });
        if (!path) return;
        close();
        setBusy('Montando spritesheet…');
        const imageName = path.split(/[\\/]/).pop() ?? 'sheet.png';
        const r = exportSpritesheet(st, session.lookup, { layout, columns, padding, margin, scale, range, background, imageName, generator: GENERATOR, appVersion: __APP_VERSION__ });
        await api.file.write(path, r.png);
        if (withJson) await api.file.writeSibling(path, 'json', new TextEncoder().encode(r.json));
        toast('success', `Spritesheet ${r.width}×${r.height} exportada${withJson ? ' com JSON de metadados' : ''}.`, { label: 'Mostrar na pasta', run: () => void api.file.showInFolder(path) });
      }
    } catch (e) {
      toast('error', `Falha ao exportar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const disabled = tooBig || sheetTooBig || frames.length === 0;
  return (
    <Dialog
      title={TITLES[kind]}
      onClose={close}
      width={540}
      testId={`export-${kind}-dialog`}
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={run} disabled={disabled} data-testid="anim-export-confirm">
            Exportar…
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Select label="Quadros" value={range} options={rangeOptions(st)} onChange={setRange} />
        <div className="field">
          <span className="field-label">Escala</span>
          <div className="segmented" role="radiogroup" aria-label="Escala">
            {[1, 2, 3, 4, 8].map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scale === s} className={scale === s ? 'is-active' : ''} onClick={() => setScale(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
        <Checkbox label={kind === 'gif' ? 'Fundo sólido (recomendado para GIF com semitransparência)' : 'Fundo sólido'} checked={solid} onChange={setSolid} />
        {solid && (
          <label className="field">
            <span className="field-label">Cor de fundo</span>
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
          </label>
        )}
        {kind === 'gif' && (
          <>
            <Select<LoopChoice>
              label="Repetição"
              value={loopChoice}
              options={[
                { value: 'forever', label: 'Repetir para sempre' },
                { value: 'once', label: 'Tocar uma vez' },
                { value: 'count', label: 'Tocar N vezes' },
              ]}
              onChange={setLoopChoice}
            />
            {loopChoice === 'count' && <NumberField label="Vezes" value={loopCount} min={2} max={1000} onChange={setLoopCount} />}
            {!solid && (
              <NumberField
                label="Limite de transparência (alfa)"
                value={threshold}
                min={1}
                max={255}
                onChange={setThreshold}
              />
            )}
          </>
        )}
        {kind === 'spritesheet' && (
          <>
            <Select<SheetLayout>
              label="Disposição"
              value={layout}
              options={[
                { value: 'horizontal', label: 'Uma linha' },
                { value: 'vertical', label: 'Uma coluna' },
                { value: 'grid', label: 'Grade' },
              ]}
              onChange={setLayout}
            />
            {layout === 'grid' && <NumberField label="Colunas" value={columns} min={1} max={Math.max(1, frames.length)} onChange={setColumns} />}
            <div className="row">
              <NumberField label="Espaçamento" value={padding} min={0} max={64} onChange={setPadding} suffix="px" />
              <NumberField label="Margem" value={margin} min={0} max={64} onChange={setMargin} suffix="px" />
            </div>
            <Checkbox label="Salvar JSON de metadados ao lado (posições, durações, marcadores)" checked={withJson} onChange={setWithJson} />
          </>
        )}
      </div>
      <dl className="export-summary" aria-label="Resumo da exportação">
        {kind === 'spritesheet' && geometry ? (
          <>
            <dt>Imagem final</dt>
            <dd data-testid="anim-export-dims">
              {geometry.width}×{geometry.height} px ({geometry.columns}×{geometry.rows} células de {geometry.cellW}×{geometry.cellH})
            </dd>
          </>
        ) : (
          <>
            <dt>Dimensões</dt>
            <dd data-testid="anim-export-dims">
              {w}×{h} px
            </dd>
          </>
        )}
        <dt>Quadros</dt>
        <dd>
          {kind === 'gif' && gifFrames !== frames.length ? `${gifFrames} (vai e volta)` : frames.length}
          {kind === 'gif' && st.animation.direction === 'reverse' ? ', ordem reversa' : ''}
        </dd>
        {kind === 'gif' && (
          <>
            <dt>Tamanho</dt>
            <dd data-testid="gif-size">{measured ? `${formatBytes(measured.bytes)} (calculado)` : small ? 'calculando…' : 'grande demais para calcular antes'}</dd>
            {measured && (
              <>
                <dt>Cores</dt>
                <dd>
                  {measured.colors}
                  {measured.quantized ? ' (reduzidas: o GIF aceita no máximo 256)' : ''}
                </dd>
              </>
            )}
            <dt>Limitações do GIF</dt>
            <dd>
              Transparência só total ou nenhuma; durações em passos de 10 ms
              {measured?.rounded ? ' (algumas foram arredondadas)' : ''}.
            </dd>
          </>
        )}
        {kind === 'sequence' && (
          <>
            <dt>Arquivos</dt>
            <dd>
              {safeBase(name)}_{'0'.repeat(Math.max(3, String(frames.length).length) - 1)}1.png …
            </dd>
          </>
        )}
      </dl>
      {(tooBig || sheetTooBig) && (
        <p className="form-error" role="alert">
          O resultado excederia {MAX_EXPORT_DIMENSION} pixels. Reduza a escala{kind === 'spritesheet' ? ' ou use grade' : ''}.
        </p>
      )}
    </Dialog>
  );
}

function safeBase(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'quadro';
}
