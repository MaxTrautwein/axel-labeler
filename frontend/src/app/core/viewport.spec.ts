import { Viewport } from './viewport';

describe('Viewport', () => {
  it('round-trips world and screen coordinates', () => {
    const vp = new Viewport();
    vp.fit(0, 10, 0, 2, 1000, 400);
    const [sx, sy] = vp.toScreen(3, 1);
    const [u, v] = vp.toWorld(sx, sy);
    expect(u).toBeCloseTo(3);
    expect(v).toBeCloseTo(1);
  });

  it('keeps the point under the cursor while zooming', () => {
    const vp = new Viewport();
    vp.fit(0, 10, 0, 2, 1000, 400);
    const before = vp.toWorld(250, 120);
    vp.zoomAt(250, 120, 2.5);
    const after = vp.toWorld(250, 120);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('uses v up (larger v is higher on screen)', () => {
    const vp = new Viewport();
    vp.fit(0, 1, 0, 1, 100, 100);
    expect(vp.toScreen(0, 1)[1]).toBeLessThan(vp.toScreen(0, 0)[1]);
  });
});
