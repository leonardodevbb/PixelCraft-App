import { useEffect, useMemo, useState } from 'react';
import { allLayers } from '../../project/model';
import { api } from '../../renderer/api';
import { useEditor } from '../../renderer/state/editor-store';
import type { AppInfo } from '../../shared/ipc';
import { Button } from '../controls';
import { Dialog } from './Dialog';

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Plain-text report for bug reports. Nothing is sent anywhere: the user
 * copies it and decides where to paste it.
 */
export function DiagnosticsDialog() {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void api.app.info().then(setInfo);
  }, []);

  const text = useMemo(() => {
    const lines: string[] = [];
    if (info) {
      lines.push(
        `PixelCraft ${info.version} (${info.distribution}${info.packaged ? '' : ', não empacotado'})`,
        `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
        `Sistema: ${info.platform} ${info.arch}`,
        `Configurações: ${info.paths.config}`,
        `Dados: ${info.paths.data}`,
        `Cache e log: ${info.paths.cache}`,
        `Recuperação: ${info.paths.recovery}`,
      );
    }
    lines.push(`Tela: ${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x · idioma ${navigator.language}`);
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (mem) lines.push(`Memória JS: ${mb(mem.usedJSHeapSize)} de ${mb(mem.jsHeapSizeLimit)}`);
    if (session) {
      const st = session.state;
      let pixels = 0;
      for (const img of session.doc.images.values()) pixels += img.width * img.height;
      lines.push(
        `Documento: ${st.width}×${st.height}, ${allLayers(st.layers).length} camadas, ${st.frames.length} quadros, ${session.doc.images.size} imagens (${mb(pixels * 4)})`,
        `Histórico: ${session.history.entries.length} passos, ${mb(session.history.usedBytes)} de ${mb(session.history.options.maxBytes)}`,
      );
    } else lines.push('Documento: nenhum aberto');
    return lines.join('\n');
  }, [info, session]);

  const copy = (): void => {
    const ta = document.getElementById('diagnostics-text') as HTMLTextAreaElement | null;
    if (!ta) return;
    ta.select();
    setCopied(document.execCommand('copy'));
  };

  return (
    <Dialog
      title="Informações de diagnóstico"
      onClose={close}
      width={600}
      testId="diagnostics-dialog"
      footer={
        <>
          <Button onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</Button>
          <Button variant="primary" onClick={close}>
            Fechar
          </Button>
        </>
      }
    >
      <p className="muted small">Use estas informações ao relatar um problema. Nada é enviado automaticamente.</p>
      <textarea id="diagnostics-text" className="mono" readOnly rows={11} value={text} aria-label="Relatório de diagnóstico" style={{ width: '100%' }} />
    </Dialog>
  );
}
