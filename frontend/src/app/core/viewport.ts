/**
 * 2D view transform with equal aspect ratio. World coordinates (u, v) have v pointing up;
 * screen coordinates are CSS pixels with y pointing down.
 */
export class Viewport {
  scale = 100; // CSS px per metre
  ox = 0; // screen x of world u = 0
  oy = 0; // screen y of world v = 0

  static readonly MIN_SCALE = 2;
  static readonly MAX_SCALE = 20000;

  toScreen(u: number, v: number): [number, number] {
    return [this.ox + u * this.scale, this.oy - v * this.scale];
  }

  toWorld(px: number, py: number): [number, number] {
    return [(px - this.ox) / this.scale, (this.oy - py) / this.scale];
  }

  fit(uMin: number, uMax: number, vMin: number, vMax: number, width: number, height: number, pad = 24): void {
    const du = Math.max(uMax - uMin, 1e-3);
    const dv = Math.max(vMax - vMin, 1e-3);
    const w = Math.max(width - 2 * pad, 10);
    const h = Math.max(height - 2 * pad, 10);
    this.scale = clamp(Math.min(w / du, h / dv), Viewport.MIN_SCALE, Viewport.MAX_SCALE);
    const cu = (uMin + uMax) / 2;
    const cv = (vMin + vMax) / 2;
    this.ox = width / 2 - cu * this.scale;
    this.oy = height / 2 + cv * this.scale;
  }

  zoomAt(px: number, py: number, factor: number): void {
    const [u, v] = this.toWorld(px, py);
    this.scale = clamp(this.scale * factor, Viewport.MIN_SCALE, Viewport.MAX_SCALE);
    this.ox = px - u * this.scale;
    this.oy = py + v * this.scale;
  }

  pan(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
