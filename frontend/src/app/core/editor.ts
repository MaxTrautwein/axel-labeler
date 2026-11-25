import { Injectable, computed, inject, signal } from '@angular/core';

import { Api, errorMessage, isConflict, WithEtag } from './api';
import { AppState } from './app-state';
import { colorize } from './colors';
import { compareGt, gtPositions } from './gt';
import { History } from './history';
import {
  AxelLabels,
  AxleType,
  EditAxle,
  LabelAxle,
  Points,
  PrelabelAxle,
  ReviewStatus,
  VehicleResponse,
} from './models';
import { Notify } from './notify';
import { SettingsStore } from './settings';
import { VehicleStore } from './vehicles';

const DEFAULT_RADIUS = 0.5;
const DEFAULT_DEPTH = 0.35;
const MIN_RADIUS = 0.05;
const MIN_Z = 0.01;
const MIN_DEPTH = 0.01;

export function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Round geometry like the server does and keep the axle valid. */
export function normalizeAxle<T extends LabelAxle>(a: T): T {
  const radius = round4(Math.max(MIN_RADIUS, a.radius));
  const z = round4(Math.max(MIN_Z, a.z));
  let xMin = round4(a.x_min);
  let xMax = round4(a.x_max);
  if (xMax - xMin < MIN_DEPTH) xMin = round4(xMax - MIN_DEPTH);
  return { ...a, y: round4(a.y), z, radius, x_min: xMin, x_max: xMax };
}

export function stripKey(a: EditAxle): LabelAxle {
  const { key: _key, ...rest } = a;
  return rest;
}

/**
 * Move the other regular axles onto the GT spacing around the regular axle `anchorKey` (y only).
 * The front-to-back rank comes from `rankFrom` (the state before an edit, so a drag cannot reorder).
 * Regular axles beyond the GT count and lift axles stay. Null if the anchor has no GT position.
 */
export function snapToGt(
  axles: EditAxle[],
  anchorKey: number,
  values: number[],
  rankFrom: EditAxle[] = axles,
): EditAxle[] | null {
  const rank = rankFrom.filter((a) => a.type === 'axle').sort((a, b) => b.y - a.y).map((a) => a.key);
  const k = rank.indexOf(anchorKey);
  const anchor = axles.find((a) => a.key === anchorKey);
  if (!anchor || anchor.type !== 'axle' || k < 0 || k >= values.length) return null;
  const positions = gtPositions(anchor.y, values, k);
  const target = new Map(rank.slice(0, values.length).map((key, i) => [key, positions[i]]));
  return axles.map((a) => {
    const y = target.get(a.key);
    return y === undefined || a.key === anchorKey || a.type !== 'axle' ? a : normalizeAxle({ ...a, y });
  });
}

function snapshotOf(axles: LabelAxle[], review: { status: ReviewStatus; comment: string }): string {
  const sorted = axles.map((a) => ({
    type: a.type, y: a.y, z: a.z, radius: a.radius,
    x_min: a.x_min, x_max: a.x_max, prelabel_index: a.prelabel_index,
  })).sort((a, b) => b.y - a.y);
  return JSON.stringify({ axles: sorted, review: { status: review.status, comment: review.comment } });
}

@Injectable({ providedIn: 'root' })
export class EditorStore {
  private readonly api = inject(Api);
  private readonly app = inject(AppState);
  private readonly vehicles = inject(VehicleStore);
  private readonly notify = inject(Notify);
  private readonly settings = inject(SettingsStore);

