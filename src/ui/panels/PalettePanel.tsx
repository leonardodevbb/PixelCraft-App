import { useEffect, useState } from 'react';
import { addPaletteColor, movePaletteColor, removePaletteColor, setPalette, setPaletteColor } from '../../editor/palette-ops';
import { parsePalette, writePalette, PALETTE_FORMATS, type PaletteFormat } from '../../palette/formats';
import { EditorError } from '../../editor/session';
import { toCss, toHex, withAlpha, type RGBA } from '../../raster/color';
import { api } from '../../renderer/api';
import { attempt, attemptAsync } from '../../renderer/actions/edit';
import { promptDialog, useEditor } from '../../renderer/state/editor-store';
import { BUILTIN_PALETTES, libraryPalette, usePalettes } from '../../renderer/state/palettes';
import { IconButton, Section } from '../controls';
import { pushRecentColor } from './ColorPanel';

export async function importPaletteFile(): Promise<void> {
  const file = await api.file.openDialog('palette', 'Importar paleta');
  if (!file) return;
  await attemptAsync(async (s) => {
    let parsed;
    try {
      parsed = parsePalette(file.name, file.data);
    } catch (e) {
      throw new EditorError(`Paleta inválida: ${e instanceof Error ? e.message : String(e)}`);
    }
    const name = parsed.name ?? file.name.replace(/\.[^.]+$/, '');
    const pal = libraryPalette(name, parsed.colors);
    await usePalettes.getState().save(pal);
    setPalette(s, { ...pal }, 'Importar paleta');
    useEditor.getState().toast('success', `Paleta "${name}" importada (${parsed.colors.length} cores).`);
  });
}

