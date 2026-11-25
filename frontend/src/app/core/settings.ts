import { Injectable, computed, effect, signal } from '@angular/core';

import { COLORMAP_NAMES, ChannelScale, ColorBy, ColormapName, PALETTES, Theme, buildLut } from './colors';

export interface ViewSettings {
  theme: Theme;
  colormap: ColormapName;
  reverseColormap: boolean;
  colorBy: ColorBy;
  scales: { x: ChannelScale; reflectivity: ChannelScale };
  /** Multiplier on the adaptive point size. */
  pointSize: number;
  showPrelabel: boolean;
  leftCollapsed: boolean;
  bottomTab: 'section' | '3d';
}

export type ScaleChannel = keyof ViewSettings['scales'];

export const BUILTIN_SETTINGS: ViewSettings = {
  theme: 'dark',
  colormap: 'viridis',
  reverseColormap: false,
  colorBy: 'x',
  scales: {
    x: { mode: 'auto', log: false, lowPct: 0, highPct: 100, min: 0, max: 3 },
    reflectivity: { mode: 'auto', log: true, lowPct: 1, highPct: 99, min: 0, max: 500 },
  },
  pointSize: 1,
  showPrelabel: false,
  leftCollapsed: false,
  bottomTab: 'section',
};

export const STORAGE_KEY = 'axel-labler.view-settings.v1';

function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

type Raw = Record<string, unknown> | undefined;

function parseScale(raw: Raw, d: ChannelScale): ChannelScale {
  return {
    mode: oneOf(raw?.['mode'], ['auto', 'fixed'] as const, d.mode),
    log: bool(raw?.['log'], d.log),
    lowPct: num(raw?.['lowPct'], d.lowPct, 0, 100),
    highPct: num(raw?.['highPct'], d.highPct, 0, 100),
    min: num(raw?.['min'], d.min),
    max: num(raw?.['max'], d.max),
  };
}

/** Stored JSON merged field by field over the built-in defaults; invalid values fall back. */
export function parseSettings(raw: unknown): ViewSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const scales = r['scales'] as Record<string, Raw> | undefined;
  const d = BUILTIN_SETTINGS;
  return {
    theme: oneOf(r['theme'], ['dark', 'light'] as const, d.theme),
    colormap: oneOf(r['colormap'], COLORMAP_NAMES, d.colormap),
    reverseColormap: bool(r['reverseColormap'], d.reverseColormap),
    colorBy: oneOf(r['colorBy'], ['x', 'reflectivity', 'none'] as const, d.colorBy),
    scales: {
      x: parseScale(scales?.['x'], d.scales.x),
      reflectivity: parseScale(scales?.['reflectivity'], d.scales.reflectivity),
    },
    pointSize: num(r['pointSize'], d.pointSize, 0.25, 5),
    showPrelabel: bool(r['showPrelabel'], d.showPrelabel),
    leftCollapsed: bool(r['leftCollapsed'], d.leftCollapsed),
    bottomTab: oneOf(r['bottomTab'], ['section', '3d'] as const, d.bottomTab),
  };
}

function load(): ViewSettings {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return parseSettings(text ? JSON.parse(text) : null);
  } catch {
    return parseSettings(null);
  }
}

function withScale(s: ViewSettings, channel: ScaleChannel, patch: Partial<ChannelScale>): ViewSettings {
  return { ...s, scales: { ...s.scales, [channel]: { ...s.scales[channel], ...patch } } };
}

/**
 * View settings, stored per browser. `defaults` is what the settings page edits (persisted);
 * `view` is the live state of this session, changed by the toolbar and saved as default on request.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  readonly defaults = signal<ViewSettings>(load());
  readonly view = signal<ViewSettings>(this.defaults());
  readonly modified = computed(() => JSON.stringify(this.view()) !== JSON.stringify(this.defaults()));
  readonly palette = computed(() => PALETTES[this.view().theme]);
  readonly lut = computed(() => buildLut(this.view().colormap, this.view().reverseColormap));

  constructor() {
    effect(() => {
      document.documentElement.dataset['bsTheme'] = this.view().theme;
    });
  }

  /** Change the live view only (until saved as default). */
  patchView(p: Partial<ViewSettings>): void {
    this.view.update((v) => ({ ...v, ...p }));
  }

  /** Change a default; it applies to the live view as well. */
  patchDefaults(p: Partial<ViewSettings>): void {
    this.defaults.update((d) => ({ ...d, ...p }));
    this.view.update((v) => ({ ...v, ...p }));
    this.persist();
  }

  patchDefaultScale(channel: ScaleChannel, p: Partial<ChannelScale>): void {
    this.defaults.update((d) => withScale(d, channel, p));
    this.view.update((v) => withScale(v, channel, p));
    this.persist();
  }

  saveViewAsDefault(): void {
    this.defaults.set(this.view());
    this.persist();
  }

  resetView(): void {
    this.view.set(this.defaults());
  }

  resetDefaults(): void {
    this.defaults.set(BUILTIN_SETTINGS);
    this.view.set(BUILTIN_SETTINGS);
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.defaults()));
    } catch {
      // storage unavailable (private window, blocked): settings last for this session only
    }
  }
}
