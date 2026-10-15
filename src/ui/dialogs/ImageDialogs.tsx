import { useMemo, useState } from 'react';
import { centerContent, offsetContent, replaceColor, resizeCanvas, resizeContent, SCOPE_LABELS, type Anchor, type CelScope } from '../../editor/doc-ops';
import { scaleSelected } from '../../editor/selection-ops';
import { composeFrame } from '../../layers/compose';
import { checkDimensions, LIMITS } from '../../project/limits';
import { parseHex, toHex, TRANSPARENT, type RGBA } from '../../raster/color';
import { PixelBuffer } from '../../raster/pixel-buffer';
import { resizeNearest } from '../../raster/scale';
import { attempt } from '../../renderer/actions/edit';
import { useEditor } from '../../renderer/state/editor-store';
import { BufferView } from '../canvas/BufferView';
import { Button, Checkbox, NumberField, Select, Slider } from '../controls';
import { Dialog } from './Dialog';

const ANCHORS: Anchor[] = [0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) => ({ ax, ay }) as Anchor));
const ANCHOR_NAMES = ['superior esquerda', 'superior centro', 'superior direita', 'centro esquerda', 'centro', 'centro direita', 'inferior esquerda', 'inferior centro', 'inferior direita'];

const PREVIEW_LIMIT = 1024 * 1024;

function useComposite(): PixelBuffer | null {
  const session = useEditor((s) => s.session);
  return useMemo(() => (session ? composeFrame(session.state, session.lookup, session.activeFrameId) : null), [session]);
}

function SizeFields({ w, h, setW, setH, base }: { w: number; h: number; setW: (v: number) => void; setH: (v: number) => void; base: { w: number; h: number } }) {
  const [lock, setLock] = useState(true);
  return (
    <div className="row">
      <NumberField
        label="Largura"
        value={w}
        min={1}
        max={LIMITS.maxDimension}
        suffix="px"
        onChange={(v) => {
          setW(v);
          if (lock) setH(Math.max(1, Math.min(LIMITS.maxDimension, Math.round((v * base.h) / base.w))));
        }}
        data-testid="size-width"
      />
      <NumberField
        label="Altura"
        value={h}
        min={1}
        max={LIMITS.maxDimension}
        suffix="px"
        onChange={(v) => {
          setH(v);
          if (lock) setW(Math.max(1, Math.min(LIMITS.maxDimension, Math.round((v * base.w) / base.h))));
        }}
        data-testid="size-height"
      />
      <Checkbox label="Manter proporção" checked={lock} onChange={setLock} />
    </div>
  );
}

