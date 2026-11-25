import { Component, effect, inject, signal } from '@angular/core';

import { CanvasView } from '../core/canvas-view';
import { EditorStore } from '../core/editor';
import { SettingsStore } from '../core/settings';
import { EditAxle, STRIDE } from '../core/models';
import { Viewport } from '../core/viewport';

const HIST_H = 46;
const BIN_M = 0.02;
const GRAB_PX = 7;

/** Cross-section of the selected axle: x (lateral, sensor side right) against z, to edit the depth. */
@Component({
  selector: 'app-section-view',
  template: `
    <canvas
      (pointerdown)="down($event)"
      (pointermove)="move($event)"
      (pointerup)="up($event)"
      (pointercancel)="up($event)"
      [style.cursor]="cursorStyle()"
    ></canvas>
    @if (!ed.selected()) {
      <div class="empty">Select an axle to edit its depth (x_min … x_max).</div>
    }
  `,
  styles: `
    :host { position: relative; display: block; overflow: hidden; background: var(--canvas-bg); }
    canvas { position: absolute; inset: 0; touch-action: none; }
    .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); }
  `,
})
export class SectionView extends CanvasView {
  readonly ed = inject(EditorStore);
  private readonly settings = inject(SettingsStore);
  readonly cursorStyle = signal('default');
  private readonly vp = new Viewport();
  private fittedFor: number | null = null;
  private drag: { edge: 'x_min' | 'x_max'; key: number } | null = null;

  constructor() {
    super();
    effect(() => {
      this.ed.selected();
      this.ed.points();
      this.ed.pointColors();
      this.settings.lut();
      this.settings.palette();
      this.requestDraw();
    });
    effect(() => {
      this.ed.points();
      this.fittedFor = null;
    });
  }

  protected override onResize(): void {
    this.fittedFor = null;
  }

  /** Indices of the points inside the wheel circle (side view projection). */
  private inside(a: EditAxle): number[] {
    const p = this.ed.points();
    const out: number[] = [];
    if (!p) return out;
    const r2 = a.radius * a.radius;
    for (let i = 0; i < p.count; i++) {
      const dy = p.data[i * STRIDE + 1] - a.y;
      const dz = p.data[i * STRIDE + 2] - a.z;
      if (dy * dy + dz * dz <= r2) out.push(i);
    }
    return out;
  }

  private fit(a: EditAxle, xs: number[]): void {
    let lo = a.x_min;
    let hi = a.x_max;
    for (const x of xs) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    this.vp.fit(lo - 0.1, hi + 0.1, a.z - a.radius - 0.05, a.z + a.radius + 0.05, this.width, this.height - HIST_H, 18);
    this.fittedFor = a.key;
  }

  protected draw(ctx: CanvasRenderingContext2D): void {
    const pal = this.settings.palette();
    this.begin(ctx, pal.background);
    const a = this.ed.selected();
    const p = this.ed.points();
    if (!a || !p) return;
    const idx = this.inside(a);
    const xs = idx.map((i) => p.data[i * STRIDE]);
    if (this.fittedFor !== a.key && !this.drag) this.fit(a, xs);
    const vp = this.vp;

    // depth band
    const [x0] = vp.toScreen(a.x_min, 0);
    const [x1] = vp.toScreen(a.x_max, 0);
    const color = a.type === 'axle' ? pal.axle : pal.liftAxle;
    ctx.fillStyle = color + '1f';
    ctx.fillRect(x0, 0, x1 - x0, this.height - HIST_H);

    // wheel height extent and ground
    const [, top] = vp.toScreen(0, a.z + a.radius);
    const [, bottom] = vp.toScreen(0, a.z - a.radius);
    const [, ground] = vp.toScreen(0, 0);
    ctx.strokeStyle = pal.grid;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(this.width, top);
    ctx.moveTo(0, bottom);
    ctx.lineTo(this.width, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = pal.ground;
    ctx.beginPath();
    ctx.moveTo(0, ground);
    ctx.lineTo(this.width, ground);
    ctx.stroke();

    // points
    const { index } = this.ed.pointColors();
    const lut = this.settings.lut().css;
    const size = 3 * this.settings.view().pointSize;
    for (const i of idx) {
      ctx.fillStyle = index ? lut[index[i]] : pal.plain;
      const [sx, sy] = vp.toScreen(p.data[i * STRIDE], p.data[i * STRIDE + 2]);
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    }

    // histogram of x
    const [u0] = vp.toWorld(0, 0);
    const [u1] = vp.toWorld(this.width, 0);
    const nBins = Math.max(1, Math.ceil((u1 - u0) / BIN_M));
    const counts = new Array<number>(nBins).fill(0);
    for (const x of xs) {
      const k = Math.floor((x - u0) / BIN_M);
      if (k >= 0 && k < nBins) counts[k]++;
    }
    const max = Math.max(1, ...counts);
    const base = this.height - 4;
    ctx.fillStyle = pal.histBg;
    ctx.fillRect(0, this.height - HIST_H, this.width, HIST_H);
    ctx.fillStyle = pal.histBar;
    counts.forEach((c, k) => {
      if (!c) return;
      const [sx] = vp.toScreen(u0 + k * BIN_M, 0);
      const w = Math.max(1, BIN_M * vp.scale - 1);
      const h = (c / max) * (HIST_H - 8);
      ctx.fillRect(sx, base - h, w, h);
    });

    // edges
    ctx.font = '11px ui-monospace, monospace';
    for (const [edge, sx] of [['x_min', x0], ['x_max', x1]] as const) {
      ctx.strokeStyle = pal.selected;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.height);
      ctx.stroke();
      ctx.fillStyle = pal.selected;
      const label = `${edge} ${a[edge].toFixed(3)}`;
      ctx.fillText(label, edge === 'x_min' ? sx - ctx.measureText(label).width - 4 : sx + 4, 14);
    }
    ctx.fillStyle = pal.text;
    ctx.fillText(`depth ${(a.x_max - a.x_min).toFixed(3)} m · ${xs.length} pts`, 6, this.height - HIST_H - 6);
    const hint = 'sensor side →';
    ctx.fillText(hint, this.width - ctx.measureText(hint).width - 6, this.height - HIST_H - 6);
  }

  private edgeAt(px: number): 'x_min' | 'x_max' | null {
    const a = this.ed.selected();
    if (!a) return null;
    const [x0] = this.vp.toScreen(a.x_min, 0);
    const [x1] = this.vp.toScreen(a.x_max, 0);
    if (Math.abs(px - x1) <= GRAB_PX) return 'x_max';
    if (Math.abs(px - x0) <= GRAB_PX) return 'x_min';
    return null;
  }

  down(e: PointerEvent): void {
    const a = this.ed.selected();
    const edge = this.edgeAt(this.local(e)[0]);
    if (!a || !edge) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { edge, key: a.key };
    this.ed.beginGesture();
  }

  move(e: PointerEvent): void {
    const [px] = this.local(e);
    if (!this.drag) {
      this.cursorStyle.set(this.edgeAt(px) ? 'ew-resize' : 'default');
      return;
    }
    const a = this.ed.selected();
    if (!a) return;
    const [u] = this.vp.toWorld(px, 0);
    const patch =
      this.drag.edge === 'x_min' ? { x_min: Math.min(u, a.x_max - 0.01) } : { x_max: Math.max(u, a.x_min + 0.01) };
    this.ed.updateAxle(this.drag.key, patch, true);
    this.requestDraw();
  }

  up(e: PointerEvent): void {
    if (!this.drag) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.drag = null;
    this.ed.endGesture();
  }
}