  readonly id = signal<string | null>(null);
  readonly doc = signal<AxelLabels | null>(null);
  readonly etag = signal('');
  readonly axles = signal<EditAxle[]>([]);
  readonly review = signal<{ status: ReviewStatus; comment: string }>({ status: 'unreviewed', comment: '' });
  readonly points = signal<Points | null>(null);
  readonly selectedKey = signal<number | null>(null);
  readonly stale = signal(false);
  readonly prelabelUpdated = signal(false);
  readonly warnings = signal<string[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflict = signal(false);

  // per-vehicle view state (the rest is in SettingsStore)
  readonly xFilter = signal<[number, number] | null>(null);
  /** Cursor position in the side view (y, z), used by keyboard "add". */
  readonly cursor = signal<[number, number] | null>(null);
  /** Incremented to ask the review panel to focus its comment field. */
  readonly focusComment = signal(0);
  /** Incremented to ask the side view to fit the whole vehicle. */
  readonly fitRequest = signal(0);

  private readonly history = new History<EditAxle[]>();
  readonly historyVersion = signal(0);
  private readonly savedSnapshot = signal('');
  private gestureStart: EditAxle[] | null = null;
  private nextKey = 1;
  private loadToken = 0;

  readonly dirty = computed(
    () => this.doc() !== null && snapshotOf(this.axles(), this.review()) !== this.savedSnapshot(),
  );
  /** The colour-relevant part of the view settings; JSON equality so other setting changes don't recolour. */
  private readonly colorSpec = computed(
    () => {
      const v = this.settings.view();
      return { colorBy: v.colorBy, scale: v.colorBy === 'reflectivity' ? v.scales.reflectivity : v.scales.x };
    },
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  /** LUT index per point, shared by all views. */
  readonly pointColors = computed(() => {
    const s = this.colorSpec();
    return colorize(this.points(), s.colorBy, s.scale);
  });
  readonly selected = computed(() => this.axles().find((a) => a.key === this.selectedKey()) ?? null);
  /** Front to back. */
  readonly sortedAxles = computed(() => [...this.axles()].sort((a, b) => b.y - a.y));
  readonly prelabelAxles = computed<PrelabelAxle[]>(() => this.doc()?.prelabel?.document.axles ?? []);
  readonly gt = computed(() =>
    compareGt(
      this.doc()?.ground_truth?.axle_space,
      this.axles().filter((a) => a.type === 'axle').map((a) => a.y),
      this.app.config().gt_tolerance_m,
    ),
  );
  /** The regular axle the GT guide hangs on: the selected one if it has a GT position, else the front-most. */
  private readonly gtAnchor = computed(() => {
    const values = this.gt().values;
    const regular = this.sortedAxles().filter((a) => a.type === 'axle');
    if (!values || regular.length === 0) return null;
    const k = regular.findIndex((a) => a.key === this.selectedKey());
    const rank = k >= 0 && k < values.length ? k : 0;
    return { rank, axle: regular[rank], values };
  });
  /** Ghost positions of the GT axles around the anchor. */
  readonly gtGuide = computed(() => {
    const anchor = this.gtAnchor();
    if (!anchor) return null;
    const { rank, axle, values } = anchor;
    return { positions: gtPositions(axle.y, values, rank), z: axle.z, radius: axle.radius };
  });
  /** While on, moving a regular axle moves the others along at the GT spacing. */
  readonly followGt = signal(false);
  readonly canUndo = computed(() => (this.historyVersion(), this.history.canUndo));
  readonly canRedo = computed(() => (this.historyVersion(), this.history.canRedo));

  // --- loading / saving ---------------------------------------------------------------------

  /** Load a vehicle; saves pending changes of the current one first. False if navigation must stop. */
  async load(id: string): Promise<boolean> {
    if (this.id() === id && this.doc() !== null) return true;
    if (this.dirty() && !(await this.save())) {
      if (!confirm('The current changes could not be saved. Discard them?')) return false;
    }
    const token = ++this.loadToken;
    this.loading.set(true);
    this.error.set(null);
    this.id.set(id);
    try {
      const [vehicle, points] = await Promise.all([this.api.vehicle(id), this.api.points(id)]);
      if (token !== this.loadToken) return true;
      this.points.set(points);
      this.xFilter.set(null);
      this.apply(vehicle);
    } catch (err) {
      if (token !== this.loadToken) return true;
      this.doc.set(null);
      this.points.set(null);
      this.axles.set([]);
      this.error.set(errorMessage(err));
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
    return true;
  }

  private apply(v: WithEtag<VehicleResponse>): void {
    const doc = v.body.doc;
    this.doc.set(doc);
    this.etag.set(v.etag);
    this.axles.set(doc.axles.map((a) => ({ ...a, key: this.nextKey++ })));
    this.review.set({ status: doc.review.status, comment: doc.review.comment });
    this.savedSnapshot.set(snapshotOf(doc.axles, doc.review));
    this.stale.set(v.body.stale);
    this.prelabelUpdated.set(v.body.prelabel_updated);
    this.warnings.set(v.body.warnings);
    this.conflict.set(false);
    this.selectedKey.set(null);
    this.history.clear();
    this.historyVersion.update((n) => n + 1);
    if (v.body.summary) this.vehicles.upsert(v.body.summary);
  }

  async save(): Promise<boolean> {
    const id = this.id();
    if (id === null || this.doc() === null || !this.dirty()) return true;
    this.saving.set(true);
    try {
      const edit = { axles: this.axles().map(stripKey), review: this.review() };
      const r = await this.api.save(id, edit, this.etag());
      const doc = r.body.doc;
      this.doc.set(doc);
      this.etag.set(r.etag);
      this.review.set({ status: doc.review.status, comment: doc.review.comment });
      this.savedSnapshot.set(snapshotOf(doc.axles, doc.review));
      if (r.body.summary) this.vehicles.upsert(r.body.summary);
      return true;
    } catch (err) {
      if (isConflict(err)) this.conflict.set(true);
      this.notify.error(`Saving failed: ${errorMessage(err)}`);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async reloadFromDisk(): Promise<void> {
    const id = this.id();
    if (id === null) return;
    try {
      this.apply(await this.api.vehicle(id));
    } catch (err) {
      this.notify.error(errorMessage(err));
    }
  }

  /** Resolve a conflict by writing the local state over the file on disk. */
  async overwrite(): Promise<void> {
    const id = this.id();
    if (id === null) return;
    try {
      const v = await this.api.vehicle(id);
      this.doc.set(v.body.doc);
      this.etag.set(v.etag);
      this.savedSnapshot.set(snapshotOf(v.body.doc.axles, v.body.doc.review));
      this.conflict.set(false);
      await this.save();
    } catch (err) {
      this.notify.error(errorMessage(err));
    }
  }

  async reimport(keepAxles: boolean): Promise<void> {
    const id = this.id();
    if (id === null || !(await this.save())) return;
    try {
      this.apply(await this.api.reimport(id, keepAxles));
      this.notify.info(keepAxles ? 'Prelabel reference updated' : 'Prelabel re-imported');
    } catch (err) {
      this.notify.error(errorMessage(err));
    }
  }

  async acceptPcd(): Promise<void> {
    const id = this.id();
    if (id === null || !(await this.save())) return;
    try {
      this.apply(await this.api.acceptPcd(id));
    } catch (err) {
      this.notify.error(errorMessage(err));
    }
  }

  // --- edit history ---------------------------------------------------------------------------

  private commit(next: EditAxle[]): void {
    this.history.push(this.axles());
    this.axles.set(next);
    this.historyVersion.update((n) => n + 1);
  }

  beginGesture(): void {
    this.gestureStart = this.axles();
  }

  endGesture(): void {
    if (this.gestureStart !== null && this.gestureStart !== this.axles()) {
      this.history.push(this.gestureStart);
      this.historyVersion.update((n) => n + 1);
    }
    this.gestureStart = null;
  }

  undo(): void {
    const prev = this.history.undo(this.axles());
    if (prev) this.restore(prev);
  }

  redo(): void {
    const next = this.history.redo(this.axles());
    if (next) this.restore(next);
  }

  private restore(axles: EditAxle[]): void {
    this.axles.set(axles);
    if (!axles.some((a) => a.key === this.selectedKey())) this.selectedKey.set(null);
    this.historyVersion.update((n) => n + 1);
  }

  // --- axle edits -----------------------------------------------------------------------------

  private patched(key: number, patch: Partial<LabelAxle>): EditAxle[] {
    return this.axles().map((a) => (a.key === key ? normalizeAxle({ ...a, ...patch }) : a));
  }

  /** transient = part of a drag gesture (one undo step per gesture). */
  updateAxle(key: number, patch: Partial<LabelAxle>, transient = false): void {
    let next = this.patched(key, patch);
    const values = this.gt().values;
    if (patch.y !== undefined && this.followGt() && values) {
      next = snapToGt(next, key, values, this.axles()) ?? next;
    }
    if (transient) this.axles.set(next);
    else this.commit(next);
  }

  select(key: number | null): void {
    this.selectedKey.set(key);
  }

  selectByIndex(index: number): void {
    const a = this.sortedAxles()[index];
    if (a) this.selectedKey.set(a.key);
  }

  private defaultDepth(): [number, number] {
    const axles = this.axles();
    const xMin = median(axles.map((a) => a.x_min));
    const xMax = median(axles.map((a) => a.x_max));
    if (xMin !== null && xMax !== null) return [xMin, xMax];
    const xTop = this.points()?.bounds.xMax ?? DEFAULT_DEPTH;
    return [xTop - DEFAULT_DEPTH, xTop];
  }

  private newAxle(y: number, z: number | null, radius: number | null, type: AxleType = 'axle'): EditAxle {
    const r = radius ?? median(this.axles().map((a) => a.radius)) ?? DEFAULT_RADIUS;
    const [xMin, xMax] = this.defaultDepth();
    return normalizeAxle({
      key: this.nextKey++, type, y, z: z ?? r, radius: r,
      x_min: xMin, x_max: xMax, prelabel_index: null,
    });
  }

  addAxle(y: number, z: number | null = null): void {
    const a = this.newAxle(y, z, null);
    this.commit([...this.axles(), a]);
    this.selectedKey.set(a.key);
    void this.autodepth(a.key, true);
  }

  deleteSelected(): void {
    const key = this.selectedKey();
    if (key === null) return;
    this.commit(this.axles().filter((a) => a.key !== key));
    this.selectedKey.set(null);
  }

  toggleType(): void {
    const a = this.selected();
    if (a) this.updateAxle(a.key, { type: a.type === 'axle' ? 'lift_axle' : 'axle' });
  }

  nudge(dy: number, dz: number): void {
    const a = this.selected();
    if (a) this.updateAxle(a.key, { y: a.y + dy, z: a.z + dz });
  }

  resize(dr: number): void {
    const a = this.selected();
    if (a) this.updateAxle(a.key, { radius: a.radius + dr });
  }

  /** Fit x_min/x_max from the points. quiet: no message if it fails (e.g. right after adding). */
  async autodepth(key: number | null = this.selectedKey(), quiet = false): Promise<void> {
    const id = this.id();
    const a = this.axles().find((x) => x.key === key);
    if (id === null || !a) return;
    try {
      const fit = await this.api.autodepth(id, a.y, a.z, a.radius);
      if (this.id() !== id || !this.axles().some((x) => x.key === a.key)) return;
      this.updateAxle(a.key, { x_min: fit.x_min, x_max: fit.x_max });
      if (fit.warning) this.notify.info(`Depth: ${fit.warning}`);
    } catch (err) {
      if (!quiet) this.notify.error(`Depth fit: ${errorMessage(err)}`);
    }
  }

  /** Move the other regular axles onto the GT guide (nothing is added). */
  snapGt(): void {
    const anchor = this.gtAnchor();
    const next = anchor ? snapToGt(this.axles(), anchor.axle.key, anchor.values) : null;
    if (next) this.commit(next);
  }

  /** Place regular axles at the ground-truth spacing, anchored like the GT guide; adds missing ones. */
  fillFromGt(): void {
    const values = this.gt().values;
    if (!values) return;
    const regular = this.sortedAxles().filter((a) => a.type === 'axle');
    const anchor = this.gtAnchor();
    const front = this.points()?.bounds.yMax ?? 0;
    const r = anchor?.axle.radius ?? DEFAULT_RADIUS;
    const z = anchor?.axle.z ?? r;
    const positions = anchor ? gtPositions(anchor.axle.y, values, anchor.rank) : gtPositions(front - 1.0, values);
    const moved = new Map<number, number>();
    const added: EditAxle[] = [];
    positions.forEach((y, i) => {
      if (regular[i]) moved.set(regular[i].key, y);
      else added.push(this.newAxle(y, z, r));
    });
    const next = this.axles()
      .map((a) => (moved.has(a.key) ? normalizeAxle({ ...a, y: moved.get(a.key)! }) : a))
      .concat(added);
    this.commit(next);
    for (const a of added) void this.autodepth(a.key, true);
  }

  /**
   * Prelabel axle `index` as an edit axle. Without prelabel depth the depth of `current` is kept;
   * a new axle then gets a placeholder depth and needsFit.
   */
  private fromPrelabel(index: number, current?: EditAxle): { axle: EditAxle; needsFit: boolean } {
    const p = this.prelabelAxles()[index];
    const hasDepth = p.x_min != null && p.x_max != null;
    const base = current ?? this.newAxle(p.y, p.z, p.radius, p.type);
    const axle = normalizeAxle({
      ...base,
      type: p.type, y: p.y, z: p.z, radius: p.radius, prelabel_index: index,
      x_min: hasDepth ? p.x_min! : base.x_min,
      x_max: hasDepth ? p.x_max! : base.x_max,
    });
    return { axle, needsFit: !hasDepth && !current };
  }

  revertToPrelabel(key: number): void {
    const a = this.axles().find((x) => x.key === key);
    if (a?.prelabel_index == null || !this.prelabelAxles()[a.prelabel_index]) return;
    const { axle } = this.fromPrelabel(a.prelabel_index, a);
    this.commit(this.axles().map((x) => (x.key === key ? axle : x)));
  }

  /** Re-add a prelabel axle that was deleted. */
  restorePrelabelAxle(index: number): void {
    if (!this.prelabelAxles()[index]) return;
    const { axle, needsFit } = this.fromPrelabel(index);
    this.commit([...this.axles(), axle]);
    this.selectedKey.set(axle.key);
    if (needsFit) void this.autodepth(axle.key, true);
  }

  /** Discard all axle edits: exactly the prelabel axles again (one undo step). */
  revertAllToPrelabel(): void {
    if (!this.doc()?.prelabel) return;
    const current = new Map<number, EditAxle>();
    for (const a of this.axles()) {
      if (a.prelabel_index != null && !current.has(a.prelabel_index)) current.set(a.prelabel_index, a);
    }
    const restored = this.prelabelAxles().map((_, i) => this.fromPrelabel(i, current.get(i)));
    this.commit(restored.map((r) => r.axle));
    this.selectedKey.set(null);
    for (const r of restored) if (r.needsFit) void this.autodepth(r.axle.key, true);
  }

  // --- review ---------------------------------------------------------------------------------

  setReviewStatus(status: ReviewStatus): void {
    this.review.update((r) => ({ ...r, status }));
  }

  setComment(comment: string): void {
    this.review.update((r) => ({ ...r, comment }));
  }
}
