import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { Api, errorMessage } from './core/api';
import { AppState } from './core/app-state';
import { EditorStore } from './core/editor';
import { ExportResponse, ReviewStatus } from './core/models';
import { Notify } from './core/notify';
import { SettingsStore } from './core/settings';
import { VehicleStore, filterToParams } from './core/vehicles';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  host: {
    '(document:click)': 'menuOpen.set(false)',
    '(document:keydown.escape)': 'menuOpen.set(false)',
    '(window:beforeunload)': 'beforeUnload($event)',
  },
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly app = inject(AppState);
  readonly notify = inject(Notify);
  private readonly api = inject(Api);
  private readonly vehicles = inject(VehicleStore);
  private readonly ed = inject(EditorStore);
  private readonly router = inject(Router);

  readonly busy = signal(false);
  readonly exportOpen = signal(false);
  readonly exportStatus = signal<ReviewStatus>('ok');
  readonly exportResult = signal<ExportResponse | null>(null);
  readonly menuOpen = signal(false);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  readonly onSettings = computed(() => this.url().startsWith('/settings'));
  /** Back to the open vehicle with the current list filter (the workspace reads the filter from the URL). */
  readonly labelingLink = computed(() => {
    const id = this.ed.id();
    const queryParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(filterToParams(this.vehicles.filter()))) if (v) queryParams[k] = v;
    return { commands: id ? ['/v', id] : ['/'], queryParams };
  });

  readonly problems = computed(() => {
    const err = this.app.healthError();
    if (err) return [`API not reachable: ${err}`];
    const h = this.app.health();
    if (!h) return [];
    const out: string[] = [];
    if (!h.pcd_dir) out.push('PCD directory missing (is the share mounted?)');
    else if (h.pcd_count === 0) out.push('No PCD files found in the PCD directory');
    if (!h.labels_dir_writable) out.push('Labels directory is not writable (check UID/GID)');
    if (h.prelabel_dir === false) out.push('Prelabel directory missing');
    if (h.export_dir_writable === false) out.push('Export directory is not writable');
    return out;
  });

  constructor() {
    inject(SettingsStore); // applies the theme on every page
    void this.app.init();
  }

  async rescan(): Promise<void> {
    await this.vehicles.refresh(true);
    await this.app.checkHealth();
  }

  async importPrelabels(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.api.importPrelabels();
      this.notify.info(`Imported ${r.imported} prelabel(s)` + (r.failed.length ? `, ${r.failed.length} failed` : ''));
      for (const f of r.failed.slice(0, 3)) this.notify.error(`${f.vehicle_id.slice(0, 8)}: ${f.error}`);
      await this.vehicles.refresh();
    } catch (err) {
      this.notify.error(`Import failed: ${errorMessage(err)}`);
    } finally {
      this.busy.set(false);
    }
  }

  async runExport(): Promise<void> {
    if (!(await this.ed.save())) return;
    this.busy.set(true);
    try {
      this.exportResult.set(await this.api.export(this.exportStatus()));
    } catch (err) {
      this.notify.error(`Export failed: ${errorMessage(err)}`);
    } finally {
      this.busy.set(false);
    }
  }

  beforeUnload(e: BeforeUnloadEvent): void {
    if (this.ed.dirty()) e.preventDefault();
  }

  closeExport(): void {
    this.exportOpen.set(false);
    this.exportResult.set(null);
  }
}
