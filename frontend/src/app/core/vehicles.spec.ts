import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { VehicleSummary } from './models';
import { EMPTY_FILTER, VehicleFilter, VehicleStore, filterFromParams, filterToParams, matches } from './vehicles';

function vehicle(id: string, p: Partial<VehicleSummary> = {}): VehicleSummary {
  return {
    id, has_pcd: true, has_prelabel: false, axle_count: 2, lift_axle_count: 0, label_state: 'edited',
    prelabel_updated: false, review_status: 'unreviewed', gt_state: 'missing', stale: null,
    updated_at: null, error: null, ...p,
  };
}

const f = (p: Partial<VehicleFilter>): VehicleFilter => ({ ...EMPTY_FILTER, ...p });

describe('vehicle filter', () => {
  it('ORs values within a category and ANDs the categories', () => {
    const ok = vehicle('a', { review_status: 'ok', gt_state: 'match' });
    const bad = vehicle('b', { review_status: 'not_ok', gt_state: 'gap_mismatch' });
    const open = vehicle('c', { gt_state: 'count_mismatch' });
    const either = f({ review: ['ok', 'not_ok'] });
    expect([ok, bad, open].filter((v) => matches(v, either)).map((v) => v.id)).toEqual(['a', 'b']);
    const mismatch = f({ gt: ['mismatch'] });
    expect([ok, bad, open].filter((v) => matches(v, mismatch)).map((v) => v.id)).toEqual(['b', 'c']);
    const both = f({ review: ['ok', 'not_ok'], gt: ['mismatch'] });
    expect([ok, bad, open].filter((v) => matches(v, both)).map((v) => v.id)).toEqual(['b']);
    expect(matches(ok, EMPTY_FILTER)).toBe(true);
  });

  it('hides vehicles without a PCD unless the no_pcd flag is chosen', () => {
    const orphan = vehicle('x', { has_pcd: false, lift_axle_count: 1 });
    expect(matches(orphan, EMPTY_FILTER)).toBe(false);
    expect(matches(orphan, f({ flag: ['lift'] }))).toBe(false);
    expect(matches(orphan, f({ flag: ['no_pcd'] }))).toBe(true);
    expect(matches(vehicle('y'), f({ flag: ['no_pcd'] }))).toBe(false);
    expect(matches(vehicle('y', { lift_axle_count: 1 }), f({ flag: ['no_pcd', 'lift'] }))).toBe(true);
  });

  it('round-trips through URL parameters and drops unknown values', () => {
    const filter = f({ search: 'ab', review: ['unreviewed', 'not_ok'], flag: ['no_pcd'] });
    const params = filterToParams(filter);
    expect(params).toEqual({ search: 'ab', review: 'unreviewed,not_ok', label: null, gt: null, flag: 'no_pcd' });
    expect(filterFromParams((k) => params[k] ?? null)).toEqual(filter);
    const old = { label: 'labeled', gt: 'match,nope,match', review: '' } as Record<string, string>;
    expect(filterFromParams((k) => old[k] ?? null)).toEqual(f({ gt: ['match'] }));
  });
});

describe('VehicleStore', () => {
  let store: VehicleStore;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    store = TestBed.inject(VehicleStore);
    store.all.set([
      vehicle('a', { review_status: 'ok' }),
      vehicle('b', { has_pcd: false }),
      vehicle('c'),
      vehicle('d', { has_pcd: false, review_status: 'ok' }),
    ]);
  });

  it('navigates over the visible vehicles only', () => {
    expect(store.filtered().map((v) => v.id)).toEqual(['a', 'c']);
    expect(store.neighbour('a', 1)).toBe('c');
    expect(store.neighbour('c', -1)).toBe('a');
    expect(store.neighbour('c', 1)).toBeNull();
    expect(store.neighbour(null, 1)).toBe('a');
  });

  it('counts hidden vehicles and facets', () => {
    expect(store.withPcd()).toBe(2);
    expect(store.hiddenNoPcd()).toBe(2);
    expect(store.facetCounts().review['ok']).toBe(1);
    expect(store.facetCounts().flag['no_pcd']).toBe(2);
    store.filter.set(f({ flag: ['no_pcd'] }));
    expect(store.hiddenNoPcd()).toBe(0);
    expect(store.filtered().map((v) => v.id)).toEqual(['b', 'd']);
    expect(store.facetCounts().review['ok']).toBe(1);
  });
});
