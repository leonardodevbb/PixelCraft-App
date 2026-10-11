import { EditorSession } from '../../editor/session';
import { createDocument, documentFromFrames, type NewDocumentOptions } from '../../project/create';
import { LIMITS } from '../../project/limits';
import { celKey, type ProjectDocument } from '../../project/model';
import { deserializeProject, ProjectFormatError, serializeProject } from '../../project/serialize';
import { composeFrame } from '../../layers/compose';
import { decodeImage, sniffImageType } from '../../import-export/browser-decode';
import { decodeGif } from '../../import-export/gif';
import { encodePng } from '../../import-export/png';
import { resizeNearest } from '../../raster/scale';
import { newId } from '../../project/ids';
import { api } from '../api';
import { confirmDialog, useEditor } from '../state/editor-store';
import { usePrefs } from '../state/preferences';

export const GENERATOR = `PixelCraft ${__APP_VERSION__}`;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function activate(doc: ProjectDocument, filePath: string | null, opts: { dirty?: boolean } = {}): EditorSession {
  const session = new EditorSession(doc, { historyBytes: usePrefs.getState().prefs.historyMB * 1024 * 1024 });
  session.filePath = filePath;
  if (opts.dirty) session.markUnsaved();
  useEditor.getState().setSession(session);
  return session;
}

/** Asks what to do with unsaved changes. Returns false if the user cancelled. */
export async function confirmDiscard(action = 'continuar'): Promise<boolean> {
  const s = useEditor.getState().session;
  if (!s || !s.isDirty) return true;
  const choice = await confirmDialog({
    title: 'Alterações não salvas',
    message: `"${s.doc.name}" tem alterações que não foram salvas. Deseja salvar antes de ${action}?`,
    confirmLabel: 'Salvar',
    altLabel: 'Descartar alterações',
    cancelLabel: 'Cancelar',
  });
  if (choice === 'cancel') return false;
  if (choice === 'confirm') return save();
  return true;
}

export async function newProject(opts: NewDocumentOptions): Promise<void> {
  if (!(await confirmDiscard('criar um novo projeto'))) return;
  const s = useEditor.getState().session;
  if (s) await discardRecovery(s);
  activate(createDocument(opts), null);
}

export async function closeProject(): Promise<void> {
  const s = useEditor.getState().session;
  if (!s) return;
  if (!(await confirmDiscard('fechar o projeto'))) return;
  await discardRecovery(s);
  useEditor.getState().setSession(null);
}

export async function openProjectDialog(): Promise<void> {
  if (!(await confirmDiscard('abrir outro projeto'))) return;
  try {
    const file = await api.file.openDialog('project', 'Abrir projeto');
    if (file) await openBytes(file.path, file.name, file.data);
  } catch (e) {
    useEditor.getState().toast('error', `Não foi possível abrir o arquivo. ${errorMessage(e)}`);
  }
}

export async function openPath(path: string): Promise<void> {
  if (!(await confirmDiscard('abrir outro projeto'))) return;
  try {
    const file = await api.file.read(path);
    await openBytes(file.path, file.name, file.data);
  } catch (e) {
    useEditor.getState().toast('error', `Não foi possível abrir "${baseName(path)}". ${errorMessage(e)}`);
  }
}

/** Opens a project file or an image (as a new project). */
export async function openBytes(path: string, name: string, data: Uint8Array): Promise<void> {
  const store = useEditor.getState();
  const prev = store.session;
  store.setBusy('Abrindo…');
  try {
    if (sniffImageType(data) === 'gif') {
      const frames = decodeGif(data, { maxPixels: LIMITS.maxPixels, maxFrames: LIMITS.maxFrames });
      if (frames.length > 1) {
        const first = frames[0]!.image;
        if (first.width > LIMITS.maxDimension || first.height > LIMITS.maxDimension) throw new Error(`A imagem excede ${LIMITS.maxDimension}×${LIMITS.maxDimension} pixels.`);
        const doc = documentFromFrames(stripExt(name), frames.map((f) => ({ image: f.image, duration: f.delayMs })));
        if (prev) await discardRecovery(prev);
        activate(doc, null, { dirty: true });
        store.toast('success', `GIF "${name}" aberto com ${frames.length} quadros (${first.width}×${first.height}).`);
        return;
      }
    }
    if (sniffImageType(data)) {
      const img = await decodeImage(data, LIMITS.maxPixels);
      if (img.width > LIMITS.maxDimension || img.height > LIMITS.maxDimension) {
        throw new Error(`A imagem excede ${LIMITS.maxDimension}×${LIMITS.maxDimension} pixels.`);
      }
      const doc = createDocument({ width: img.width, height: img.height, name: stripExt(name) });
      const id = newId('I');
      doc.images.set(id, img);
      const layer = doc.state.layers[0]!;
      doc.state = { ...doc.state, cels: { [celKey(layer.id, doc.state.frames[0]!.id)]: id } };
      if (prev) await discardRecovery(prev);
      // An imported image has no project file yet: saving asks for a location.
      activate(doc, null, { dirty: true });
      store.toast('success', `Imagem "${name}" aberta como novo projeto (${img.width}×${img.height}).`);
      return;
    }
    const doc = deserializeProject(data);
    if (prev) await discardRecovery(prev);
    activate(doc, path);
    await rememberRecent(path, doc);
  } catch (e) {
    const msg = e instanceof ProjectFormatError ? e.message : errorMessage(e);
    store.toast('error', `Não foi possível abrir "${name}". ${msg}`);
  } finally {
    store.setBusy(null);
  }
}

