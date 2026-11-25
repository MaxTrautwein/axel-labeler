import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';

import { EditorStore } from '../core/editor';
import { SettingsStore } from '../core/settings';
import { VehicleStore } from '../core/vehicles';

@Component({
  selector: 'app-prelabel-panel',
  imports: [DatePipe],
  template: `
    <section class="card card-body p-2">
      <header class="panel-head">
        <h3>Prelabel</h3>
        <label class="form-check small mb-0">
          <input type="checkbox" class="form-check-input" [checked]="settings.view().showPrelabel"
            (change)="settings.patchView({ showPrelabel: !settings.view().showPrelabel })" />
          overlay <kbd>P</kbd>
        </label>
      </header>
      @if (ed.doc()?.prelabel; as p) {
        <div class="small">
          {{ p.document.tool.name }} {{ p.document.tool.version ?? '' }} ·
          created {{ p.document.created_at | date: 'short' }} · imported {{ p.imported_at | date: 'short' }}
        </div>
        <div class="small">
          {{ stats().proposed }} proposed · {{ stats().unchanged }} unchanged · {{ stats().edited }} edited ·
          {{ stats().removed.length }} removed · {{ stats().added }} added
        </div>
        @for (i of stats().removed; track i) {
          <div class="small removed">
            removed proposal #{{ i + 1 }} at y {{ ed.prelabelAxles()[i].y.toFixed(3) }}
            <button type="button" class="btn btn-link btn-sm p-0 align-baseline" (click)="ed.restorePrelabelAxle(i)">restore</button>
          </div>
        }
        @if (stats().edited + stats().removed.length + stats().added > 0) {
          <div class="d-flex flex-wrap gap-2 mt-2">
            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="ed.revertAllToPrelabel()"
              title="Discard all axle edits: restore removed, revert edited, drop added axles (Ctrl+Z undoes it)">
              Reset to prelabel
            </button>
          </div>
        }
      } @else {
        <p class="muted">No prelabel imported – labels are manual.</p>
      }
      @if (offerImport()) {
        <div class="notice">
          {{ ed.doc()?.prelabel ? 'The prelabel file has changed since it was imported.' : 'A prelabel file is available.' }}
          <div class="d-flex flex-wrap gap-2 mt-2">
            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="ed.reimport(false)" title="Replace the current axles with the prelabel">Import, replace axles</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="ed.reimport(true)" title="Keep the current axles, only update reference and GT">Keep axles</button>
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    .removed { color: var(--warn); }
  `,
})
export class PrelabelPanel {
  readonly ed = inject(EditorStore);
  readonly settings = inject(SettingsStore);
  private readonly vehicles = inject(VehicleStore);

  readonly offerImport = computed(() => {
    if (this.ed.prelabelUpdated()) return true;
    const id = this.ed.id();
    const summary = this.vehicles.all().find((v) => v.id === id);
    return !!summary?.has_prelabel && !this.ed.doc()?.prelabel;
  });

  readonly stats = computed(() => {
    const pre = this.ed.prelabelAxles();
    const used = new Set<number>();
    let unchanged = 0;
    let edited = 0;
    let added = 0;
    for (const a of this.ed.axles()) {
      const p = a.prelabel_index != null ? pre[a.prelabel_index] : undefined;
      if (!p) {
        added++;
        continue;
      }
      used.add(a.prelabel_index!);
      const same =
        p.type === a.type && [[a.y, p.y], [a.z, p.z], [a.radius, p.radius], [a.x_min, p.x_min], [a.x_max, p.x_max]]
          .every(([ours, theirs]) => theirs == null || Math.abs(ours! - theirs) < 0.001);
      if (same) unchanged++;
      else edited++;
    }
    const removed = pre.map((_, i) => i).filter((i) => !used.has(i));
    return { proposed: pre.length, unchanged, edited, added, removed };
  });
}
