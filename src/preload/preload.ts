import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PixelCraftApi } from '../shared/ipc';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function listen(channel: string, cb: (...args: unknown[]) => void): () => void {
  const fn = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

const api: PixelCraftApi = {
  app: {
    info: () => invoke(IPC.appInfo),
    setTitle: (t) => ipcRenderer.send(IPC.setTitle, t),
    toggleFullscreen: () => invoke(IPC.toggleFullscreen),
    confirmClose: () => ipcRenderer.send(IPC.confirmClose),
    onCloseRequest: (cb) => listen(IPC.closeRequest, () => cb()),
    onOpenFile: (cb) => listen(IPC.openFileEvent, (p) => typeof p === 'string' && cb(p)),
    takeStartupFiles: () => invoke(IPC.startupFiles),
    openDocs: (page) => invoke(IPC.openDocs, page),
    newWindow: () => invoke(IPC.newWindow),
  },
  file: {
    openDialog: (kind, title) => invoke(IPC.openDialog, kind, title),
    openManyDialog: (kind, title) => invoke(IPC.openManyDialog, kind, title),
    read: (path) => invoke(IPC.read, path),
    saveDialog: (opts) => invoke(IPC.saveDialog, opts),
    write: (path, data) => invoke(IPC.write, path, data),
    chooseDirectory: (title) => invoke(IPC.chooseDirectory, title),
    writeInDirectory: (dir, name, data) => invoke(IPC.writeInDirectory, dir, name, data),
    showInFolder: (path) => invoke(IPC.showInFolder, path),
  },
  recent: {
    list: () => invoke(IPC.recentList),
    add: (path, name, thumb) => invoke(IPC.recentAdd, path, name, thumb),
    remove: (path) => invoke(IPC.recentRemove, path),
    clear: () => invoke(IPC.recentClear),
  },
  settings: {
    load: () => invoke(IPC.settingsLoad),
    save: (v) => invoke(IPC.settingsSave, v),
  },
  palettes: {
    load: () => invoke(IPC.palettesLoad),
    save: (v) => invoke(IPC.palettesSave, v),
  },
  recovery: {
    write: (id, meta, data) => invoke(IPC.recoveryWrite, id, meta, data),
    list: () => invoke(IPC.recoveryList),
    read: (id) => invoke(IPC.recoveryRead, id),
    remove: (id) => invoke(IPC.recoveryRemove, id),
  },
};

contextBridge.exposeInMainWorld('pixelcraft', api);
