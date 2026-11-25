import { compareGt, gtPositions, parseAxleSpace } from './gt';

describe('ground truth', () => {
  it('parses verbatim axle_space strings', () => {
    expect(parseAxleSpace('0;411;133')).toEqual([0, 411, 133]);
    expect(parseAxleSpace(' 0 ; 360.5 ;')).toEqual([0, 360.5]);
    for (const bad of ['', ';', 'a;b', '3,5;2']) expect(parseAxleSpace(bad)).toBeNull();
  });

  it('compares like the backend', () => {
    const ys = [9.13, 5.02, 3.69];
    expect(compareGt('0;411;133', ys, 0.1).state).toBe('match');
    expect(compareGt('0;411;133', [...ys].reverse(), 0.1).state).toBe('match');
    expect(compareGt('0;411;150', ys, 0.1).state).toBe('gap_mismatch');
    expect(compareGt('0;411', ys, 0.1).state).toBe('count_mismatch');
    expect(compareGt('x', ys, 0.1).state).toBe('invalid');
    expect(compareGt(null, ys, 0.1).state).toBe('missing');
    const rows = compareGt('0;411;150', ys, 0.1).rows;
    expect(rows.map((r) => r.ok)).toEqual([true, false]);
    expect(rows[1].deltaM).toBeCloseTo(1.33 - 1.5);
  });

  it('places GT axles behind the anchor', () => {
    const p = gtPositions(10, [0, 400, 130]);
    expect(p[0]).toBe(10);
    expect(p[1]).toBeCloseTo(6);
    expect(p[2]).toBeCloseTo(4.7);
  });

  it('places GT axles around an anchor further back', () => {
    const p = gtPositions(6, [0, 400, 130], 1);
    expect(p[0]).toBeCloseTo(10);
    expect(p[1]).toBe(6);
    expect(p[2]).toBeCloseTo(4.7);
  });
});
