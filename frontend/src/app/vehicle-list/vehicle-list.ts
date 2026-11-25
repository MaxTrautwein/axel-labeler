import { Component, ElementRef, effect, inject, input, output } from '@angular/core';

import { VehicleSummary } from '../core/models';
import {
  EMPTY_FILTER,
  FILTER_CATEGORIES,
  FILTER_OPTIONS,
  FilterCategory,
  VehicleFilter,
  VehicleStore,
} from '../core/vehicles';

interface Chip {
  text: string;
  /** colour class, the same as the matching badge in the list */
  tone: string;
  title: string;
}

const CATEGORY_LABEL: Record<FilterCategory, string> = { review: 'Review', label: 'Labels', gt: 'GT', flag: 'Flags' };

const CHIPS: Record<string, Chip> = {
  'review:unreviewed': { text: '• unrev.', tone: 'r-unreviewed', title: 'not reviewed yet' },
  'review:ok': { text: '✓ OK', tone: 'r-ok', title: 'reviewed: OK' },
  'review:not_ok': { text: '✗ not OK', tone: 'r-not_ok', title: 'reviewed: not OK' },
  'label:prelabel_available': { text: 'P', tone: 'l-prelabel_available', title: 'prelabel available, not imported yet' },
  'label:prelabeled': { text: 'pre', tone: 'l-prelabeled', title: 'prelabel imported, untouched' },
  'label:edited': { text: 'ed', tone: 'l-edited', title: 'edited or labeled by hand' },
  'label:none': { text: 'none', tone: '', title: 'no labels and no prelabel' },
  'gt:match': { text: 'match', tone: 'gt-match', title: 'regular axles match the ground truth' },
  'gt:mismatch': { text: '≠', tone: 'gt-mismatch', title: 'axle count or gaps differ from the ground truth' },
  'gt:missing': { text: 'missing', tone: '', title: 'no ground truth' },
  'gt:invalid': { text: 'invalid', tone: 'gt-invalid', title: 'ground truth cannot be interpreted' },
  'flag:lift': { text: 'L lift', tone: 't-lift', title: 'has a lift axle' },
  'flag:stale': { text: 'stale', tone: 't-warn', title: 'the PCD changed since it was labeled' },
  'flag:prelabel_updated': { text: 'new P', tone: 't-warn', title: 'the prelabel file changed since it was imported' },
  'flag:error': { text: '! error', tone: 't-bad', title: 'label or prelabel file is invalid' },
  'flag:no_pcd': { text: 'no PCD', tone: 't-bad', title: 'label file whose PCD is gone (hidden unless chosen)' },
};