export function thumbnailPng(doc: ProjectDocument, max = 96): Uint8Array | null {
  const f = doc.state.frames[0];
  if (!f) return null;
  let img = composeFrame(doc.state, (id) => doc.images.get(id), f.id, { exportOnly: true });
  const scale = Math.min(max / img.width, max / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  if (w !== img.width || h !== img.height) img = resizeNearest(img, w, h);
  return encodePng(img);
}

async function rememberRecent(path: string, doc: ProjectDocument): Promise<void> {
  try {
    await api.recent.add(path, doc.name, thumbnailPng(doc));
  } catch {
    /* the recent list is a convenience */
  }
}

/**
 * Serializes, verifies the bytes decode back to the same pixels, then writes
 * atomically. A failure leaves the previous file untouched and is reported.
 */
async function writeProject(s: EditorSession, path: string): Promise<boolean> {
  const store = useEditor.getState();
  store.setBusy('Salvando…');
  try {
    const bytes = serializeProject(s.doc, { generator: GENERATOR });
    const check = deserializeProject(bytes);
    for (const id of Object.values(s.state.cels)) {
      const a = s.doc.images.get(id);
      const b = check.images.get(id);
      if (!a || !b || !a.equals(b)) throw new Error('A verificação do arquivo gerado falhou; nada foi gravado.');
    }
    await api.file.write(path, bytes);
    s.filePath = path;
    s.markSaved();
    store.bump();
    await rememberRecent(path, s.doc);
    await discardRecovery(s);
    store.toast('success', `Projeto salvo em ${baseName(path)}.`);
    return true;
  } catch (e) {
    store.toast('error', `Falha ao salvar: ${errorMessage(e)} Suas alterações continuam abertas no editor.`);
    return false;
  } finally {
    store.setBusy(null);
  }
}

export async function save(): Promise<boolean> {
  const s = useEditor.getState().session;
  if (!s) return false;
  if (!s.filePath) return saveAs();
  return writeProject(s, s.filePath);
}

export async function saveAs(): Promise<boolean> {
  const s = useEditor.getState().session;
  if (!s) return false;
  const path = await api.file.saveDialog({ kind: 'project', defaultName: `${s.doc.name}.pixelcraft`, title: 'Salvar projeto como' });
  if (!path) return false;
  const name = stripExt(baseName(path));
  if (name && name !== s.doc.name) s.doc.name = name;
  return writeProject(s, path);
}

/* ---------- autosave / recovery ---------- */

export async function discardRecovery(s: EditorSession): Promise<void> {
  await api.recovery.remove(s.doc.id).catch(() => undefined);
}

let lastAutosaveRevision = -1;

/** Writes a recovery copy if the document changed since the last one. */
export async function autosave(): Promise<void> {
  const s = useEditor.getState().session;
  if (!s || !s.isDirty || s.draft || s.revision === lastAutosaveRevision) return;
  try {
    const bytes = serializeProject(s.doc, { generator: GENERATOR, thumbnail: false });
    await api.recovery.write(s.doc.id, { name: s.doc.name, originalPath: s.filePath }, bytes);
    lastAutosaveRevision = s.revision;
  } catch (e) {
    console.error('Autosave falhou', e);
    useEditor.getState().toast('error', `O salvamento automático falhou: ${errorMessage(e)}`);
  }
}

export async function restoreRecovery(id: string, originalPath: string | null): Promise<void> {
  if (!(await confirmDiscard('recuperar outro projeto'))) return;
  try {
    const doc = deserializeProject(await api.recovery.read(id));
    activate(doc, originalPath, { dirty: true });
    useEditor.getState().toast('success', `"${doc.name}" foi recuperado. Salve para manter as alterações.`);
  } catch (e) {
    useEditor.getState().toast('error', `A cópia de recuperação não pôde ser lida: ${errorMessage(e)}`);
  }
}

/** Called when the window is about to close. */
export async function handleCloseRequest(): Promise<void> {
  if (await confirmDiscard('sair')) {
    const s = useEditor.getState().session;
    if (s && !s.isDirty) await discardRecovery(s);
    api.app.confirmClose();
  }
}
