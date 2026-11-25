import { Component, computed, effect, inject, signal, untracked } from '@angular/core';

import { CanvasView, gridStep } from '../core/canvas-view';
import { EditorStore } from '../core/editor';
import { SettingsStore } from '../core/settings';
import { STRIDE } from '../core/models';
import { Viewport } from '../core/viewport';

const OUT = 255; // bucket of points outside the lateral filter
const PLAIN = 254; // bucket for "no colouring"
const HANDLE_PX = 8;

interface Drag {
  mode: 'pan' | 'move' | 'radius';
  key: number | null;
  lastX: number;
  lastY: number;
  startU: number;
  startV: number;
  startY: number;
  startZ: number;
  moved: boolean;
}

/** Main labeling view: y (along the vehicle, front right) against z (up). */
@Component({
  selector: 'app-side-view',
  template: `
    <canvas
      (pointerdown)="down($event)"
      (pointermove)="move($event)"
      (pointerup)="up($event)"
      (pointercancel)="up($event)"
      (pointerleave)="ed.cursor.set(null)"
      (wheel)="wheel($event)"
      (dblclick)="dbl($event)"
      (contextmenu)="$event.preventDefault()"
      [style.cursor]="cursorStyle()"
    ></canvas>
    <div class="readout">
      @if (ed.cursor(); as c) {
        y {{ c[0].toFixed(3) }} · z {{ c[1].toFixed(3) }} m
      }
    </div>
    <div class="legend">
      @if (colorbar(); as cb) {
        <span class="cbar" [title]="cb.title">
          {{ cb.label }} {{ cb.lo }}<span class="bar" [style.background]="cb.gradient"></span>{{ cb.hi }}
        </span>
      }
      <span [style.color]="pal().axle">axle</span><span [style.color]="pal().liftAxle">lift axle</span>
      @if (ed.gtGuide()) {
        <span [style.color]="pal().gt">GT guide{{ ed.followGt() ? ' · follow' : '' }}</span>
      }
      @if (settings.view().showPrelabel) {
        <span [style.color]="pal().prelabel">prelabel</span>
      }
      <span>front →</span>
    </div>
  `,
  styles: `
    :host { position: relative; display: block; overflow: hidden; background: var(--canvas-bg); }
    canvas { position: absolute; inset: 0; touch-action: none; }
    .readout, .legend {
      position: absolute; font: 12px var(--mono); color: var(--muted);
      background: var(--overlay-bg); padding: 2px 6px; border-radius: 4px; pointer-events: none;
    }
    .readout { left: 8px; bottom: 6px; }
    .legend {
      right: 8px; top: 6px; max-width: calc(100% - 16px);
      display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; column-gap: 10px;
    }
    .legend > span { white-space: nowrap; }
    .cbar { display: flex; align-items: center; gap: 4px; }
    .bar { display: inline-block; width: 70px; height: 9px; border-radius: 2px; }
  `,
})
export class SideView extends CanvasView {
  readonly ed = inject(EditorStore);
  readonly settings = inject(SettingsStore);
  readonly pal = this.settings.palette;
  readonly colorbar = computed(() => {
    const c = this.ed.pointColors();
    if (!c.index) return null;
    const x = this.settings.view().colorBy === 'x';
    const fmt = (v: number) => (x ? v.toFixed(2) : String(Math.round(v)));
    const label = x ? 'x' : c.log ? 'refl (log)' : 'refl';
    return {
      label, lo: fmt(c.lo), hi: fmt(c.hi), gradient: this.settings.lut().gradient,
      title: `colour = ${x ? 'lateral x (m)' : 'reflectivity'}; values outside the range get the end colours`,
    };
  });
  readonly cursorStyle = signal('crosshair');
  private readonly vp = new Viewport();
  private readonly layer = document.createElement('canvas');
  private layerDirty = true;
  private buckets = new Map<number, number[]>();
  private fitted = false;
  private drag: Drag | null = null;

  constructor() {
    super();
    effect(() => {
      this.ed.points();
      this.ed.pointColors();
      this.ed.xFilter();
      untracked(() => {
        this.computeBuckets();
        this.layerDirty = true;
        this.requestDraw();
      });
    });
    effect(() => {
      this.settings.lut();
      this.settings.palette();
      this.settings.view().pointSize;
      this.layerDirty = true;
      this.requestDraw();
    });
    effect(() => {
      this.ed.points();
      this.ed.fitRequest();
      untracked(() => {
        this.fitted = false;
        this.fit();
      });
    });
    effect(() => {
      this.ed.axles();
      this.ed.selectedKey();
      this.settings.view().showPrelabel;
      this.ed.gtGuide();
      this.ed.prelabelAxles();
      this.requestDraw();
    });
  }

