import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeImage } from '../../import-export/browser-decode';
import { guessCellSize, sliceRects, sliceSheet, type SliceOptions } from '../../import-export/slice';
import { documentFromFrames } from '../../project/create';
import { LIMITS } from '../../project/limits';
import { makeFrame, celKey } from '../../project/model';
import type { PixelBuffer } from '../../raster/pixel-buffer';
import { activate, discardRecovery, confirmDiscard } from '../../renderer/actions/documents';
import { attempt } from '../../renderer/actions/edit';
import { useEditor } from '../../renderer/state/editor-store';
import { Button, Checkbox, NumberField } from '../controls';
import { Dialog } from './Dialog';

function SlicePreview({ image, opts }: { image: PixelBuffer; opts: SliceOptions }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const max = 420;
  const k = Math.min(max / image.width, 300 / image.height);
  const scale = k >= 1 ? Math.floor(k) : k;
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    const tmp = new OffscreenCanvas(image.width, image.height);
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    g.clearRect(0, 0, w, h);
    g.drawImage(tmp, 0, 0, w, h);
    const rects = sliceRects(image.width, image.height, opts);
    g.lineWidth = 1;
    rects.forEach((r, i) => {
      const empty = opts.skipEmpty && image.extract(r).isEmpty();
      g.strokeStyle = empty ? 'rgba(255,90,106,0.9)' : 'rgba(46,196,182,0.95)';
      g.strokeRect(Math.round(r.x * scale) + 0.5, Math.round(r.y * scale) + 0.5, Math.round(r.w * scale) - 1, Math.round(r.h * scale) - 1);
      if (r.w * scale >= 18) {
        g.fillStyle = empty ? 'rgba(255,90,106,0.9)' : 'rgba(46,196,182,0.95)';
        g.font = '10px sans-serif';
        g.fillText(String(i + 1), r.x * scale + 3, r.y * scale + 11);
      }
    });
  }, [image, opts, w, h, scale]);
  return (
    <div className="checker slice-preview" style={{ width: w, height: h }}>
      <canvas ref={ref} style={{ width: w, height: h }} aria-label="Pré-visualização do recorte" />
    </div>
  );
}

