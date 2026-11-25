import { Injectable, computed, inject, signal } from '@angular/core';

import { Api, errorMessage } from './api';
import { LabelState, ReviewStatus, VehicleSummary } from './models';
import { Notify } from './notify';

export type GtFilter = 'match' | 'mismatch' | 'missing' | 'invalid';
export type Flag = 'lift' | 'stale' | 'prelabel_updated' | 'error' | 'no_pcd';

/** Chip filters: values within a category are OR-ed, categories are AND-ed; empty = all. */
export interface VehicleFilter {
  search: string;
  review: ReviewStatus[];
  label: LabelState[];
  gt: GtFilter[];
  flag: Flag[];
}

export type FilterCategory = Exclude<keyof VehicleFilter, 'search'>;

/** Allowed values per category, in display order. */
export const FILTER_OPTIONS: { [C in FilterCategory]: readonly VehicleFilter[C][number][] } = {
  review: ['unreviewed', 'ok', 'not_ok'],
  label: ['prelabel_available', 'prelabeled', 'edited', 'none'],
  gt: ['match', 'mismatch', 'missing', 'invalid'],
  flag: ['lift', 'stale', 'prelabel_updated', 'error', 'no_pcd'],
};

export const FILTER_CATEGORIES = Object.keys(FILTER_OPTIONS) as FilterCategory[];

export const EMPTY_FILTER: VehicleFilter = { search: '', review: [], label: [], gt: [], flag: [] };

function gtMatches(v: VehicleSummary, g: GtFilter): boolean {
  if (g === 'mismatch') return v.gt_state === 'count_mismatch' || v.gt_state === 'gap_mismatch';
  return v.gt_state === g;
}

function flagMatches(v: VehicleSummary, f: Flag): boolean {
  switch (f) {
    case 'lift': return v.lift_axle_count > 0;
    case 'stale': return v.stale === true;
    case 'prelabel_updated': return v.prelabel_updated;
    case 'error': return v.error !== null;
    case 'no_pcd': return !v.has_pcd;
  }
}

/** Vehicles without a PCD (label file left over) are hidden unless the `no_pcd` flag is chosen. */
export function matches(v: VehicleSummary, f: VehicleFilter): boolean {
  if (!v.has_pcd && !f.flag.includes('no_pcd')) return false;
  if (f.search && !v.id.toLowerCase().includes(f.search.toLowerCase())) return false;
  if (f.review.length && !f.review.includes(v.review_status)) return false;
  if (f.label.length && !f.label.includes(v.label_state)) return false;
  if (f.gt.length && !f.gt.some((g) => gtMatches(v, g))) return false;
  if (f.flag.length && !f.flag.some((x) => flagMatches(v, x))) return false;
  return true;
}

/** Filter from URL query parameters (comma-separated values; unknown values are dropped). */
export function filterFromParams(get: (key: string) => string | null): VehicleFilter {
  const pick = <C extends FilterCategory>(c: C): VehicleFilter[C] => {
    const allowed = FILTER_OPTIONS[c] as readonly string[];
    const values = (get(c) ?? '').split(',').filter((x) => allowed.includes(x));
    return [...new Set(values)] as VehicleFilter[C];
  };
  return { search: get('search') ?? '', review: pick('review'), label: pick('label'), gt: pick('gt'), flag: pick('flag') };
}

/** URL query parameters for a filter; null removes the parameter. */
export function filterToParams(f: VehicleFilter): Record<string, string | null> {
  const params: Record<string, string | null> = { search: f.search || null };
  for (const c of FILTER_CATEGORIES) params[c] = f[c].join(',') || null;
  return params;
}

@Injectable({ providedIn: 'root' })
export class VehicleStore {
  private readonly api = inject(Api);
  private readonly notify = inject(Notify);

  readonly all = signal<VehicleSummary[]>([]);
  readonly filter = signal<VehicleFilter>(EMPTY_FILTER);
  readonly loading = signal(false);
  readonly filtered = computed(() => {
    const f = this.filter();
    return this.all().filter((v) => matches(v, f));
  });
  readonly withPcd = computed(() => this.all().filter((v) => v.has_pcd).length);
  /** Vehicles without a PCD that the current filter hides. */
  readonly hiddenNoPcd = computed(() =>
    this.filter().flag.includes('no_pcd') ? 0 : this.all().length - this.withPcd(),
  );
  /** Per chip: how many vehicles the filter would show with only that value in its category. */
  readonly facetCounts = computed(() => {
    const f = this.filter();
    const all = this.all();
    const counts = {} as Record<FilterCategory, Record<string, number>>;
    for (const c of FILTER_CATEGORIES) {
      counts[c] = {};
      for (const value of FILTER_OPTIONS[c]) {
        const g = { ...f, [c]: [value] };
        counts[c][value] = all.reduce((n, v) => n + (matches(v, g) ? 1 : 0), 0);
      }
    }
    return counts;
  });

  async refresh(rescan = false): Promise<void> {
    this.loading.set(true);
    try {
      this.all.set(await this.api.vehicles(rescan));
    } catch (err) {
      this.notify.error(`Loading vehicles failed: ${errorMessage(err)}`);
    } finally {
      this.loading.set(false);
    }
  }

  upsert(summary: VehicleSummary): void {
    this.all.update((list) => {
      const i = list.findIndex((v) => v.id === summary.id);
      if (i < 0) return [...list, summary].sort((a, b) => a.id.localeCompare(b.id));
      const copy = list.slice();
      copy[i] = summary;
      return copy;
    });
  }

  /** Neighbour of `id` in the filtered list (wraps to the first entry if `id` is not in it). */
  neighbour(id: string | null, delta: number): string | null {
    const list = this.filtered();
    if (list.length === 0) return null;
    const i = id === null ? -1 : list.findIndex((v) => v.id === id);
    if (i < 0) return list[0].id;
    const j = i + delta;
    return j >= 0 && j < list.length ? list[j].id : null;
  }
}
