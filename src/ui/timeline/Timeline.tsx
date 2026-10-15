import { useEffect, useRef, useState } from 'react';
import type { EditorSession } from '../../editor/session';
import { addFrame, isCelLinked, moveFrame, moveFrames, setAnimation, setFps, setFrameDuration } from '../../editor/frame-ops';
import { tagRange } from '../../animation/tags';
import { blue, green, parseHex, red } from '../../raster/color';
import { LIMITS } from '../../project/limits';
import type { Frame, LoopMode } from '../../project/model';
import { attempt } from '../../renderer/actions/edit';
import { togglePlayback } from '../../renderer/actions/playback';
import { commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs } from '../../renderer/state/preferences';
import { Checkbox, IconButton, NumberField, Select } from '../controls';
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

/** Black or white text, whichever reads better on the tag colour. */
function readableOn(hex: string): string {
  const c = parseHex(hex) ?? 0;
  const lin = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(red(c)) + 0.7152 * lin(green(c)) + 0.0722 * lin(blue(c));
  return l > 0.18 ? '#1b1726' : '#ffffff';
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
  const frameSelection = useEditor((s) => s.frameSelection);
  const playTagOnly = useEditor((s) => s.playTagOnly);
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
        <IconButton icon="duplicate" label="Duplicar quadro" hint="Com vários quadros selecionados, duplica todos." shortcut={key('anim.duplicateFrame')} onClick={() => commands.execute('anim.duplicateFrame')} data-testid="frame-duplicate" />
        <IconButton icon="trash" label="Excluir quadro" hint="Com vários quadros selecionados, exclui todos." shortcut={key('anim.deleteFrame')} disabled={frames.length < 2} onClick={() => commands.execute('anim.deleteFrame')} data-testid="frame-delete" />
        <IconButton icon="tag" label="Nova tag" hint="Dá nome aos quadros selecionados (Shift+clique escolhe um intervalo)." shortcut={key('anim.newTag')} onClick={() => commands.execute('anim.newTag')} data-testid="tag-new" />
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
        {st.tags.length > 0 && (
          <Checkbox label="Só a tag atual" checked={playTagOnly} onChange={() => commands.execute('anim.playTagOnly')} hint="Ao reproduzir, repete apenas a tag do quadro atual, com a direção dela." />
        )}
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
          const isSelected = frameSelection.includes(f.id);
          const linked = isCelLinked(session, session.activeLayerId, f.id);
          const here = st.tags.flatMap((t) => {
            const r = tagRange(st, t);
            return r && r.from <= i && i <= r.to ? [{ t, start: r.from === i, end: r.to === i }] : [];
          });
          const pick = (e: React.MouseEvent): void => {
            if (e.shiftKey) {
              const a = Math.min(activeIndex, i);
              const b = Math.max(activeIndex, i);
              useEditor.setState({ frameSelection: frames.slice(a, b + 1).map((x) => x.id) });
            } else if (e.ctrlKey || e.metaKey) {
              const cur = frameSelection.length ? frameSelection : [session.activeFrameId];
              useEditor.setState({ frameSelection: cur.includes(f.id) ? cur.filter((x) => x !== f.id) : [...cur, f.id] });
            } else useEditor.setState({ frameSelection: [] });
            session.setActiveFrame(f.id);
          };
          return (
            <li
              key={f.id}
              aria-current={isActive ? 'true' : undefined}
              className={`frame-cell${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${isPlaying ? ' is-playing' : ''}${drag?.over === i ? ' drop-here' : ''}`}
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
                if (drag) {
                  const block = frameSelection.includes(drag.id) && frameSelection.length > 1 ? frameSelection : null;
                  if (block) {
                    // Drop position counted without the moved block.
                    const before = frames.slice(0, i).filter((x) => !block.includes(x.id)).length;
                    attempt((s) => moveFrames(s, block, before));
                  } else attempt((s) => moveFrame(s, drag.id, i));
                }
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={pick}
              data-testid="frame-cell"
            >
              <span className="frame-tags">
                {here.map(({ t, start, end }) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`frame-tag-band${start ? ' is-start' : ''}${end ? ' is-end' : ''}`}
                    style={{ '--tag': t.color, '--tag-text': readableOn(t.color) } as React.CSSProperties}
                    tabIndex={start ? 0 : -1}
                    aria-label={`Tag ${t.name}`}
                    data-tip={`Tag "${t.name}"`}
                    data-tip-hint="Clique para editar nome, quadros, direção e cor."
                    onClick={(e) => {
                      e.stopPropagation();
                      useEditor.getState().openDialog({ type: 'tag', tagId: t.id });
                    }}
                    data-testid={start ? 'tag-band-start' : undefined}
                  >
                    {start ? t.name : ''}
                  </button>
                ))}
              </span>
              <button
                type="button"
                className="frame-select"
                aria-label={`Quadro ${i + 1}, ${f.duration} ms${here.length ? `, tag ${here.map((h) => h.t.name).join(', ')}` : ''}${linked ? ', célula vinculada' : ''}`}
                aria-pressed={isActive}
                onClick={(e) => {
                  e.stopPropagation();
                  pick(e);
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
