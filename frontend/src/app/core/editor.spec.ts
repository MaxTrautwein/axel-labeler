import { normalizeAxle, round4, snapToGt } from './editor';
import { EditAxle } from './models';

describe('normalizeAxle', () => {
  const base = { type: 'axle' as const, y: 1, z: 0.5, radius: 0.5, x_min: 1.6, x_max: 2.0, prelabel_index: null };

  it('rounds like the server', () => {
    expect(round4(1.234567)).toBe(1.2346);
    expect(normalizeAxle({ ...base, y: 1.234567 }).y).toBe(1.2346);
  });

  it('keeps the axle valid', () => {
    const a = normalizeAxle({ ...base, radius: -1, z: -2, x_min: 2.5, x_max: 2.0 });
    expect(a.radius).toBeGreaterThan(0);
    expect(a.z).toBeGreaterThan(0);
    expect(a.x_min).toBeLessThan(a.x_max);
  });
});

describe('snapToGt', () => {
  const axle = (key: number, y: number, type: EditAxle['type'] = 'axle'): EditAxle => ({
    key, type, y, z: 0.5 + key / 100, radius: 0.5, x_min: 1.6, x_max: 2.0, prelabel_index: null,
  });
  const gt = [0, 400, 130];
  const ys = (axles: EditAxle[]) => Object.fromEntries(axles.map((a) => [a.key, a.y]));

  it('moves the other regular axles onto the GT spacing around the anchor', () => {
    const axles = [axle(1, 10.2), axle(2, 6), axle(3, 4.5), axle(4, 8, 'lift_axle'), axle(5, 2)];
    const out = snapToGt(axles, 2, gt)!;
    expect(ys(out)).toEqual({ 1: 10, 2: 6, 3: 4.7, 4: 8, 5: 2 });
    expect(out[1]).toBe(axles[1]);
    expect(out[0].z).toBe(axles[0].z);
    expect(out[0].x_min).toBe(1.6);
  });

  it('needs a regular anchor with a GT position', () => {
    const axles = [axle(1, 10), axle(2, 6), axle(3, 4.5), axle(4, 3), axle(5, 8, 'lift_axle')];
    expect(snapToGt(axles, 5, gt)).toBeNull();
    expect(snapToGt(axles, 4, gt)).toBeNull();
    expect(snapToGt(axles, 9, gt)).toBeNull();
  });

  it('takes the rank from the state before the edit', () => {
    const before = [axle(1, 10), axle(2, 6), axle(3, 4.7)];
    const dragged = [axle(1, 10), axle(2, 11), axle(3, 4.7)];
    expect(ys(snapToGt(dragged, 2, gt, before)!)).toEqual({ 1: 15, 2: 11, 3: 9.7 });
  });
});
