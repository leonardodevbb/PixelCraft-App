import { z } from 'zod';
import { create } from 'zustand';
import { api } from '../api';

export const preferencesSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).catch('dark'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).catch('#ff7a3d'),
  density: z.enum(['compact', 'comfortable']).catch('comfortable'),
  pixelGrid: z.boolean().catch(true),
  pixelGridMinZoom: z.number().min(2).max(64).catch(8),
  gridColor: z.string().max(40).catch('rgba(255,255,255,0.16)'),
  tileGrid: z.boolean().catch(false),
  tileGridColor: z.string().max(40).catch('rgba(46,196,182,0.55)'),
  checkerA: z.string().max(40).catch('#3a3646'),
  checkerB: z.string().max(40).catch('#2c2936'),
  checkerSize: z.number().int().min(2).max(64).catch(8),
  /** Seconds between autosaves of unsaved work; 0 disables. */
  autosaveSeconds: z.number().int().min(0).max(3600).catch(60),
  /** Undo memory budget in MiB. */
  historyMB: z.number().int().min(16).max(4096).catch(256),
  defaultExportScale: z.number().int().min(1).max(64).catch(1),
  showSymmetryAxes: z.boolean().catch(true),
  showTutorial: z.boolean().catch(true),
  shortcuts: z.record(z.string(), z.array(z.string().max(40)).max(4)).catch({}),
  panels: z
    .object({
      right: z.boolean(),
      timeline: z.boolean(),
      rightWidth: z.number().min(200).max(600),
      timelineHeight: z.number().min(90).max(500),
    })
    .catch({ right: true, timeline: true, rightWidth: 280, timelineHeight: 150 }),
  onion: z
    .object({
      enabled: z.boolean(),
      before: z.number().int().min(0).max(5),
      after: z.number().int().min(0).max(5),
      opacity: z.number().min(0.05).max(1),
    })
    .catch({ enabled: false, before: 1, after: 1, opacity: 0.4 }),
  zoomWheelStep: z.enum(['levels', 'smooth']).catch('levels'),
  recentColors: z.array(z.number().int().min(0).max(0xffffffff)).max(32).catch([]),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = preferencesSchema.parse({});

interface PrefStore {
  prefs: Preferences;
  loaded: boolean;
  load(): Promise<void>;
  set(patch: Partial<Preferences>): void;
  reset(): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(p: Preferences): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void api.settings.save(p).catch((e) => console.error('Falha ao salvar preferências', e));
  }, 300);
}

export const usePrefs = create<PrefStore>((set, get) => ({
  prefs: DEFAULT_PREFERENCES,
  loaded: false,
  async load() {
    try {
      const raw = await api.settings.load();
      const parsed = preferencesSchema.safeParse(raw ?? {});
      set({ prefs: parsed.success ? parsed.data : DEFAULT_PREFERENCES, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  set(patch) {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    persist(prefs);
  },
  reset() {
    set({ prefs: DEFAULT_PREFERENCES });
    persist(DEFAULT_PREFERENCES);
  },
}));
