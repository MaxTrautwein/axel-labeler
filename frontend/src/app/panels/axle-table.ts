import { Component, computed, inject } from '@angular/core';

import { EditorStore } from '../core/editor';
import { EditAxle } from '../core/models';

type Field = 'y' | 'z' | 'radius' | 'x_min' | 'x_max';

@Component({
  selector: 'app-axle-table',
  template: `
    <section class="card card-body p-2">
      <header class="panel-head">
        <h3>Axles</h3>
        <span class="muted">{{ counts().regular }} regular · {{ counts().lift }} lift</span>
      </header>
      @if (ed.sortedAxles().length === 0) {
        <p class="muted">No axles. Double-click in the side view, press <kbd>A</kbd> or use "Fill from GT".</p>
      } @else {
        <div class="scroll"><table class="table table-sm table-hover axles">
          <thead>
            <tr>
              <th>#</th><th>type</th>
              @for (f of fields; track f) {
                <th>{{ f === 'radius' ? 'r' : f }}</th>
              }
              <th title="largest change against the original prelabel (cm)">Δ</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (a of ed.sortedAxles(); track a.key; let i = $index) {
              <tr [class.table-active]="a.key === ed.selectedKey()" (click)="ed.select(a.key)">
                <td>{{ i + 1 }}</td>
                <td>
                  <select class="form-select form-select-sm" [value]="a.type" (change)="setType(a, $event)">
                    <option value="axle">axle</option>
                    <option value="lift_axle">lift</option>
                  </select>
                </td>
                @for (f of fields; track f) {
                  <td>
                    <input type="number" class="form-control form-control-sm" step="0.01" [value]="a[f].toFixed(3)"
                      (change)="set(a, f, $event)" (keydown.enter)="blur($event)" />
                  </td>
                }
                <td class="delta" [title]="delta(a).title">{{ delta(a).text }}</td>
                <td class="actions">
                  @if (delta(a).revertable) {
                    <button type="button" class="btn btn-sm btn-link px-1 py-0" title="Revert to prelabel" (click)="ed.revertToPrelabel(a.key); $event.stopPropagation()">↺</button>
                  }
                  <button type="button" class="btn btn-sm btn-link px-1 py-0" title="Delete (Del)" (click)="ed.select(a.key); ed.deleteSelected(); $event.stopPropagation()">✕</button>
                </td>
              </tr>
            }
          </tbody>
        </table></div>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .scroll { overflow-x: auto; }
    table.axles { font-size: 12px; margin: 0; }
    table.axles input { width: 4.6em; font-size: 12px; padding: 1px 3px; }
    table.axles select { width: 4.6em; font-size: 12px; padding: 1px 18px 1px 3px; background-position: right 3px center; }
    table.axles th { white-space: nowrap; color: var(--muted); font-weight: 500; }
    table.axles td, table.axles th { padding: 2px; vertical-align: middle; }
    td.delta { font-family: var(--mono); color: var(--muted); white-space: nowrap; }
    td.actions { white-space: nowrap; }
  `,
})
export class AxleTable {
  readonly ed = inject(EditorStore);
  readonly fields: readonly Field[] = ['y', 'z', 'radius', 'x_min', 'x_max'];
  readonly counts = computed(() => {
    const axles = this.ed.axles();
    const lift = axles.filter((a) => a.type === 'lift_axle').length;
    return { regular: axles.length - lift, lift };
  });

  set(a: EditAxle, f: Field, e: Event): void {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) this.ed.updateAxle(a.key, { [f]: v });
  }

  setType(a: EditAxle, e: Event): void {
    this.ed.updateAxle(a.key, { type: (e.target as HTMLSelectElement).value as EditAxle['type'] });
  }

  blur(e: Event): void {
    (e.target as HTMLInputElement).blur();
  }

  delta(a: EditAxle): { text: string; title: string; revertable: boolean } {
    if (a.prelabel_index == null) return { text: 'new', title: 'added manually', revertable: false };
    const p = this.ed.prelabelAxles()[a.prelabel_index];
    if (!p) return { text: '?', title: 'prelabel axle not found', revertable: false };
    const parts: [string, number][] = [['y', a.y - p.y], ['z', a.z - p.z], ['r', a.radius - p.radius]];
    if (p.x_min != null) parts.push(['x_min', a.x_min - p.x_min]);
    if (p.x_max != null) parts.push(['x_max', a.x_max - p.x_max]);
    const max = Math.max(...parts.map(([, d]) => Math.abs(d)));
    const typeChanged = p.type !== a.type;
    const title = parts.map(([n, d]) => `${n} ${(d * 100).toFixed(1)} cm`).join(', ') + (typeChanged ? ', type changed' : '');
    return {
      text: (typeChanged ? 'T ' : '') + (max < 0.001 ? '–' : (max * 100).toFixed(1)),
      title,
      revertable: max >= 0.001 || typeChanged,
    };
  }
}
