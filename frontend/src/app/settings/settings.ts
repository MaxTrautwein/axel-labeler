import { Component, computed, inject } from '@angular/core';

import { COLORMAP_NAMES, ChannelScale, buildLut, channelStats } from '../core/colors';
import { EditorStore } from '../core/editor';
import { ScaleChannel, SettingsStore, ViewSettings } from '../core/settings';
import { SideView } from '../side-view/side-view';

/** Defaults of the labeling view, stored in this browser; the side view of the open vehicle is the preview. */
@Component({
  selector: 'app-settings',
  imports: [SideView],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  readonly settings = inject(SettingsStore);
  readonly ed = inject(EditorStore);
  readonly d = this.settings.defaults;

  readonly themes = ['dark', 'light'] as const;
  readonly channels = [
    { key: 'reflectivity', label: 'Reflectivity', unit: '', log: true },
    { key: 'x', label: 'Lateral x', unit: 'm', log: false },
  ] as const;
  readonly colormaps = computed(() =>
    COLORMAP_NAMES.map((name) => ({ name, gradient: buildLut(name, this.d().reverseColormap).gradient })),
  );
  readonly stats = computed(() => {
    const p = this.ed.points();
    return p ? { x: channelStats(p, 'x'), reflectivity: channelStats(p, 'reflectivity') } : null;
  });

  set<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]): void {
    this.settings.patchDefaults({ [key]: value } as Partial<ViewSettings>);
  }

  scale(channel: ScaleChannel, patch: Partial<ChannelScale>): void {
    for (const v of Object.values(patch)) if (typeof v === 'number' && !Number.isFinite(v)) return;
    this.settings.patchDefaultScale(channel, patch);
  }

  num(e: Event): number {
    return parseFloat((e.target as HTMLInputElement).value);
  }

  checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  fmt(channel: ScaleChannel, v: number): string {
    return channel === 'x' ? v.toFixed(2) : String(Math.round(v));
  }

  resetAll(): void {
    if (confirm('Reset all view settings to the built-in defaults?')) this.settings.resetDefaults();
  }
}
