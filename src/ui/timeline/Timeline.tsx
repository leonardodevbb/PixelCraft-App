import { useEffect, useRef, useState } from 'react';
import type { EditorSession } from '../../editor/session';
import { addFrame, deleteFrame, duplicateFrame, isCelLinked, moveFrame, setAnimation, setFps, setFrameDuration } from '../../editor/frame-ops';
import { LIMITS } from '../../project/limits';
import type { Frame, LoopMode } from '../../project/model';
import { attempt } from '../../renderer/actions/edit';
import { togglePlayback } from '../../renderer/actions/playback';
import { commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs } from '../../renderer/state/preferences';
import { IconButton, NumberField, Select } from '../controls';
import { frameImage } from './thumbs';

function Thumb({ session, frame }: { session: EditorSession; frame: Frame }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const revision = useEditor((s) => s.revision);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const img = frameImage(session, frame.id);
    if (c.width !== img.width || c.height !== img.height) {
      c.width = img.width;
      c.height = img.height;
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [session, frame.id, revision]);
  const { width, height } = session.state;
  const k = 48 / Math.max(width, height);
  return (
    <span className="frame-thumb checker" style={{ width: Math.max(4, Math.round(width * k)), height: Math.max(4, Math.round(height * k)) }}>
      <canvas ref={ref} className="pixelated" />
    </span>
  );
}