export async function exportPaletteFile(): Promise<void> {
  const s = useEditor.getState().session;
  if (!s) return;
  const p = s.state.palette;
  const exts = PALETTE_FORMATS.map((f) => f.ext);
  const path = await api.file.saveDialog({ kind: 'palette', defaultName: `${p.name}.gpl`, title: 'Exportar paleta', extensions: exts, filterName: 'Paletas (gpl, hex, json, pal, act)' });
  if (!path) return;
  const ext = path.toLowerCase().split('.').pop();
  const fmt: PaletteFormat = PALETTE_FORMATS.find((f) => f.ext === ext)?.id ?? 'gpl';
  try {
    await api.file.write(path, writePalette(fmt, p.name, p.colors));
    const label = PALETTE_FORMATS.find((f) => f.id === fmt)!.label;
    useEditor.getState().toast('success', `Paleta exportada como ${label}${fmt === 'act' && p.colors.length > 256 ? ' (limitada a 256 cores)' : ''}.`);
  } catch (e) {
    useEditor.getState().toast('error', `Falha ao exportar paleta: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function PalettePanel() {
  const session = useEditor((s) => s.session);
  useEditor((s) => s.revision);
  const primary = useEditor((s) => s.primary);
  const lib = usePalettes();
  const [selected, setSelected] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  useEffect(() => {
    if (!lib.loaded) void lib.load();
  }, [lib]);
  if (!session) return null;
  const palette = session.state.palette;
  const sel = selected !== null && selected < palette.colors.length ? selected : null;
  const pick = (c: RGBA, slot: 'primary' | 'secondary'): void => {
    useEditor.getState().setColor(slot, c);
    pushRecentColor(c);
  };
  const sources = [...BUILTIN_PALETTES.map((p) => ({ p, builtin: true })), ...lib.user.map((p) => ({ p, builtin: false }))];
  const libEntry = sources.find((x) => x.p.id === palette.id);

  return (
    <Section
      title="Paleta"
      actions={
        <>
          <IconButton icon="plus" label="Adicionar cor primária" onClick={() => attempt((s) => addPaletteColor(s, withAlpha(primary, 255)))} data-testid="palette-add" />
          <IconButton icon="minus" label="Remover cor selecionada" disabled={sel === null} onClick={() => sel !== null && attempt((s) => removePaletteColor(s, sel))} data-testid="palette-remove" />
          <IconButton icon="import" label="Importar paleta (GPL, HEX, JSON, PAL, ACT)" onClick={() => void importPaletteFile()} data-testid="palette-import" />
          <IconButton icon="export" label="Exportar paleta" onClick={() => void exportPaletteFile()} data-testid="palette-export" />
          <IconButton icon="settings" label="Ferramentas de paleta" hint="Contar cores, cores fora da paleta, reduzir cores." onClick={() => useEditor.getState().openDialog({ type: 'palette-tools' })} data-testid="palette-tools" />
        </>
      }
    >
      <div className="palette-head">
        <label className="field select-field label-hidden">
          <span className="field-label">Trocar paleta</span>
          <select
            aria-label="Trocar paleta do documento"
            value={libEntry ? palette.id : ''}
            onChange={(e) => {
              const src = sources.find((x) => x.p.id === e.target.value);
              if (src) attempt((s) => setPalette(s, { ...src.p }, `Usar paleta "${src.p.name}"`));
            }}
            data-testid="palette-select"
          >
            {!libEntry && <option value="">{palette.name} (do documento)</option>}
            <optgroup label="Incluídas">
              {BUILTIN_PALETTES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {lib.user.length > 0 && (
              <optgroup label="Minhas paletas">
                {lib.user.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <IconButton
          icon="save"
          label="Guardar em Minhas paletas"
          hint="Fica disponível em todos os projetos."
          onClick={async () => {
            const isUser = lib.user.some((p) => p.id === palette.id);
            const name = isUser ? palette.name : (await promptDialog({ title: 'Guardar paleta', label: 'Nome da paleta', initial: palette.name, confirmLabel: 'Guardar' }))?.trim();
            if (!name) return;
            const p = isUser ? { ...palette } : libraryPalette(name, palette.colors);
            void lib.save(p).then(() => {
              if (!isUser) attempt((s) => setPalette(s, { ...p }, 'Guardar paleta'));
              useEditor.getState().toast('success', `Paleta "${p.name}" guardada.`);
            });
          }}
          data-testid="palette-save"
        />
        {lib.user.some((p) => p.id === palette.id) && (
          <IconButton
            icon="trash"
            label="Excluir de Minhas paletas"
            hint="O documento mantém as cores."
            onClick={() => {
              void lib.remove(palette.id);
              attempt((s) => setPalette(s, { ...palette, id: `doc-${palette.id}` }, 'Desvincular paleta'));
            }}
          />
        )}
      </div>
      <div className="swatch-grid" data-testid="palette-grid" role="listbox" aria-label={`Cores da paleta ${palette.name}`}>
        {palette.colors.map((c, i) => (
          <button
            key={`${i}-${c}`}
            type="button"
            role="option"
            aria-selected={sel === i}
            className={`palette-swatch${c === primary ? ' is-selected' : ''}${sel === i ? ' is-focused' : ''}`}
            style={{ '--swatch': toCss(c) } as React.CSSProperties}
            aria-label={`${i + 1}: ${toHex(c)}`}
            data-tip={toHex(c)}
            data-tip-hint="Clique: primária. Botão direito: secundária. Arraste para reordenar."
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
              setDragFrom(i);
            }}
            onDragOver={(e) => dragFrom !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) attempt((s) => movePaletteColor(s, dragFrom, i));
              setDragFrom(null);
            }}
            onDragEnd={() => setDragFrom(null)}
            onClick={() => {
              setSelected(i);
              pick(c, 'primary');
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelected(i);
              pick(c, 'secondary');
            }}
            data-testid={`palette-${i}`}
          />
        ))}
      </div>
      <div className="palette-foot">
        <span className="muted">
          {palette.colors.length} cor{palette.colors.length === 1 ? '' : 'es'}
          {sel !== null ? ` · selecionada: ${sel + 1}` : ''}
        </span>
        {sel !== null && palette.colors[sel] !== withAlpha(primary, 255) && (
          <button type="button" className="link-btn" onClick={() => attempt((s) => setPaletteColor(s, sel, withAlpha(primary, 255)))}>
            Trocar pela cor primária
          </button>
        )}
      </div>
    </Section>
  );
}
