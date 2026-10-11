import type { AppInfo, OpenedFile, PixelCraftApi, RecentEntry } from '../shared/ipc';
import { FILE_FILTERS } from '../shared/ipc';

declare global {
  interface Window {
    pixelcraft?: PixelCraftApi;
  }
}

/**
 * Fallback used when the UI runs in a plain browser (e.g. `vite` alone during
 * development): files are picked with <input type=file> and "saved" as
 * downloads. The desktop app always uses the preload API instead.
 */
function browserApi(): PixelCraftApi {
  const files = new Map<string, Uint8Array>();
  const store = new Map<string, unknown>();
  const pick = (accept: string, multiple: boolean): Promise<OpenedFile[]> =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.onchange = async () => {
        const out: OpenedFile[] = [];
        for (const f of Array.from(input.files ?? [])) {
          const data = new Uint8Array(await f.arrayBuffer());
          files.set(f.name, data);
          out.push({ path: f.name, name: f.name, data });
        }
        resolve(out);
      };
      input.click();
    });
  const accept = (kind: keyof typeof FILE_FILTERS): string =>
    FILE_FILTERS[kind].flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
  const download = (name: string, data: Uint8Array): void => {
    const url = URL.createObjectURL(new Blob([data as BlobPart]));
    const a = document.createElement('a');
    a.href = url;
    a.download = name.split('/').pop() ?? name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const info: AppInfo = {
    name: 'PixelCraft',
    version: '0.0.0-web',
    electron: '',
    chrome: navigator.userAgent,
    node: '',
    platform: 'web',
    arch: '',
    packaged: false,
    distribution: 'development',
    paths: { config: '(navegador)', data: '(navegador)', cache: '(navegador)', recovery: '(navegador)' },
  };
  return {
    app: {
      info: async () => info,
      setTitle: (t) => {
        document.title = t;
      },
      toggleFullscreen: async () => {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
        return !!document.fullscreenElement;
      },
      confirmClose: () => undefined,
      onCloseRequest: () => () => undefined,
      onOpenFile: () => () => undefined,
      takeStartupFiles: async () => [],
      openDocs: async () => undefined,
      newWindow: async () => {
        window.open(location.href);
      },
    },
    file: {
      openDialog: async (kind) => (await pick(accept(kind), false))[0] ?? null,
      openManyDialog: async (kind) => pick(accept(kind), true),
      read: async (path) => {
        const data = files.get(path);
        if (!data) throw new Error('Arquivo indisponível nesta sessão do navegador.');
        return { path, name: path, data };
      },
      saveDialog: async (o) => {
        const name = window.prompt('Nome do arquivo', o.defaultName);
        if (!name) return null;
        const ext = o.extensions?.[0] ?? FILE_FILTERS[o.kind][0]?.extensions[0];
        return ext && !name.toLowerCase().endsWith(`.${ext}`) ? `${name}.${ext}` : name;
      },
      write: async (path, data) => {
        files.set(path, data);
        download(path, data);
        return { path, bytes: data.length };
      },
      chooseDirectory: async () => 'downloads',
      writeInDirectory: async (dir, name, data) => {
        download(name, data);
        return { path: `${dir}/${name}`, bytes: data.length };
      },
      showInFolder: async () => undefined,
    },
    recent: {
      list: async () => (store.get('recent') as RecentEntry[] | undefined) ?? [],
      add: async (path, name) => {
        const list = ((store.get('recent') as RecentEntry[] | undefined) ?? []).filter((e) => e.path !== path);
        list.unshift({ path, name, openedAt: new Date().toISOString(), exists: true, thumbnail: null });
        store.set('recent', list.slice(0, 15));
      },
      remove: async (path) => {
        store.set('recent', ((store.get('recent') as RecentEntry[] | undefined) ?? []).filter((e) => e.path !== path));
      },
      clear: async () => {
        store.set('recent', []);
      },
    },
    settings: {
      load: async () => {
        try {
          return JSON.parse(localStorage.getItem('pixelcraft.settings') ?? 'null');
        } catch {
          return null;
        }
      },
      save: async (v) => {
        try {
          localStorage.setItem('pixelcraft.settings', JSON.stringify(v));
        } catch {
          /* storage unavailable */
        }
      },
    },
    palettes: {
      load: async () => store.get('palettes') ?? null,
      save: async (v) => {
        store.set('palettes', v);
      },
    },
    recovery: {
      write: async (id, _m, data) => {
        store.set(`rec:${id}`, data);
      },
      list: async () => [],
      read: async (id) => (store.get(`rec:${id}`) as Uint8Array) ?? new Uint8Array(),
      remove: async (id) => {
        store.delete(`rec:${id}`);
      },
    },
  };
}

export const api: PixelCraftApi = window.pixelcraft ?? browserApi();
export const isDesktop = !!window.pixelcraft;
