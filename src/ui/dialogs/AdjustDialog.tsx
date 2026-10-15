import { useEffect, useState } from 'react';
import { filterCels, selectionMask, type CelScope } from '../../editor/doc-ops';
import type { EditorSession } from '../../editor/session';
import { snapBuffer } from '../../palette/analysis';
import { brightnessContrast, despeckle, grayscale, hueSaturation, outline, type Mask, type OutlineOptions } from '../../raster/adjust';
import type { RGBA } from '../../raster/color';
import type { PixelBuffer } from '../../raster/pixel-buffer';
import { attempt } from '../../renderer/actions/edit';
import { useEditor } from '../../renderer/state/editor-store';
import { Button, Select, Slider } from '../controls';
import { Dialog } from './Dialog';
import { ColorField, SCOPES } from './ImageDialogs';

export type AdjustKind = 'hue-saturation' | 'brightness-contrast' | 'outline' | 'despeckle' | 'grayscale';

const TITLES: Record<AdjustKind, string> = {
  'hue-saturation': 'Matiz e saturação',
  'brightness-contrast': 'Brilho e contraste',
  outline: 'Contorno',
  despeckle: 'Remover pontos soltos',
  grayscale: 'Tons de cinza',
};

const NOTES: Record<AdjustKind, string> = {
  'hue-saturation': 'Gire o matiz para criar variações de cor (um inimigo vermelho vira azul) ou tire a saturação para um visual mais apagado.',
  'brightness-contrast': 'Clareie, escureça ou aumente a diferença entre luz e sombra.',
  outline: 'Desenha uma borda de 1 pixel em volta do desenho. "Círculo" deixa os cantos abertos, "Quadrado" fecha as diagonais.',
  despeckle: 'Troca cada pixel pela mediana dos vizinhos, apagando pixels isolados sem borrar as bordas.',
  grayscale: 'Converte as cores para cinza mantendo o brilho percebido.',
};

type Filter = (img: PixelBuffer, mask: Mask) => PixelBuffer;

/** Shows `filter` live on the active cel through a draft; returns a cleanup. */
function previewOnCanvas(s: EditorSession, filter: Filter): () => void {
  if (!s.canEditLayer()) return () => undefined;
  const d = s.beginDraft();
  const out = filter(d.original, selectionMask(s));
  if (s.state.colorMode === 'indexed') snapBuffer(out, s.state.palette.colors);
  d.buffer.paste(out, 0, 0);
  s.touchDraft({ x: 0, y: 0, w: out.width, h: out.height });
  return () => s.cancelDraft();
}

/**
 * Colour adjustments and filters with a live preview on the canvas. Changes
 * apply to the chosen scope (and only inside the selection, if any) as one
 * undo step.
 */
export function AdjustDialog({ kind }: { kind: AdjustKind }) {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const primary = useEditor((s) => s.primary);
  const [scope, setScope] = useState<CelScope>('cel');
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(0);
  const [light, setLight] = useState(0);
  const [bright, setBright] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [color, setColor] = useState<RGBA>(primary);
  const [shape, setShape] = useState<OutlineOptions['shape']>('circle');
  const [place, setPlace] = useState<OutlineOptions['place']>('outside');

  const filter: Filter = (img, mask) => {
    switch (kind) {
      case 'hue-saturation':
        return hueSaturation(img, { hue, saturation: sat, lightness: light }, mask);
      case 'brightness-contrast':
        return brightnessContrast(img, { brightness: bright, contrast }, mask);
      case 'outline':
        return outline(img, { color, shape, place }, mask);
      case 'despeckle':
        return despeckle(img, mask);
      case 'grayscale':
        return grayscale(img, mask);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => previewOnCanvas(session, filter), [session, kind, hue, sat, light, bright, contrast, color, shape, place]);

  const apply = (): void => {
    session.cancelDraft();
    close();
    attempt((s) => filterCels(s, TITLES[kind], filter, scope));
  };

  return (
    <Dialog
      title={TITLES[kind]}
      onClose={close}
      testId="adjust-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={apply} data-testid="adjust-apply">
            Aplicar
          </Button>
        </>
      }
    >
      <p className="dialog-note">{NOTES[kind]}</p>
      <div className="form-grid">
        {kind === 'hue-saturation' && (
          <>
            <Slider label="Matiz" value={hue} min={-180} max={180} onChange={setHue} format={(v) => `${v}°`} />
            <Slider label="Saturação" value={sat} min={-100} max={100} onChange={setSat} format={(v) => `${v}%`} />
            <Slider label="Luminosidade" value={light} min={-100} max={100} onChange={setLight} format={(v) => `${v}%`} />
          </>
        )}
        {kind === 'brightness-contrast' && (
          <>
            <Slider label="Brilho" value={bright} min={-100} max={100} onChange={setBright} />
            <Slider label="Contraste" value={contrast} min={-100} max={100} onChange={setContrast} />
          </>
        )}
        {kind === 'outline' && (
          <>
            <ColorField label="Cor do contorno" value={color} onChange={setColor} />
            <Select<OutlineOptions['shape']>
              label="Forma"
              value={shape}
              options={[
                { value: 'circle', label: 'Círculo (4 vizinhos)' },
                { value: 'square', label: 'Quadrado (8 vizinhos)' },
              ]}
              onChange={setShape}
            />
            <Select<OutlineOptions['place']>
              label="Posição"
              value={place}
              options={[
                { value: 'outside', label: 'Por fora' },
                { value: 'inside', label: 'Por dentro' },
              ]}
              onChange={setPlace}
            />
          </>
        )}
        <Select label="Aplicar em" value={scope} options={SCOPES} onChange={setScope} />
        {scope !== 'cel' && <p className="muted">A prévia mostra só a camada e o quadro atuais.</p>}
      </div>
    </Dialog>
  );
}
