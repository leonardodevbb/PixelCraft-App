import { useEffect, useRef } from 'react';
import { composeFrame } from '../../layers/compose';
import { useEditor } from '../../renderer/state/editor-store';
import { Section } from '../controls';

/** Live preview of the current frame at an integer scale that fits the panel. */
export function PreviewPanel() {
  const ref = useRef<HTMLCanvasElement>(null);
  const session = useEditor((s) => s.session);
  useEffect(() => {
    if (!session) return;
    const canvas = ref.current!;
    let raf = 0;
    const draw = (): void => {
      raf = 0;
      const { width, height } = session.state;
      const max = 200;
      const scale = Math.max(1, Math.floor(Math.min(max / width, max / height)));
      const w = Math.min(max, width * scale);
      const h = Math.min(max, height * scale);
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const draft = session.draft;
      const buf = composeFrame(session.state, session.lookup, session.activeFrameId, {
        overrides: draft && draft.frameId === session.activeFrameId ? new Map([[draft.key, draft.buffer]]) : undefined,
      });
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf.data), width, height), 0, 0);
    };
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    schedule();
    const unsub = session.subscribe(schedule);
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [session]);
  if (!session) return null;
  return (
    <Section title="Pré-visualização">
      <div className="preview-box checker">
        <canvas ref={ref} className="pixelated" aria-label="Pré-visualização do sprite" />
      </div>
    </Section>
  );
}