function DurationEditor({ frame, onDone }: { frame: Frame; onDone: () => void }) {
  const [v, setV] = useState(String(frame.duration));
  const commit = (): void => {
    const n = Number(v);
    if (Number.isFinite(n)) attempt((s) => setFrameDuration(s, [frame.id], n));
    onDone();
  };
  return (
    <input
      className="frame-duration-input"
      value={v}
      autoFocus
      aria-label="Duração do quadro em milissegundos"
      inputMode="numeric"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onDone();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

const LOOP_OPTIONS: { value: LoopMode; label: string }[] = [
  { value: 'loop', label: 'Repetir' },
  { value: 'pingpong', label: 'Vai e volta' },
  { value: 'once', label: 'Uma vez' },
];

export function Timeline() {
  const session = useEditor((s) => s.session);
  useEditor((s) => s.revision);
  const playing = useEditor((s) => s.playing);
  const playFrameId = useEditor((s) => s.playFrameId);
  const onion = usePrefs((s) => s.prefs.onion);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);
  const stripRef = useRef<HTMLOListElement>(null);
  const activeId = session?.activeFrameId;
  useEffect(() => {
    stripRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, playFrameId]);
  if (!session) return null;
  const st = session.state;
  const frames = st.frames;
  const anim = st.animation;
  const activeIndex = frames.findIndex((f) => f.id === session.activeFrameId);
  const total = frames.reduce((t, f) => t + f.duration, 0);
  const setOnion = (patch: Partial<typeof onion>): void => usePrefs.getState().set({ onion: { ...onion, ...patch } });
  const key = (id: string): string | undefined => commands.keysFor(id)[0];

  return (
    <section className="timeline" aria-label="Linha do tempo" data-testid="timeline">
      <div className="timeline-bar" role="toolbar" aria-label="Controles de animação">
        <IconButton icon="first" label="Primeiro quadro" shortcut={key('anim.first')} onClick={() => commands.execute('anim.first')} />
        <IconButton icon="prev" label="Quadro anterior" shortcut={key('anim.prev')} onClick={() => commands.execute('anim.prev')} />
        <IconButton
          icon={playing ? 'pause' : 'play'}
          label={playing ? 'Pausar' : 'Reproduzir'}
          hint="Espaço (toque rápido) também reproduz e pausa."
          shortcut={key('anim.play')}
          active={playing}
          disabled={frames.length < 2}
          onClick={() => togglePlayback()}
          data-testid="anim-play"
        />
        <IconButton icon="next" label="Próximo quadro" shortcut={key('anim.next')} onClick={() => commands.execute('anim.next')} />
        <IconButton icon="last" label="Último quadro" shortcut={key('anim.last')} onClick={() => commands.execute('anim.last')} />
        <span className="divider" />
        <IconButton icon="plus" label="Novo quadro" shortcut={key('anim.newFrame')} onClick={() => attempt((s) => addFrame(s))} data-testid="frame-add" />
        <IconButton icon="duplicate" label="Duplicar quadro" shortcut={key('anim.duplicateFrame')} onClick={() => attempt((s) => duplicateFrame(s))} data-testid="frame-duplicate" />
        <IconButton icon="trash" label="Excluir quadro" shortcut={key('anim.deleteFrame')} disabled={frames.length < 2} onClick={() => attempt((s) => deleteFrame(s))} data-testid="frame-delete" />
        <span className="divider" />
        <NumberField
          label="FPS"
          value={anim.fps}
          min={1}
          max={60}
          onChange={(fps) => attempt((s) => setFps(s, fps))}
          data-testid="anim-fps"
        />
        <Select<LoopMode> label="Modo" value={anim.loop} options={LOOP_OPTIONS} onChange={(loop) => attempt((s) => setAnimation(s, { loop }))} />
        <IconButton
          icon="loop"
          label={anim.direction === 'reverse' ? 'Direção: reversa' : 'Direção: normal'}
          hint="Inverte o sentido da reprodução e da exportação."
          active={anim.direction === 'reverse'}
          onClick={() => attempt((s) => setAnimation(s, { direction: anim.direction === 'reverse' ? 'forward' : 'reverse' }))}
          data-testid="anim-reverse"
        />
        <span className="divider" />
        <IconButton icon="onion" label="Onion skin" hint="Mostra quadros vizinhos translúcidos: anteriores em rosa, seguintes em verde-água." shortcut={key('anim.onion')} active={onion.enabled} onClick={() => setOnion({ enabled: !onion.enabled })} data-testid="onion-toggle" />
        {onion.enabled && (
          <>
            <NumberField label="Antes" value={onion.before} min={0} max={5} onChange={(before) => setOnion({ before })} />
            <NumberField label="Depois" value={onion.after} min={0} max={5} onChange={(after) => setOnion({ after })} />
          </>
        )}
        <span className="timeline-info muted">
          Quadro {activeIndex + 1}/{frames.length} · {(total / 1000).toFixed(2)} s
        </span>
      </div>
      <ol className="frame-strip" ref={stripRef} aria-label="Quadros" data-testid="frame-strip">
        {frames.map((f, i) => {
          const isActive = f.id === session.activeFrameId;
          const isPlaying = f.id === playFrameId;
          const linked = isCelLinked(session, session.activeLayerId, f.id);
          return (
            <li
              key={f.id}
              aria-current={isActive ? 'true' : undefined}
              className={`frame-cell${isActive ? ' is-active' : ''}${isPlaying ? ' is-playing' : ''}${drag?.over === i ? ' drop-here' : ''}`}
              draggable={editing !== f.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', f.id);
                setDrag({ id: f.id, over: null });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.over !== i) setDrag({ ...drag, over: i });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag) attempt((s) => moveFrame(s, drag.id, i));
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={() => session.setActiveFrame(f.id)}
              data-testid="frame-cell"
            >
              {f.tag && (
                <span className="frame-tag" title={f.tag}>
                  {f.tag}
                </span>
              )}
              <button
                type="button"
                className="frame-select"
                aria-label={`Quadro ${i + 1}, ${f.duration} ms${f.tag ? `, marcador ${f.tag}` : ''}${linked ? ', célula vinculada' : ''}`}
                aria-pressed={isActive}
                onClick={(e) => {
                  e.stopPropagation();
                  session.setActiveFrame(f.id);
                }}
              >
                <Thumb session={session} frame={f} />
              </button>
              <span className="frame-meta">
                <span className="frame-index">{i + 1}</span>
                {linked && (
                  <span className="frame-link" data-tip="Célula vinculada" data-tip-hint="Esta camada usa a mesma imagem em outro quadro.">
                    ∞
                  </span>
                )}
                {editing === f.id ? (
                  <DurationEditor frame={f} onDone={() => setEditing(null)} />
                ) : (
                  <button
                    type="button"
                    className="frame-duration"
                    data-tip="Duração"
                    data-tip-hint={`Clique para editar (${LIMITS.minFrameDuration}–${LIMITS.maxFrameDuration} ms).`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(f.id);
                    }}
                  >
                    {f.duration}ms
                  </button>
                )}
              </span>
            </li>
          );
        })}
        <li className="frame-cell frame-new">
          <button type="button" aria-label="Novo quadro" onClick={() => attempt((s) => addFrame(s))}>
            +
          </button>
        </li>
      </ol>
    </section>
  );
}
