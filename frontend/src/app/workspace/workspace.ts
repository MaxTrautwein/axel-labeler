import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { EditorStore } from '../core/editor';
import { SettingsStore } from '../core/settings';
import { VehicleFilter, VehicleStore, filterFromParams, filterToParams } from '../core/vehicles';
import { AxleTable } from '../panels/axle-table';
import { GtPanel } from '../panels/gt-panel';
import { PrelabelPanel } from '../panels/prelabel-panel';
import { ReviewPanel } from '../panels/review-panel';
import { SectionView } from '../section-view/section-view';
import { SideView } from '../side-view/side-view';
import { VehicleList } from '../vehicle-list/vehicle-list';
import { View3d } from '../view-3d/view-3d';

@Component({
  selector: 'app-workspace',
  imports: [VehicleList, SideView, SectionView, View3d, AxleTable, GtPanel, PrelabelPanel, ReviewPanel],
  host: { '(window:keydown)': 'key($event)' },
  templateUrl: './workspace.html',
  styleUrl: './workspace.css',
})
export class Workspace {
  readonly ed = inject(EditorStore);
  readonly vehicles = inject(VehicleStore);
  readonly settings = inject(SettingsStore);
  readonly view = this.settings.view;
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Route parameter (`/v/:id`). */
  readonly id = input<string | undefined>();

  readonly xRange = computed(() => {
    const b = this.ed.points()?.bounds;
    return b ? { min: b.xMin, max: b.xMax } : { min: 0, max: 1 };
  });

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    this.vehicles.filter.set(filterFromParams((k) => q.get(k)));
    if (this.vehicles.all().length === 0) void this.vehicles.refresh();

    effect(() => {
      const id = this.id();
      untracked(() => {
        if (id) void this.open(id);
      });
    });
  }

  /** Navigate to a vehicle; pending changes are saved first. */
  async go(id: string | null): Promise<void> {
    if (!id || id === this.ed.id()) return;
    if (this.ed.dirty() && !(await this.ed.save())) return;
    await this.router.navigate(['/v', id], { queryParamsHandling: 'preserve' });
  }

  /** Load the routed vehicle; if its unsaved predecessor must not be left, go back to it. */
  private async open(id: string): Promise<void> {
    const previous = this.ed.id();
    if (!(await this.ed.load(id)) && previous) {
      await this.router.navigate(['/v', previous], { queryParamsHandling: 'preserve', replaceUrl: true });
    }
  }

  filterChanged(f: VehicleFilter): void {
    void this.router.navigate([], { queryParams: filterToParams(f), queryParamsHandling: 'merge', replaceUrl: true });
  }

  next(delta: number): void {
    void this.go(this.vehicles.neighbour(this.ed.id(), delta));
  }

  setXFilter(which: 0 | 1, e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    const r = this.xRange();
    const cur = this.ed.xFilter() ?? [r.min, r.max];
    const next: [number, number] = which === 0 ? [Math.min(v, cur[1]), cur[1]] : [cur[0], Math.max(v, cur[0])];
    this.ed.xFilter.set(next[0] <= r.min && next[1] >= r.max ? null : next);
  }

  addAtCursor(): void {
    const c = this.ed.cursor();
    const b = this.ed.points()?.bounds;
    this.ed.addAxle(c ? c[0] : b ? (b.yMin + b.yMax) / 2 : 0);
  }

  async review(status: 'ok' | 'not_ok'): Promise<void> {
    this.ed.setReviewStatus(status);
    if (status === 'not_ok') this.ed.focusComment.update((n) => n + 1);
    else await this.ed.save();
  }

  toggleLeft(): void {
    this.settings.patchView({ leftCollapsed: !this.view().leftCollapsed });
  }

  key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const big = e.shiftKey ? 10 : 1;
    const k = e.key;
    let handled = true;
    if (ctrl && k.toLowerCase() === 's') void this.ed.save();
    else if (ctrl && k.toLowerCase() === 'z' && e.shiftKey) this.ed.redo();
    else if (ctrl && k.toLowerCase() === 'z') this.ed.undo();
    else if (ctrl && k.toLowerCase() === 'y') this.ed.redo();
    else if (ctrl || e.altKey) handled = false;
    else if (k === 'PageDown') this.next(1);
    else if (k === 'PageUp') this.next(-1);
    else if (k === 'a') this.addAtCursor();
    else if (k === 'Delete' || k === 'Backspace') this.ed.deleteSelected();
    else if (k === 't') this.ed.toggleType();
    else if (k === 'g') this.ed.snapGt();
    else if (k === 'd') void this.ed.autodepth();
    else if (k === 'p') this.settings.patchView({ showPrelabel: !this.view().showPrelabel });
    else if (k === 'l') this.toggleLeft();
    else if (k === 'f') this.ed.fitRequest.update((n) => n + 1);
    else if (k === 'o') void this.review('ok');
    else if (k === 'n') void this.review('not_ok');
    else if (k === 'Escape') this.ed.select(null);
    // arrows nudge the selected axle; without a selection they switch vehicles (no auto-repeat:
    // every switch reads the whole PCD from the share)
    else if (k.startsWith('Arrow') && !this.ed.selected()) {
      if (!e.repeat) this.next(k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1);
    } else if (k === 'ArrowLeft') this.ed.nudge(-0.01 * big, 0);
    else if (k === 'ArrowRight') this.ed.nudge(0.01 * big, 0);
    else if (k === 'ArrowUp') this.ed.nudge(0, 0.01 * big);
    else if (k === 'ArrowDown') this.ed.nudge(0, -0.01 * big);
    else if (k === '[' || k === '{') this.ed.resize(-0.01 * big);
    else if (k === ']' || k === '}') this.ed.resize(0.01 * big);
    else if (/^[1-9]$/.test(k)) this.ed.selectByIndex(Number(k) - 1);
    else handled = false;
    if (handled) e.preventDefault();
  }
}
