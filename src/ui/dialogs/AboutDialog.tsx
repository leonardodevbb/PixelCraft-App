import { useEffect, useState } from 'react';
import { api } from '../../renderer/api';
import { useEditor } from '../../renderer/state/editor-store';
import type { AppInfo } from '../../shared/ipc';
import { Button } from '../controls';
import { Dialog } from './Dialog';

const DIST_LABEL: Record<AppInfo['distribution'], string> = {
  deb: 'Pacote .deb',
  appimage: 'AppImage',
  flatpak: 'Flatpak',
  development: 'Desenvolvimento',
  unknown: 'Desconhecida',
};

export function AboutDialog() {
  const close = useEditor((s) => s.closeDialog);
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void api.app.info().then(setInfo);
  }, []);
  return (
    <Dialog title="Sobre o PixelCraft" onClose={close} width={520} testId="about-dialog" footer={<Button onClick={close}>Fechar</Button>}>
      <div className="about">
        <img className="about-logo logo-on-dark" src="./logo-on-dark.svg" alt="PixelCraft" />
        <img className="about-logo logo-on-light" src="./logo-on-light.svg" alt="PixelCraft" />
        <p>Estúdio de pixel art, sprites e animação quadro a quadro para Linux. Funciona offline e guarda seus projetos apenas no seu computador.</p>
        {info && (
          <dl className="about-info">
            <dt>Versão</dt>
            <dd data-testid="about-version">{info.version}</dd>
            <dt>Distribuição</dt>
            <dd>{DIST_LABEL[info.distribution]}</dd>
            <dt>Electron / Chromium</dt>
            <dd>
              {info.electron || '—'} / {info.chrome.split(' ')[0]}
            </dd>
            <dt>Plataforma</dt>
            <dd>
              {info.platform} {info.arch}
            </dd>
            <dt>Configurações</dt>
            <dd className="mono">{info.paths.config}</dd>
            <dt>Recuperação</dt>
            <dd className="mono">{info.paths.recovery}</dd>
          </dl>
        )}
        <p className="muted">Licença MIT. Sem telemetria e sem anúncios. Fonte bitmap e ícones criados para o projeto.</p>
      </div>
    </Dialog>
  );
}
