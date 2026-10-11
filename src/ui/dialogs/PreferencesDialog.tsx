import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/ipc';
import { api } from '../../renderer/api';
import { useEditor } from '../../renderer/state/editor-store';
import { DEFAULT_PREFERENCES, usePrefs, type Preferences } from '../../renderer/state/preferences';
import { Button, Checkbox, NumberField, Select } from '../controls';
import { Dialog } from './Dialog';

const ACCENTS = ['#ff7a3d', '#ff4f81', '#7b5cff', '#2ec4b6', '#4f9cff', '#ffd23f', '#73b73e'];

function rgbaToHex(css: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (!m) return css.startsWith('#') ? css.slice(0, 7) : '#ffffff';
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

export function PreferencesDialog() {
  const close = useEditor((s) => s.closeDialog);
  const p = usePrefs((s) => s.prefs);
  const set = usePrefs.getState().set;
  const [tab, setTab] = useState<'look' | 'canvas' | 'files'>('look');
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void api.app.info().then(setInfo);
  }, []);
  const session = useEditor((s) => s.session);

  const setHistory = (mb: number): void => {
    set({ historyMB: mb });
    session?.history.setOptions({ maxBytes: mb * 1024 * 1024 });
  };
  const resetAll = (): void => {
    const keep: Partial<Preferences> = { recentColors: p.recentColors, shortcuts: p.shortcuts };
    set({ ...DEFAULT_PREFERENCES, ...keep });
  };

  return (
    <Dialog
      title="Preferências"
      onClose={close}
      width={560}
      testId="preferences-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={resetAll}>
            Restaurar padrões
          </Button>
          <Button variant="primary" onClick={close}>
            Concluir
          </Button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {(
          [
            ['look', 'Aparência'],
            ['canvas', 'Tela de desenho'],
            ['files', 'Arquivos e memória'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'look' && (
        <div className="form-grid">
          <Select
            label="Tema"
            value={p.theme}
            options={[
              { value: 'dark', label: 'Escuro' },
              { value: 'light', label: 'Claro' },
              { value: 'system', label: 'Seguir o sistema' },
            ]}
            onChange={(theme) => set({ theme })}
          />
          <div className="field">
            <span className="field-label">Cor de destaque</span>
            <div className="tag-row" role="radiogroup" aria-label="Cor de destaque">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={p.accent === c}
                  aria-label={c}
                  className={`tag-swatch${p.accent === c ? ' is-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => set({ accent: c })}
                />
              ))}
              <input type="color" aria-label="Cor de destaque personalizada" value={p.accent} onChange={(e) => set({ accent: e.target.value })} />
            </div>
          </div>
          <Select
            label="Densidade da interface"
            value={p.density}
            options={[
              { value: 'comfortable', label: 'Confortável' },
              { value: 'compact', label: 'Compacta' },
            ]}
            onChange={(density) => set({ density })}
          />
          <Checkbox label="Mostrar dicas para iniciantes" checked={p.showTutorial} onChange={(showTutorial) => set({ showTutorial })} />
        </div>
      )}
      {tab === 'canvas' && (
        <div className="form-grid">
          <Checkbox label="Grade de pixels" checked={p.pixelGrid} onChange={(pixelGrid) => set({ pixelGrid })} />
          <NumberField label="Mostrar grade a partir do zoom" value={p.pixelGridMinZoom} min={2} max={64} suffix="×" onChange={(pixelGridMinZoom) => set({ pixelGridMinZoom })} />
          <label className="field">
            <span className="field-label">Cor da grade</span>
            <input type="color" value={rgbaToHex(p.gridColor)} onChange={(e) => set({ gridColor: `${e.target.value}40` })} />
          </label>
          <Checkbox label="Grade de tiles" checked={p.tileGrid} onChange={(tileGrid) => set({ tileGrid })} />
          <div className="row">
            <label className="field">
              <span className="field-label">Fundo xadrez A</span>
              <input type="color" value={rgbaToHex(p.checkerA)} onChange={(e) => set({ checkerA: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Fundo xadrez B</span>
              <input type="color" value={rgbaToHex(p.checkerB)} onChange={(e) => set({ checkerB: e.target.value })} />
            </label>
            <NumberField label="Tamanho do xadrez" value={p.checkerSize} min={2} max={64} suffix="px" onChange={(checkerSize) => set({ checkerSize })} />
          </div>
          <Checkbox label="Mostrar eixos de simetria" checked={p.showSymmetryAxes} onChange={(showSymmetryAxes) => set({ showSymmetryAxes })} />
        </div>
      )}
      {tab === 'files' && (
        <div className="form-grid">
          <NumberField
            label="Salvamento de recuperação a cada"
            value={p.autosaveSeconds}
            min={0}
            max={3600}
            suffix="s"
            onChange={(autosaveSeconds) => set({ autosaveSeconds })}
          />
          <p className="dialog-note">
            Cópias de recuperação ficam numa pasta separada e nunca substituem o seu arquivo. 0 desativa (não recomendado).
          </p>
          <NumberField label="Memória máxima do histórico" value={p.historyMB} min={16} max={4096} suffix="MB" onChange={setHistory} />
          <p className="dialog-note">Ao passar do limite, as ações mais antigas deixam de poder ser desfeitas.</p>
          <NumberField label="Escala padrão de exportação" value={p.defaultExportScale} min={1} max={64} suffix="×" onChange={(defaultExportScale) => set({ defaultExportScale })} />
          {info && (
            <dl className="export-summary" aria-label="Pastas do aplicativo">
              <dt>Configurações</dt>
              <dd>
                <code>{info.paths.config}</code>
              </dd>
              <dt>Dados</dt>
              <dd>
                <code>{info.paths.data}</code>
              </dd>
              <dt>Recuperação</dt>
              <dd>
                <code>{info.paths.recovery}</code>
              </dd>
              <dt>Cache</dt>
              <dd>
                <code>{info.paths.cache}</code>
              </dd>
            </dl>
          )}
        </div>
      )}
    </Dialog>
  );
}