export function ResizeCanvasDialog() {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const { width, height } = session.state;
  const [w, setW] = useState(width);
  const [h, setH] = useState(height);
  const [anchor, setAnchor] = useState<Anchor>({ ax: 0.5, ay: 0.5 });
  const composite = useComposite();
  const error = checkDimensions(w, h);
  const preview = useMemo(() => {
    if (error || !composite || w * h > PREVIEW_LIMIT) return null;
    const out = new PixelBuffer(w, h);
    out.paste(composite, Math.round((w - width) * anchor.ax), Math.round((h - height) * anchor.ay));
    return out;
  }, [composite, w, h, anchor, error, width, height]);
  const apply = (): void => {
    if (error) return;
    close();
    attempt((s) => resizeCanvas(s, w, h, anchor));
  };
  return (
    <Dialog
      title="Tamanho da tela"
      onClose={close}
      width={520}
      testId="resize-canvas-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={apply} disabled={!!error} data-testid="resize-apply">
            Aplicar
          </Button>
        </>
      }
    >
      <p className="dialog-note">
        Altera a área de trabalho sem redimensionar os pixels. Atual: {width}×{height} px. Conteúdo fora da nova área é cortado.
      </p>
      <SizeFields w={w} h={h} setW={setW} setH={setH} base={{ w: width, h: height }} />
      <div className="row align-start">
        <div className="field">
          <span className="field-label">Âncora</span>
          <div className="anchor-grid" role="radiogroup" aria-label="Âncora">
            {ANCHORS.map((a, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={a.ax === anchor.ax && a.ay === anchor.ay}
                aria-label={ANCHOR_NAMES[i]}
                className={a.ax === anchor.ax && a.ay === anchor.ay ? 'is-active' : ''}
                onClick={() => setAnchor(a)}
              />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Pré-visualização</span>
          {preview ? <BufferView buffer={preview} label="Pré-visualização da nova tela" /> : <span className="muted">Indisponível para este tamanho.</span>}
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function ResizeContentDialog() {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const { width, height } = session.state;
  const [w, setW] = useState(width);
  const [h, setH] = useState(height);
  const composite = useComposite();
  const error = checkDimensions(w, h);
  const preview = useMemo(() => (error || !composite || w * h > PREVIEW_LIMIT ? null : resizeNearest(composite, w, h)), [composite, w, h, error]);
  const apply = (): void => {
    if (error) return;
    close();
    attempt((s) => resizeContent(s, w, h));
  };
  const pct = (p: number): void => {
    setW(Math.max(1, Math.round((width * p) / 100)));
    setH(Math.max(1, Math.round((height * p) / 100)));
  };
  return (
    <Dialog
      title="Redimensionar imagem"
      onClose={close}
      width={520}
      testId="resize-content-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={apply} disabled={!!error} data-testid="resize-apply">
            Aplicar
          </Button>
        </>
      }
    >
      <p className="dialog-note">Redimensiona todas as camadas e quadros por vizinho mais próximo, sem suavizar os pixels. Atual: {width}×{height} px.</p>
      <SizeFields w={w} h={h} setW={setW} setH={setH} base={{ w: width, h: height }} />
      <div className="segmented" role="group" aria-label="Escala rápida">
        {[25, 50, 200, 300, 400].map((p) => (
          <button key={p} type="button" onClick={() => pct(p)}>
            {p}%
          </button>
        ))}
      </div>
      <div className="field">
        <span className="field-label">Pré-visualização</span>
        {preview ? <BufferView buffer={preview} label="Pré-visualização redimensionada" /> : <span className="muted">Indisponível para este tamanho.</span>}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export const SCOPES = (Object.keys(SCOPE_LABELS) as CelScope[]).map((value) => ({ value, label: SCOPE_LABELS[value] }));

export function OffsetDialog() {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [wrap, setWrap] = useState(true);
  const [scope, setScope] = useState<CelScope>('cel');
  const { width, height } = session.state;
  return (
    <Dialog
      title="Deslocar conteúdo"
      onClose={close}
      testId="offset-dialog"
      footer={
        <>
          <Button
            onClick={() => {
              close();
              attempt((s) => centerContent(s, scope));
            }}
          >
            Centralizar conteúdo
          </Button>
          <Button onClick={close}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={() => {
              close();
              attempt((s) => offsetContent(s, dx, dy, wrap, scope));
            }}
          >
            Aplicar
          </Button>
        </>
      }
    >
      <div className="row">
        <NumberField label="Horizontal" value={dx} min={-width} max={width} onChange={setDx} suffix="px" />
        <NumberField label="Vertical" value={dy} min={-height} max={height} onChange={setDy} suffix="px" />
      </div>
      <div className="segmented" role="group" aria-label="Atalhos">
        <button type="button" onClick={() => (setDx(Math.floor(width / 2)), setDy(Math.floor(height / 2)))}>
          Metade (ver emendas de tile)
        </button>
      </div>
      <Checkbox label="Dar a volta nas bordas (tile contínuo)" checked={wrap} onChange={setWrap} />
      <Select label="Aplicar em" value={scope} options={SCOPES} onChange={setScope} />
    </Dialog>
  );
}

export function ColorField({ label, value, onChange, allowTransparent }: { label: string; value: RGBA; onChange: (c: RGBA) => void; allowTransparent?: boolean }) {
  const transparent = value === TRANSPARENT;
  return (
    <div className="field color-field">
      <span className="field-label">{label}</span>
      <div className="row">
        <input type="color" aria-label={label} value={toHex(value).slice(0, 7)} disabled={transparent} onChange={(e) => onChange(parseHex(e.target.value) ?? value)} />
        <code>{transparent ? 'transparente' : toHex(value)}</code>
        {allowTransparent && <Checkbox label="Transparente" checked={transparent} onChange={(t) => onChange(t ? TRANSPARENT : 0x000000ff)} />}
      </div>
    </div>
  );
}

export function ReplaceColorDialog() {
  const close = useEditor((s) => s.closeDialog);
  const primary = useEditor((s) => s.primary);
  const secondary = useEditor((s) => s.secondary);
  const [from, setFrom] = useState<RGBA>(primary);
  const [to, setTo] = useState<RGBA>(secondary);
  const [tol, setTol] = useState(0);
  const [scope, setScope] = useState<CelScope>('all');
  return (
    <Dialog
      title="Substituir cor"
      onClose={close}
      testId="replace-color-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={() => {
              close();
              const n = attempt((s) => replaceColor(s, from, to, tol, scope));
              if (n !== undefined) useEditor.getState().toast(n ? 'success' : 'info', n ? `${n} pixel(s) substituído(s).` : 'Nenhum pixel com essa cor.');
            }}
          >
            Substituir
          </Button>
        </>
      }
    >
      <p className="dialog-note">Se houver seleção, só a área selecionada é alterada. Padrão: cor primária → secundária.</p>
      <ColorField label="Cor de origem" value={from} onChange={setFrom} allowTransparent />
      <ColorField label="Nova cor" value={to} onChange={setTo} allowTransparent />
      <Slider label="Tolerância" value={tol} min={0} max={100} onChange={setTol} format={(v) => `${v}%`} />
      <Select label="Aplicar em" value={scope} options={SCOPES} onChange={setScope} />
    </Dialog>
  );
}

export function ScaleSelectionDialog() {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const b = session.selection?.bounds ?? { x: 0, y: 0, w: session.state.width, h: session.state.height };
  const [w, setW] = useState(b.w);
  const [h, setH] = useState(b.h);
  const error = checkDimensions(w, h);
  return (
    <Dialog
      title="Redimensionar seleção"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={!!error}
            onClick={() => {
              close();
              attempt((s) => scaleSelected(s, w, h));
            }}
          >
            Aplicar
          </Button>
        </>
      }
    >
      <p className="dialog-note">
        {session.selection ? 'Redimensiona os pixels selecionados' : 'Sem seleção: redimensiona a camada inteira'} por vizinho mais próximo, mantendo o centro.
      </p>
      <SizeFields w={w} h={h} setW={setW} setH={setH} base={{ w: b.w, h: b.h }} />
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  );
}
