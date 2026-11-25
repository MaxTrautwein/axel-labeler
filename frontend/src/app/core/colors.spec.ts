import { ChannelScale, LUT_SIZE, buildLut, colorize, percentile } from './colors';
import { Points, STRIDE } from './models';

function cloud(values: { x?: number; r?: number }[]): Points {
  const data = new Float32Array(values.length * STRIDE);
  values.forEach((v, i) => {
    data[i * STRIDE] = v.x ?? 0;
    data[i * STRIDE + 3] = v.r ?? 0;
  });
  const xs = values.map((v) => v.x ?? 0);
  const rs = values.map((v) => v.r ?? 0);
  return {
    data,
    count: values.length,
    bounds: {
      xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: 0, yMax: 1, zMin: 0, zMax: 1,
      rMin: Math.min(...rs), rMax: Math.max(...rs),
    },
  };
}

const AUTO: ChannelScale = { mode: 'auto', log: false, lowPct: 0, highPct: 100, min: 0, max: 1 };

describe('colorize', () => {
  it('stretches x over the vehicle bounds in auto mode', () => {
    const c = colorize(cloud([{ x: 0 }, { x: 1 }, { x: 2 }]), 'x', AUTO);
    expect([...c.index!]).toEqual([0, Math.round((LUT_SIZE - 1) / 2), LUT_SIZE - 1]);
    expect([c.lo, c.hi]).toEqual([0, 2]);
  });

  it('clamps to a fixed range, the same for every vehicle', () => {
    const fixed: ChannelScale = { ...AUTO, mode: 'fixed', min: 1, max: 2 };
    const c = colorize(cloud([{ x: 0 }, { x: 1.5 }, { x: 5 }]), 'x', fixed);
    expect(c.index![0]).toBe(0);
    expect(c.index![2]).toBe(LUT_SIZE - 1);
    expect([c.lo, c.hi]).toEqual([1, 2]);
  });

  it('keeps typical reflectivity apart from retroreflectors with the log stretch', () => {
    // median ~36, a few percent at several thousand (like vehicle 73f25491)
    const values = [
      ...Array.from({ length: 95 }, (_, i) => ({ r: 4 + i })),
      ...Array.from({ length: 5 }, () => ({ r: 5000 })),
    ];
    const scale: ChannelScale = { ...AUTO, lowPct: 1, highPct: 99 };
    const median = 50;
    const linear = colorize(cloud(values), 'reflectivity', scale).index![median];
    const log = colorize(cloud(values), 'reflectivity', { ...scale, log: true }).index![median];
    expect(linear).toBeLessThan(2);
    expect(log).toBeGreaterThan(LUT_SIZE / 4);
  });

  it('returns no colours for "none" or no points', () => {
    expect(colorize(cloud([{ x: 1 }]), 'none', AUTO).index).toBeNull();
    expect(colorize(null, 'x', AUTO).index).toBeNull();
  });

  it('uses nearest-rank percentiles', () => {
    const s = Array.from({ length: 100 }, (_, i) => i);
    expect(percentile(s, 0)).toBe(0);
    expect(percentile(s, 50)).toBe(50);
    expect(percentile(s, 100)).toBe(99);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('buildLut', () => {
  it('reverses and caches', () => {
    const a = buildLut('viridis');
    const r = buildLut('viridis', true);
    expect(r.css[0]).toBe(a.css[LUT_SIZE - 1]);
    expect(buildLut('viridis')).toBe(a);
  });
});