  protected override onResize(): void {
    this.layer.width = this.canvas.width;
    this.layer.height = this.canvas.height;
    this.layerDirty = true;
    if (!this.fitted) this.fit();
  }

  fit(): void {
    const p = this.ed.points();
    if (!p || this.width === 0) return;
    const b = p.bounds;
    this.vp.fit(b.yMin - 0.4, b.yMax + 0.4, Math.min(0, b.zMin) - 0.3, b.zMax + 0.2, this.width, this.height);
    this.fitted = true;
    this.layerDirty = true;
    this.requestDraw();
  }

  private computeBuckets(): void {
    const p = this.ed.points();
    this.buckets = new Map();
    if (!p) return;
    const { data, count } = p;
    const filter = this.ed.xFilter();
    const { index } = this.ed.pointColors();
    for (let i = 0; i < count; i++) {
      const x = data[i * STRIDE];
      const b = filter && (x < filter[0] || x > filter[1]) ? OUT : index ? index[i] : PLAIN;
      let list = this.buckets.get(b);
      if (!list) this.buckets.set(b, (list = []));
      list.push(i);
    }
  }

  private renderLayer(): void {
    const ctx = this.layer.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const p = this.ed.points();
    if (!p) return;
    const pal = this.settings.palette();
    const lut = this.settings.lut().css;
    const size = Math.max(1.5, Math.min(3.5, this.vp.scale * 0.02)) * this.settings.view().pointSize;
    const half = size / 2;
    const order = [...this.buckets.keys()].sort((a, b) => (a === OUT ? -1 : b === OUT ? 1 : a - b));
    for (const b of order) {
      ctx.fillStyle = b === OUT ? pal.filteredOut : b === PLAIN ? pal.plain : lut[b];
      for (const i of this.buckets.get(b)!) {
        const [sx, sy] = this.vp.toScreen(p.data[i * STRIDE + 1], p.data[i * STRIDE + 2]);
        if (sx < -4 || sy < -4 || sx > this.width + 4 || sy > this.height + 4) continue;
        ctx.fillRect(sx - half, sy - half, size, size);
      }
    }
    this.layerDirty = false;
  }

