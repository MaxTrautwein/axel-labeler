import { TestBed } from '@angular/core/testing';

import { BUILTIN_SETTINGS, STORAGE_KEY, SettingsStore, parseSettings } from './settings';

describe('parseSettings', () => {
  it('falls back to the built-in defaults', () => {
    expect(parseSettings(null)).toEqual(BUILTIN_SETTINGS);
    expect(parseSettings('garbage')).toEqual(BUILTIN_SETTINGS);
  });

  it('merges stored values field by field and drops invalid ones', () => {
    const s = parseSettings({
      theme: 'light',
      colormap: 'nope',
      pointSize: 'big',
      scales: { reflectivity: { mode: 'fixed', max: 800, lowPct: 250 } },
    });
    expect(s.theme).toBe('light');
    expect(s.colormap).toBe(BUILTIN_SETTINGS.colormap);
    expect(s.pointSize).toBe(BUILTIN_SETTINGS.pointSize);
    expect(s.scales.reflectivity).toEqual({ ...BUILTIN_SETTINGS.scales.reflectivity, mode: 'fixed', max: 800, lowPct: 100 });
    expect(s.scales.x).toEqual(BUILTIN_SETTINGS.scales.x);
  });
});

describe('SettingsStore', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    TestBed.resetTestingModule();
  });

  it('keeps toolbar changes for the session until saved as default', () => {
    const store = TestBed.inject(SettingsStore);
    store.patchView({ colorBy: 'reflectivity' });
    expect(store.modified()).toBe(true);
    expect(store.defaults().colorBy).toBe('x');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    store.resetView();
    expect(store.view().colorBy).toBe('x');

    store.patchView({ colorBy: 'reflectivity' });
    store.saveViewAsDefault();
    expect(store.modified()).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).colorBy).toBe('reflectivity');
  });

  it('applies default changes to the live view and persists them', () => {
    const store = TestBed.inject(SettingsStore);
    store.patchView({ leftCollapsed: true });
    store.patchDefaults({ theme: 'light' });
    store.patchDefaultScale('reflectivity', { mode: 'fixed' });
    expect(store.view().theme).toBe('light');
    expect(store.view().leftCollapsed).toBe(true);
    expect(store.view().scales.reflectivity.mode).toBe('fixed');
    const stored = parseSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)!));
    expect(stored.theme).toBe('light');
    expect(stored.leftCollapsed).toBe(false);
    expect(stored.scales.reflectivity.mode).toBe('fixed');

    expect(TestBed.runInInjectionContext(() => new SettingsStore()).defaults().theme).toBe('light');
  });
});
