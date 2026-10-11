import { useMemo, useState } from 'react';
import { renderFrameForExport } from '../../import-export/export-image';
import { encodePng } from '../../import-export/png';
import { buildTilesetImage, extractTiles, tiledMapJson } from '../../import-export/tileset';
import { PixelBuffer } from '../../raster/pixel-buffer';
import { GENERATOR } from '../../renderer/actions/documents';
import { api } from '../../renderer/api';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs } from '../../renderer/state/preferences';
import { BufferView } from '../canvas/BufferView';
import { Button, Checkbox, NumberField } from '../controls';
import { Dialog } from './Dialog';

/** Repeats an image 3×3 so seams between tiles become visible. */
function mosaic(img: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(img.width * 3, img.height * 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) out.paste(img, x * img.width, y * img.height);
  return out;
}

/** Tile size and offset, seamless preview, and tileset + Tiled map export. */
export function TilesDialog() {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const toast = useEditor((s) => s.toast);
  const setBusy = useEditor((s) => s.setBusy);
  useEditor((s) => s.revision);
  const st = session.state;
  const [tiles, setTiles] = useState({ ...st.tiles });
  const [dedupe, setDedupe] = useState(true);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [columns, setColumns] = useState(8);
  const [withMap, setWithMap] = useState(true);
  const tiledPreview = usePrefs((s) => s.prefs.tiledPreview);
  const tileGridOn = usePrefs((s) => s.prefs.tileGrid);

  const frame = useMemo(() => renderFrameForExport(st, session.lookup, { frameId: session.context.frameId, scale: 1, background: null }), [st, session]);
  const ex = useMemo(() => extractTiles(frame, tiles, { dedupe, skipEmpty }), [frame, tiles, dedupe, skipEmpty]);
  const sheet = useMemo(() => (ex.tiles.length ? buildTilesetImage(ex.tiles, ex.grid.width, ex.grid.height, columns) : null), [ex, columns]);
  const preview = useMemo(() => (frame.width * frame.height <= 512 * 512 ? mosaic(frame) : null), [frame]);
  const changed = tiles.width !== st.tiles.width || tiles.height !== st.tiles.height || tiles.offsetX !== st.tiles.offsetX || tiles.offsetY !== st.tiles.offsetY;

  const saveSettings = (): void => {
    if (changed) session.apply('Configurar tiles', (s) => ({ ...s, tiles: { ...tiles } }));
  };

  const exportTileset = async (): Promise<void> => {
    if (!sheet) return;
    const name = session.doc.name;
    const path = await api.file.saveDialog({ kind: 'image', defaultName: `${name}-tileset.png`, title: 'Exportar tileset', extensions: ['png'], filterName: 'Imagem PNG' });
    if (!path) return;
    saveSettings();
    close();
    setBusy('Exportando tileset…');
    try {
      await api.file.write(path, encodePng(sheet, { text: { Software: GENERATOR } }));
      if (withMap) {
        const image = path.split(/[\\/]/).pop() ?? 'tileset.png';
        const json = tiledMapJson(ex, { image, width: sheet.width, height: sheet.height, columns, spacing: 0 }, name);
        await api.file.writeSibling(path, 'tmj', new TextEncoder().encode(json));
      }
      toast('success', `Tileset exportado: ${ex.tiles.length} tiles únicos de ${ex.grid.cols * ex.grid.rows}${withMap ? ', com mapa do Tiled (.tmj)' : ''}.`, {
        label: 'Mostrar na pasta',
        run: () => void api.file.showInFolder(path),
      });
    } catch (e) {
      toast('error', `Falha ao exportar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const max = Math.max(st.width, st.height);
  return (
    <Dialog
      title="Tiles e tileset"
      onClose={close}
      width={620}
      testId="tiles-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button
            onClick={() => {
              saveSettings();
              close();
            }}
            disabled={!changed}
          >
            Salvar configuração
          </Button>
          <Button variant="primary" onClick={() => void exportTileset()} disabled={!sheet} data-testid="tileset-export">
            Exportar tileset…
          </Button>
        </>
      }
    >
      <div className="grid-2">
        <NumberField label="Largura do tile" value={tiles.width} min={1} max={max} onChange={(width) => setTiles((t) => ({ ...t, width }))} suffix="px" data-testid="tile-w" />
        <NumberField label="Altura do tile" value={tiles.height} min={1} max={max} onChange={(height) => setTiles((t) => ({ ...t, height }))} suffix="px" data-testid="tile-h" />
        <NumberField label="Deslocamento X" value={tiles.offsetX} min={0} max={Math.max(0, tiles.width - 1)} onChange={(offsetX) => setTiles((t) => ({ ...t, offsetX }))} />
        <NumberField label="Deslocamento Y" value={tiles.offsetY} min={0} max={Math.max(0, tiles.height - 1)} onChange={(offsetY) => setTiles((t) => ({ ...t, offsetY }))} />
      </div>
      <div className="row">
        <Checkbox label="Mostrar grade de tiles" checked={tileGridOn} onChange={(tileGrid) => usePrefs.getState().set({ tileGrid })} />
        <Checkbox label="Mosaico na tela" checked={tiledPreview} onChange={(v) => usePrefs.getState().set({ tiledPreview: v })} hint="Repete a imagem ao redor da tela para conferir emendas enquanto desenha." />
      </div>
      <div className="row align-start">
        {preview && (
          <figure className="preview-figure">
            <BufferView buffer={preview} max={220} label="Mosaico 3×3 da imagem" />
            <figcaption className="muted small">Mosaico 3×3 (emendas aparecem aqui)</figcaption>
          </figure>
        )}
        <figure className="preview-figure">
          {sheet ? <BufferView buffer={sheet} max={220} label="Tileset gerado" testId="tileset-preview" /> : <p className="muted">Nenhum tile com conteúdo.</p>}
          <figcaption className="muted small" data-testid="tileset-info">
            {ex.grid.cols}×{ex.grid.rows} células · {ex.tiles.length} tiles {dedupe ? 'únicos' : ''}
            {sheet ? ` · ${sheet.width}×${sheet.height} px` : ''}
          </figcaption>
        </figure>
      </div>
      <div className="row">
        <Checkbox label="Remover tiles repetidos" checked={dedupe} onChange={setDedupe} />
        <Checkbox label="Ignorar tiles vazios" checked={skipEmpty} onChange={setSkipEmpty} />
        <NumberField label="Colunas" value={columns} min={1} max={256} onChange={setColumns} />
      </div>
      <Checkbox label="Gerar mapa do Tiled (.tmj) ao lado do PNG" checked={withMap} onChange={setWithMap} hint="Arquivo JSON do editor Tiled que remonta a imagem a partir do tileset." />
      <p className="muted small">Usa o quadro atual com as camadas visíveis. Tiles que não cabem inteiros na imagem ficam de fora.</p>
    </Dialog>
  );
}
