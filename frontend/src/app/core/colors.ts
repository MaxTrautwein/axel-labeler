// Point colormaps, the colour scale that maps a point channel onto them, and the canvas palettes per theme.
import { Points, STRIDE } from './models';

export type Theme = 'dark' | 'light';
export type ColorBy = 'x' | 'reflectivity' | 'none';
export type ColormapName = 'viridis' | 'turbo' | 'plasma' | 'gray';

/** How a point channel is mapped onto the colormap. */
export interface ChannelScale {
  /** auto: percentiles of the current vehicle; fixed: the same min/max for every vehicle. */
  mode: 'auto' | 'fixed';
  /** Logarithmic stretch (reflectivity only), for heavy-tailed values such as retroreflectors. */
  log: boolean;
  lowPct: number;
  highPct: number;
  min: number;
  max: number;
}

type Rgb = [number, number, number];

export const LUT_SIZE = 64;

export const COLORMAPS: Record<ColormapName, Rgb[]> = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  turbo: [
    [48, 18, 59], [70, 107, 227], [40, 187, 236], [49, 241, 153], [164, 252, 60],
    [237, 208, 58], [251, 128, 34], [215, 53, 9], [122, 4, 3],
  ],
  plasma: [
    [13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137],
    [219, 92, 104], [244, 136, 73], [254, 188, 43], [240, 249, 33],
  ],
  gray: [[90, 90, 90], [235, 235, 235]],
};

export const COLORMAP_NAMES = Object.keys(COLORMAPS) as ColormapName[];

export function interpolate(stops: Rgb[], t: number): Rgb {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export interface Lut {
  css: string[];
  rgb: Rgb[];
  /** CSS linear-gradient of the map, for colour bars. */
  gradient: string;
}

const lutCache = new Map<string, Lut>();

/** Colour lookup table; cached, so equal arguments give the same object (cheap signal equality). */
export function buildLut(name: ColormapName, reverse = false): Lut {
  const key = `${name}:${reverse}`;
  let lut = lutCache.get(key);
  if (!lut) {
    const stops = reverse ? [...COLORMAPS[name]].reverse() : COLORMAPS[name];
    const rgb = Array.from({ length: LUT_SIZE }, (_, i) => interpolate(stops, i / (LUT_SIZE - 1)));
    const css = rgb.map(([r, g, b]) => `rgb(${r},${g},${b})`);
    const gradient = `linear-gradient(to right, ${css.filter((_, i) => i % 8 === 0 || i === LUT_SIZE - 1).join(', ')})`;
    lut = { css, rgb, gradient };
    lutCache.set(key, lut);
  }
  return lut;
}

export interface PointColoring {
  /** LUT index per point; null = no colouring. */
  index: Uint8Array | null;
  /** Range of the colour bar in channel units. */
  lo: number;
  hi: number;
  log: boolean;
}

const CHANNEL = { x: 0, reflectivity: 3 } as const;

/** Sorted sample (at most `max` values) of one channel. */
export function sampleChannel(p: Points, channel: number, max = 5000): number[] {
  const out: number[] = [];
  const step = Math.max(1, Math.floor(p.count / max));
  for (let i = 0; i < p.count; i += step) out.push(p.data[i * STRIDE + channel]);
  return out.sort((a, b) => a - b);
}

export function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length * pct) / 100)))];
}

/** Percentiles of a channel of the current vehicle, to help choosing a fixed range. */
export function channelStats(p: Points, by: 'x' | 'reflectivity'): { p1: number; p50: number; p99: number; max: number } {
  const s = sampleChannel(p, CHANNEL[by]);
  return {
    p1: percentile(s, 1),
    p50: percentile(s, 50),
    p99: percentile(s, 99),
    max: by === 'x' ? p.bounds.xMax : p.bounds.rMax,
  };
}

export function colorize(p: Points | null, colorBy: ColorBy, scale: ChannelScale, size = LUT_SIZE): PointColoring {
  if (!p || colorBy === 'none') return { index: null, lo: 0, hi: 0, log: false };
  const channel = CHANNEL[colorBy];
  const log = colorBy === 'reflectivity' && scale.log;
  const f = log ? (v: number) => Math.log1p(Math.max(0, v)) : (v: number) => v;
  let lo = scale.min;
  let hi = scale.max;
  if (scale.mode === 'auto') {
    const [bMin, bMax] = colorBy === 'x' ? [p.bounds.xMin, p.bounds.xMax] : [p.bounds.rMin, p.bounds.rMax];
    const sample = scale.lowPct > 0 || scale.highPct < 100 ? sampleChannel(p, channel) : [];
    lo = scale.lowPct <= 0 ? bMin : percentile(sample, scale.lowPct);
    hi = scale.highPct >= 100 ? bMax : percentile(sample, scale.highPct);
  }
  const a = f(lo);
  const span = f(hi) - a || 1;
  const index = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const t = (f(p.data[i * STRIDE + channel]) - a) / span;
    index[i] = Math.max(0, Math.min(size - 1, Math.round(t * (size - 1)))) || 0;
  }
  return { index, lo, hi, log };
}

/** Canvas colours (the HTML around the canvases uses the CSS variables in styles.css). */
export interface Palette {
  background: string;
  grid: string;
  gridLabel: string;
  ground: string;
  filteredOut: string;
  plain: string;
  selected: string;
  axle: string;
  liftAxle: string;
  prelabel: string;
  gt: string;
  histBg: string;
  histBar: string;
  text: string;
}

export const PALETTES: Record<Theme, Palette> = {
  dark: {
    background: '#0d1117',
    grid: 'rgba(139, 148, 158, 0.12)',
    gridLabel: '#6e7681',
    ground: '#6e7681',
    filteredOut: 'rgba(139, 148, 158, 0.18)',
    plain: '#8b949e',
    selected: '#ffffff',
    axle: '#3fb950',
    liftAxle: '#d2a8ff',
    prelabel: '#f0883e',
    gt: '#58a6ff',
    histBg: '#30363d',
    histBar: '#8b949e',
    text: '#8b949e',
  },
  light: {
    background: '#ffffff',
    grid: 'rgba(31, 35, 40, 0.10)',
    gridLabel: '#6e7781',
    ground: '#8c959f',
    filteredOut: 'rgba(140, 149, 159, 0.30)',
    plain: '#57606a',
    selected: '#0d1117',
    axle: '#1a7f37',
    liftAxle: '#8250df',
    prelabel: '#bc4c00',
    gt: '#0969da',
    histBg: '#eaeef2',
    histBar: '#57606a',
    text: '#57606a',
  },
};
