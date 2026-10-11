import { useState } from 'react';
import { commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs } from '../../renderer/state/preferences';
import { displayChord } from '../../shortcuts/keys';
import { Button, Checkbox } from '../controls';
import { Icon } from '../Icon';
import type { IconName } from '../icon-data';
import { Dialog } from './Dialog';

const key = (id: string): string => {
  const k = commands.keysFor(id)[0];
  return k ? displayChord(k) : '';
};

interface Step {
  icon: IconName;
  title: string;
  body: () => string[];
}

const STEPS: Step[] = [
  {
    icon: 'pencil',
    title: 'Desenhe pixel por pixel',
    body: () => [
      `Escolha uma ferramenta na barra à esquerda: lápis (${key('tool.pencil')}), borracha (${key('tool.eraser')}), balde (${key('tool.bucket')}), formas, texto (${key('tool.text')}) e degradê (${key('tool.gradient')}).`,
      'O botão esquerdo pinta com a cor primária e o direito com a secundária. Segure Alt para pegar uma cor da tela.',
      'Role o mouse para dar zoom no ponto do cursor. Segure Espaço e arraste para mover a vista.',
    ],
  },
  {
    icon: 'palette',
    title: 'Cores e paletas',
    body: () => [
      'Clique em uma cor da paleta para usá-la; clique com o botão direito para a cor secundária.',
      'Em Imagem › Paleta você importa paletas (GPL, HEX, JASC, ACT), analisa as cores usadas e reduz a quantidade de cores.',
    ],
  },
  {
    icon: 'layers',
    title: 'Camadas',
    body: () => [
      `Separe partes do desenho em camadas (${key('layer.new')} cria uma nova). Arraste para reordenar ou para dentro de um grupo.`,
      'O olho oculta, o cadeado protege contra edição e a engrenagem abre opacidade, mesclagem e cor da etiqueta.',
    ],
  },
  {
    icon: 'frame',
    title: 'Animação',
    body: () => [
      `Crie quadros na linha do tempo (${key('anim.newFrame')}), navegue com ${key('anim.prev')} e ${key('anim.next')} e toque Espaço para reproduzir.`,
      'Ative o papel vegetal para ver os quadros vizinhos enquanto desenha. Clique na duração de um quadro para editá-la.',
    ],
  },
  {
    icon: 'export',
    title: 'Salvar e exportar',
    body: () => [
      `${key('file.save')} salva o projeto .pixelcraft com camadas e quadros. Seu trabalho também é guardado automaticamente para recuperação.`,
      'Em Arquivo você exporta PNG, JPEG, WebP, BMP, GIF animado, spritesheet com JSON, sequência de PNG e tileset.',
      `Esqueceu onde fica algo? ${key('help.commandPalette')} abre a paleta de comandos e ${key('help.shortcuts')} mostra todos os atalhos.`,
    ],
  },
];

/** Short first-run introduction; can be reopened from the Help menu. */
export function TutorialDialog() {
  const close = useEditor((s) => s.closeDialog);
  const showAgain = usePrefs((s) => s.prefs.showTutorial);
  const [i, setI] = useState(0);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  return (
    <Dialog
      title="Primeiros passos"
      onClose={close}
      width={520}
      testId="tutorial-dialog"
      footer={
        <>
          <Checkbox label="Mostrar ao abrir" checked={showAgain} onChange={(showTutorial) => usePrefs.getState().set({ showTutorial })} />
          <span style={{ flex: 1 }} />
          <Button onClick={() => setI(i - 1)} disabled={i === 0}>
            Voltar
          </Button>
          {last ? (
            <Button variant="primary" onClick={close} data-testid="tutorial-done">
              Começar a desenhar
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setI(i + 1)} data-testid="tutorial-next">
              Próximo
            </Button>
          )}
        </>
      }
    >
      <div className="tutorial-step" aria-live="polite">
        <div className="tutorial-icon" aria-hidden>
          <Icon name={step.icon} size={28} />
        </div>
        <h2>
          {step.title} <span className="muted small">({i + 1} de {STEPS.length})</span>
        </h2>
        {step.body().map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <div className="tutorial-dots" role="tablist" aria-label="Etapas">
        {STEPS.map((s, n) => (
          <button key={s.title} type="button" role="tab" aria-selected={n === i} aria-label={s.title} className={n === i ? 'is-active' : ''} onClick={() => setI(n)} />
        ))}
      </div>
    </Dialog>
  );
}
