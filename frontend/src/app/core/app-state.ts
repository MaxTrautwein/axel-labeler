import { Injectable, inject, signal } from '@angular/core';

import { Api, errorMessage } from './api';
import { AppConfig, Health } from './models';

@Injectable({ providedIn: 'root' })
export class AppState {
  private readonly api = inject(Api);
  readonly config = signal<AppConfig>({
    version: '',
    gt_tolerance_m: 0.1,
    max_depth_m: 0.8,
    prelabel_enabled: false,
    export_enabled: false,
  });
  readonly health = signal<Health | null>(null);
  readonly healthError = signal<string | null>(null);

  async init(): Promise<void> {
    try {
      this.config.set(await this.api.config());
    } catch {
      // health check below reports the problem
    }
    await this.checkHealth();
  }

  async checkHealth(): Promise<void> {
    try {
      this.health.set(await this.api.health());
      this.healthError.set(null);
    } catch (err) {
      this.health.set(null);
      this.healthError.set(errorMessage(err));
    }
  }
}