  protected draw(ctx: CanvasRenderingContext2D): void {
    this.begin(ctx, this.pal().background);
    this.drawGrid(ctx);
    if (this.layerDirty) this.renderLayer();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawGtGuide(ctx);
    if (this.settings.view().showPrelabel) this.drawPrelabel(ctx);
    this.drawAxles(ctx);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const step = gridStep(this.vp.scale);
    const [u0] = this.vp.toWorld(0, 0);
    const [u1] = this.vp.toWorld(this.width, 0);
    const pal = this.pal();
    ctx.strokeStyle = pal.grid;
    ctx.fillStyle = pal.gridLabel;
    ctx.font = '11px ui-monospace, monospace';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let u = Math.ceil(u0 / step) * step; u <= u1; u += step) {
      const [sx] = this.vp.toScreen(u, 0);
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, this.height);
      ctx.fillText(`${+u.toFixed(2)}`, sx + 3, this.height - 22);
    }
    ctx.stroke();
    const [, gy] = this.vp.toScreen(0, 0);
    ctx.strokeStyle = pal.ground;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(this.width, gy);
    ctx.stroke();
  }

  private circle(ctx: CanvasRenderingContext2D, y: number, z: number, r: number): [number, number, number] {
    const [sx, sy] = this.vp.toScreen(y, z);
    const sr = r * this.vp.scale;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    return [sx, sy, sr];
  }

  private drawGtGuide(ctx: CanvasRenderingContext2D): void {
    const guide = this.ed.gtGuide();
    if (!guide) return;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = this.pal().gt;
    ctx.fillStyle = this.pal().gt;
    ctx.lineWidth = 1.2;
    ctx.font = '11px ui-monospace, monospace';
    const [, gy] = this.vp.toScreen(0, 0);
    guide.positions.forEach((y, i) => {
      const [sx, sy, sr] = this.circle(ctx, y, guide.z, guide.radius);
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx, gy);
      ctx.lineTo(sx, sy - sr - 18);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(`GT${i + 1}`, sx + 3, sy - sr - 8);
    });
    ctx.restore();
  }

  private drawPrelabel(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = this.pal().prelabel;
    ctx.lineWidth = 1.5;
    for (const p of this.ed.prelabelAxles()) {
      this.circle(ctx, p.y, p.z, p.radius);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawAxles(ctx: CanvasRenderingContext2D): void {
    const selected = this.ed.selectedKey();
    const pal = this.pal();
    ctx.font = 'bold 12px ui-monospace, monospace';
    this.ed.sortedAxles().forEach((a, i) => {
      const color = a.type === 'axle' ? pal.axle : pal.liftAxle;
      const isSel = a.key === selected;
      const [sx, sy, sr] = this.circle(ctx, a.y, a.z, a.radius);
      if (isSel) {
        ctx.fillStyle = color + '22';
        ctx.fill();
      }
      ctx.strokeStyle = isSel ? pal.selected : color;
      ctx.lineWidth = isSel ? 2.5 : 1.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy);
      ctx.lineTo(sx + 5, sy);
      ctx.moveTo(sx, sy - 5);
      ctx.lineTo(sx, sy + 5);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(`${i + 1}${a.type === 'lift_axle' ? ' L' : ''}`, sx - 4, sy + sr + 15);
      if (isSel) {
        const [hx, hy] = this.rimHandle(sx, sy, sr);
        ctx.fillStyle = pal.selected;
        ctx.fillRect(hx - HANDLE_PX / 2, hy - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
      }
    });
  }

  private rimHandle(sx: number, sy: number, sr: number): [number, number] {
    return [sx + sr * Math.SQRT1_2, sy - sr * Math.SQRT1_2];
  }

  private hit(px: number, py: number): { mode: 'move' | 'radius'; key: number } | null {
    const sel = this.ed.selected();
    if (sel) {
      const [sx, sy] = this.vp.toScreen(sel.y, sel.z);
      const sr = sel.radius * this.vp.scale;
      const [hx, hy] = this.rimHandle(sx, sy, sr);
      const d = Math.hypot(px - sx, py - sy);
      if (Math.hypot(px - hx, py - hy) <= HANDLE_PX || Math.abs(d - sr) <= 4) {
        return { mode: 'radius', key: sel.key };
      }
    }
    let best: { key: number; d: number } | null = null;
    for (const a of this.ed.axles()) {
      const [sx, sy] = this.vp.toScreen(a.y, a.z);
      const d = Math.hypot(px - sx, py - sy);
      if (d <= a.radius * this.vp.scale && (!best || d < best.d)) best = { key: a.key, d };
    }
    return best ? { mode: 'move', key: best.key } : null;
  }

  down(e: PointerEvent): void {
    const [px, py] = this.local(e);
    const [u, v] = this.vp.toWorld(px, py);
    const target = e.button === 0 ? this.hit(px, py) : null;
    this.canvas.setPointerCapture(e.pointerId);
    const a = target ? this.ed.axles().find((x) => x.key === target.key)! : null;
    this.drag = {
      mode: target?.mode ?? 'pan',
      key: target?.key ?? null,
      lastX: px, lastY: py, startU: u, startV: v,
      startY: a?.y ?? 0, startZ: a?.z ?? 0, moved: false,
    };
    if (target) {
      this.ed.select(target.key);
      this.ed.beginGesture();
    }
  }

  move(e: PointerEvent): void {
    const [px, py] = this.local(e);
    const [u, v] = this.vp.toWorld(px, py);
    this.ed.cursor.set([u, v]);
    const d = this.drag;
    if (!d) {
      const h = this.hit(px, py);
      this.cursorStyle.set(h ? (h.mode === 'radius' ? 'nesw-resize' : 'move') : 'crosshair');
      return;
    }
    d.moved ||= Math.hypot(px - d.lastX, py - d.lastY) > 2 || d.mode !== 'pan';
    if (d.mode === 'pan') {
      this.vp.pan(px - d.lastX, py - d.lastY);
      d.lastX = px;
      d.lastY = py;
      this.layerDirty = true;
      this.requestDraw();
    } else if (d.mode === 'move' && d.key !== null) {
      const dz = e.shiftKey ? 0 : v - d.startV;
      this.ed.updateAxle(d.key, { y: d.startY + (u - d.startU), z: d.startZ + dz }, true);
    } else if (d.mode === 'radius' && d.key !== null) {
      const a = this.ed.axles().find((x) => x.key === d.key);
      if (a) this.ed.updateAxle(d.key, { radius: Math.hypot(u - a.y, v - a.z) }, true);
    }
  }

  up(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d.mode === 'pan' && !d.moved && e.button === 0) this.ed.select(null);
    if (d.mode !== 'pan') this.ed.endGesture();
    this.drag = null;
  }

  wheel(e: WheelEvent): void {
    e.preventDefault();
    const [px, py] = this.local(e);
    this.vp.zoomAt(px, py, Math.exp(-e.deltaY * 0.0015));
    this.layerDirty = true;
    this.requestDraw();
  }

  dbl(e: MouseEvent): void {
    const [px, py] = this.local(e);
    if (this.hit(px, py)) return;
    const [u] = this.vp.toWorld(px, py);
    this.ed.addAxle(u);
  }
}