export function ImportSpritesheetDialog({ file }: { file?: { name: string; data: Uint8Array } }) {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session);
  const [image, setImage] = useState<PixelBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [o, setO] = useState<SliceOptions>({ frameWidth: 16, frameHeight: 16, offsetX: 0, offsetY: 0, gapX: 0, gapY: 0, columns: 0, rows: 0, skipEmpty: true });
  const [duration, setDuration] = useState(100);
  useEffect(() => {
    if (!file) return;
    decodeImage(file.data, LIMITS.maxPixels)
      .then((img) => {
        setImage(img);
        const g = guessCellSize(img.width, img.height);
        setO((p) => ({ ...p, frameWidth: g.w, frameHeight: g.h }));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [file]);
  const set = (p: Partial<SliceOptions>): void => setO((cur) => ({ ...cur, ...p }));
  const frames = useMemo(() => (image ? sliceSheet(image, o) : []), [image, o]);
  const total = image ? sliceRects(image.width, image.height, o).length : 0;
  const tooMany = frames.length > LIMITS.maxFrames;
  const sameSize = !!session && session.state.width === o.frameWidth && session.state.height === o.frameHeight;
  const name = (file?.name ?? 'spritesheet').replace(/\.[^.]+$/, '');

  const asNew = async (): Promise<void> => {
    if (!(await confirmDiscard('importar a spritesheet'))) return;
    const doc = documentFromFrames(name, frames.map((image) => ({ image, duration })));
    const prev = useEditor.getState().session;
    if (prev) await discardRecovery(prev);
    close();
    activate(doc, null, { dirty: true });
    useEditor.getState().toast('success', `Spritesheet importada: ${frames.length} quadros de ${o.frameWidth}×${o.frameHeight}.`);
  };
  const append = (): void => {
    close();
    attempt((s) => {
      const st = s.state;
      const layerId = s.activeLayerId;
      const newFrames = frames.map(() => makeFrame(duration));
      const cels = { ...st.cels };
      const ids: string[] = [];
      frames.forEach((img, i) => {
        if (img.isEmpty()) return;
        const id = s.addImage(img);
        ids.push(id);
        cels[celKey(layerId, newFrames[i]!.id)] = id;
      });
      if (st.frames.length + newFrames.length > LIMITS.maxFrames) throw new RangeError(`Limite de ${LIMITS.maxFrames} quadros.`);
      s.commit('Importar quadros da spritesheet', { ...st, frames: [...st.frames, ...newFrames], cels }, [], ids, { ...s.context, frameId: newFrames[0]!.id });
    });
  };

  return (
    <Dialog
      title="Importar spritesheet"
      onClose={close}
      width={720}
      testId="import-spritesheet-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          {session && (
            <Button onClick={append} disabled={!sameSize || frames.length === 0 || tooMany} title={sameSize ? undefined : 'O tamanho da célula precisa ser igual ao do documento.'}>
              Adicionar como quadros
            </Button>
          )}
          <Button variant="primary" onClick={() => void asNew()} disabled={frames.length === 0 || tooMany} data-testid="slice-import">
            Abrir como novo projeto
          </Button>
        </>
      }
    >
      {error && <p className="form-error">{error}</p>}
      {!image && !error && <p className="muted">Lendo imagem…</p>}
      {image && (
        <div className="row align-start">
          <div className="form-grid" style={{ width: 240 }}>
            <p className="dialog-note">
              {file?.name}: {image.width}×{image.height} px
            </p>
            <div className="row">
              <NumberField label="Largura da célula" value={o.frameWidth} min={1} max={Math.min(LIMITS.maxDimension, image.width)} onChange={(frameWidth) => set({ frameWidth })} data-testid="slice-w" />
              <NumberField label="Altura da célula" value={o.frameHeight} min={1} max={Math.min(LIMITS.maxDimension, image.height)} onChange={(frameHeight) => set({ frameHeight })} data-testid="slice-h" />
            </div>
            <div className="row">
              <NumberField label="Deslocamento X" value={o.offsetX} min={0} max={image.width - 1} onChange={(offsetX) => set({ offsetX })} />
              <NumberField label="Deslocamento Y" value={o.offsetY} min={0} max={image.height - 1} onChange={(offsetY) => set({ offsetY })} />
            </div>
            <div className="row">
              <NumberField label="Espaço X" value={o.gapX} min={0} max={image.width} onChange={(gapX) => set({ gapX })} />
              <NumberField label="Espaço Y" value={o.gapY} min={0} max={image.height} onChange={(gapY) => set({ gapY })} />
            </div>
            <div className="row">
              <NumberField label="Colunas (0 = todas)" value={o.columns} min={0} max={1000} onChange={(columns) => set({ columns })} />
              <NumberField label="Linhas (0 = todas)" value={o.rows} min={0} max={1000} onChange={(rows) => set({ rows })} />
            </div>
            <Checkbox label="Ignorar células vazias" checked={o.skipEmpty} onChange={(skipEmpty) => set({ skipEmpty })} />
            <NumberField label="Duração de cada quadro" value={duration} min={LIMITS.minFrameDuration} max={LIMITS.maxFrameDuration} onChange={setDuration} suffix="ms" />
            <p data-testid="slice-count">
              {frames.length} quadro(s){o.skipEmpty && total !== frames.length ? ` (${total - frames.length} vazio(s) ignorado(s))` : ''}
            </p>
            {tooMany && <p className="form-error">Mais de {LIMITS.maxFrames} quadros.</p>}
          </div>
          <SlicePreview image={image} opts={o} />
        </div>
      )}
    </Dialog>
  );
}
