import { Component, computed, inject } from '@angular/core';

import { AppState } from '../core/app-state';
import { EditorStore } from '../core/editor';

const STATE_LABEL = {
  missing: 'no GT',
  invalid: 'invalid',
  count_mismatch: 'count ≠',
  gap_mismatch: 'gap ≠',
  match: 'match',
} as const;

@Component({
  selector: 'app-gt-panel',
  template: `
    <section class="card card-body p-2">
      <header class="panel-head">
        <h3>Ground truth</h3>
        <span class="badge gt-{{ ed.gt().state }}">{{ label() }}</span>
      </header>
      @if (ed.doc()?.ground_truth; as gt) {
        <div class="raw" title="verbatim database value">axle_space <code>{{ gt.axle_space ?? 'null' }}</code></div>
        <div class="muted small">
          {{ gt.source ?? 'unknown source' }}@if (gt.weighing_data_id != null) { · row {{ gt.weighing_data_id }} }
        </div>
        @if (ed.gt().values; as values) {
          <div class="small">regular axles: <b>{{ regularCount() }}</b> labeled / <b>{{ values.length }}</b> GT</div>
          <table class="table table-sm gaps">
            <thead><tr><th>gap</th><th>GT m</th><th>labeled m</th><th>Δ cm</th></tr></thead>
            <tbody>
              @for (r of ed.gt().rows; track r.index) {
                <tr [class.bad]="r.ok === false" [class.good]="r.ok === true">
                  <td>{{ r.index + 1 }}–{{ r.index + 2 }}</td>
                  <td>{{ r.gtM?.toFixed(3) ?? '–' }}</td>
                  <td>{{ r.measuredM?.toFixed(3) ?? '–' }}</td>
                  <td>{{ r.deltaM !== null ? (r.deltaM * 100).toFixed(1) : '–' }}</td>
                </tr>
              }
            </tbody>
          </table>
          <div class="d-flex flex-wrap align-items-center gap-3">
            <button type="button" class="btn btn-sm btn-outline-secondary" (click)="ed.fillFromGt()"
              title="Move/create regular axles at the GT spacing, anchored like the guide (selected axle, else the front-most)">
              Fill from GT
            </button>
            <label class="form-check small mb-0" title="Moving a regular axle moves the other regular axles along at the GT spacing">
              <input type="checkbox" class="form-check-input" [checked]="ed.followGt()" (change)="ed.followGt.set(!ed.followGt())" />
              follow GT
            </label>
            <span class="muted small">tolerance ±{{ (app.config().gt_tolerance_m * 100).toFixed(0) }} cm</span>
          </div>
        } @else if (gt.axle_space != null) {
          <p class="warn">axle_space could not be interpreted (expected ';'-separated cm).</p>
        }
      } @else {
        <p class="muted">No ground truth for this vehicle (no prelabel file or no weighing record). Labeling works without it.</p>
      }
    </section>
  `,
  styles: `
    .raw code { font-size: 12px; word-break: break-all; }
    table.gaps { margin: 6px 0; font-size: 12px; }
    table.gaps td { font-family: var(--mono); }
    tr.bad td { --bs-table-color: var(--bad); }
    tr.good td:last-child { --bs-table-color: var(--good); }
  `,
})
export class GtPanel {
  readonly ed = inject(EditorStore);
  readonly app = inject(AppState);
  readonly label = computed(() => STATE_LABEL[this.ed.gt().state]);
  readonly regularCount = computed(() => this.ed.axles().filter((a) => a.type === 'axle').length);
}