@Component({
  selector: 'app-vehicle-list',
  template: `
    <div class="filters">
      <input type="search" class="form-control form-control-sm" placeholder="Search id…" [value]="store.filter().search"
        (input)="patch({ search: $any($event.target).value })" (keydown.escape)="blur($event)" (keydown.enter)="blur($event)" />
      @for (c of categories; track c) {
        <div class="chips" role="group" [attr.aria-label]="categoryLabel[c]">
          <span class="cat muted small">{{ categoryLabel[c] }}</span>
          <span class="vals">
            @for (value of options[c]; track value) {
              @let chip = chips[c + ':' + value];
              @let n = store.facetCounts()[c][value];
              <button type="button" class="btn btn-sm btn-outline-secondary chip" [class.active]="isOn(c, value)"
                [class.empty]="n === 0" [attr.aria-pressed]="isOn(c, value)" [title]="chip.title" (click)="toggle(c, value)">
                <span [class]="chip.tone">{{ chip.text }}</span><span class="n">{{ n }}</span>
              </button>
            }
          </span>
        </div>
      }
    </div>
    <div class="count muted small">
      {{ store.filtered().length }} / {{ store.withPcd() }} vehicles
      @if (store.hiddenNoPcd() > 0) {
        · <span [title]="chips['flag:no_pcd'].title">{{ store.hiddenNoPcd() }} without PCD hidden</span>
      }
      @if (store.loading()) { · loading… }
      @if (active()) {
        <button type="button" class="btn btn-link btn-sm p-0 ms-auto" (click)="clear()">clear filters</button>
      }
    </div>
    <div class="list-group list-group-flush">
      @for (v of store.filtered(); track v.id) {
        <div class="list-group-item list-group-item-action" [class.active]="v.id === currentId()"
          (click)="open.emit(v.id)" [title]="title(v)">
          <span class="review r-{{ v.review_status }}">{{ reviewIcon[v.review_status] }}</span>
          <span class="id">{{ v.id.slice(0, 8) }}</span>
          <span class="badges">
            @if (v.label_state !== 'none') {
              <span class="badge l-{{ v.label_state }}">{{ labelText[v.label_state] }}</span>
            }
            @if (v.gt_state !== 'missing') {
              <span class="badge gt-{{ v.gt_state }}">GT</span>
            }
            @if (v.lift_axle_count > 0) { <span class="badge t-lift">L</span> }
            @if (v.stale) { <span class="badge t-warn">stale</span> }
            @if (v.prelabel_updated) { <span class="badge t-warn">new P</span> }
            @if (v.error) { <span class="badge t-bad">!</span> }
            @if (!v.has_pcd) { <span class="badge t-bad">no PCD</span> }
          </span>
        </div>
      } @empty {
        <div class="list-group-item muted">No vehicles match.</div>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    .filters { display: flex; flex-direction: column; gap: 4px; padding: 8px; }
    .chips { display: flex; align-items: baseline; gap: 4px; }
    .cat { width: 3.4em; flex: none; }
    .vals { display: flex; flex-wrap: wrap; gap: 3px; }
    .chip { --bs-btn-padding-x: 5px; --bs-btn-padding-y: 0; --bs-btn-font-size: 12px; }
    .chip.empty:not(.active) { opacity: 0.5; }
    .chip .n { color: var(--muted); font-family: var(--mono); font-size: 11px; margin-left: 4px; }
    .count { display: flex; gap: 4px; padding: 0 8px 4px; align-items: baseline; }
    .list-group { overflow-y: auto; flex: 1; --bs-list-group-bg: transparent; --bs-list-group-item-padding-y: 3px;
      --bs-list-group-item-padding-x: 8px; --bs-list-group-action-hover-bg: var(--bg-hover);
      --bs-list-group-action-hover-color: var(--fg); --bs-list-group-action-active-bg: var(--bg-sel);
      --bs-list-group-active-bg: var(--bg-sel); --bs-list-group-active-color: var(--fg);
      --bs-list-group-active-border-color: var(--border); border-radius: 0; }
    .list-group-item { display: flex; align-items: center; gap: 6px; border-left: 3px solid transparent; cursor: pointer; }
    .list-group-item.active { border-left-color: var(--accent); }
    .id { font-family: var(--mono); }
    .badges { margin-left: auto; display: flex; gap: 3px; }
    .badge { font-size: 11px; padding: 1px 4px; }
    .review { width: 1em; text-align: center; }
  `,
})
export class VehicleList {
  readonly store = inject(VehicleStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly currentId = input<string | null>(null);
  readonly open = output<string>();
  readonly filterChange = output<VehicleFilter>();

  readonly categories = FILTER_CATEGORIES;
  readonly options = FILTER_OPTIONS as Record<FilterCategory, readonly string[]>;
  readonly categoryLabel = CATEGORY_LABEL;
  readonly chips = CHIPS;
  readonly reviewIcon = { ok: '✓', not_ok: '✗', unreviewed: '•' } as const;
  readonly labelText = { none: '', prelabel_available: 'P', prelabeled: 'pre', edited: 'ed' } as const;

  constructor() {
    effect(() => {
      this.currentId();
      this.store.filtered();
      queueMicrotask(() =>
        this.host.nativeElement.querySelector('.list-group-item.active')?.scrollIntoView({ block: 'nearest' }),
      );
    });
  }

  active(): boolean {
    const f = this.store.filter();
    return !!f.search || this.categories.some((c) => f[c].length > 0);
  }

  isOn(c: FilterCategory, value: string): boolean {
    return (this.store.filter()[c] as readonly string[]).includes(value);
  }

  toggle(c: FilterCategory, value: string): void {
    const cur = this.store.filter()[c] as readonly string[];
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    this.patch({ [c]: next } as Partial<VehicleFilter>);
  }

  clear(): void {
    this.store.filter.set(EMPTY_FILTER);
    this.filterChange.emit(EMPTY_FILTER);
  }

  patch(p: Partial<VehicleFilter>): void {
    this.store.filter.update((f) => ({ ...f, ...p }));
    this.filterChange.emit(this.store.filter());
  }

  /** Inputs swallow the keyboard shortcuts: leave the search field with Enter / Escape. */
  blur(e: Event): void {
    (e.target as HTMLElement).blur();
  }

  title(v: VehicleSummary): string {
    const lines = [
      v.id,
      `review: ${v.review_status}`,
      `labels: ${v.label_state} (${v.axle_count} axles, ${v.lift_axle_count} lift)`,
      `ground truth: ${v.gt_state}`,
    ];
    if (!v.has_pcd) lines.push('no PCD: the PCD file is gone, only the label file is left');
    if (v.error) lines.push(`error: ${v.error}`);
    return lines.join('\n');
  }
}
