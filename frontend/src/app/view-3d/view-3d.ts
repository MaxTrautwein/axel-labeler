import { AfterViewInit, Component, ElementRef, OnDestroy, effect, inject, untracked } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { EditorStore } from '../core/editor';
import { Points, STRIDE } from '../core/models';
import { SettingsStore } from '../core/settings';

const POINT_SIZE_M = 0.035;

/** Read-only 3D check view (lazy-loaded via @defer). Axles are cylinders with their axis along x. */
@Component({
  selector: 'app-view-3d',
  template: `<canvas></canvas>
    <div class="hint">drag: rotate · right-drag: pan · wheel: zoom</div>`,
  styles: `
    :host { position: relative; display: block; overflow: hidden; background: var(--canvas-bg); }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .hint { position: absolute; left: 8px; bottom: 6px; font: 12px var(--mono); color: var(--muted); }
  `,
})
export class View3d implements AfterViewInit, OnDestroy {
  private readonly ed = inject(EditorStore);
  private readonly settings = inject(SettingsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
  private controls: OrbitControls | null = null;
  private cloud: THREE.Points | null = null;
  private readonly axleGroup = new THREE.Group();
  private observer?: ResizeObserver;

  constructor() {
    effect(() => {
      const p = this.ed.points();
      untracked(() => this.setPoints(p));
    });
    effect(() => {
      this.ed.pointColors();
      this.settings.lut();
      this.settings.palette();
      this.settings.view().pointSize;
      untracked(() => this.updateColors());
    });
    effect(() => {
      this.ed.axles();
      this.ed.selectedKey();
      this.settings.palette();
      untracked(() => this.setAxles());
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.host.nativeElement.querySelector('canvas')!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(this.axleGroup);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host.nativeElement);
    this.setPoints(this.ed.points());
    this.setAxles();
    this.resize();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.controls?.dispose();
    this.clearAxles();
    if (this.cloud) {
      this.cloud.geometry.dispose();
      (this.cloud.material as THREE.Material).dispose();
    }
    this.renderer?.dispose();
  }

  private setPoints(p: Points | null): void {
    if (!this.renderer) return;
    if (this.cloud) {
      this.scene.remove(this.cloud);
      this.cloud.geometry.dispose();
      (this.cloud.material as THREE.Material).dispose();
      this.cloud = null;
    }
    if (!p) return this.updateColors();
    const pos = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = p.data[i * STRIDE + k];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
    this.cloud = new THREE.Points(geo, new THREE.PointsMaterial({ size: POINT_SIZE_M, vertexColors: true }));
    this.scene.add(this.cloud);
    this.updateColors();
    const b = p.bounds;

    const center = new THREE.Vector3((b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2, (b.zMin + b.zMax) / 2);
    const length = b.yMax - b.yMin;
    this.camera.position.set(b.xMax + Math.max(6, length * 0.9), center.y - length * 0.35, center.z + 3);
    this.controls!.target.copy(center);
    this.controls!.update();
    this.render();
  }

  /** Point colours, point size and background from the current settings (keeps the camera). */
  private updateColors(): void {
    if (!this.renderer) return;
    const pal = this.settings.palette();
    this.scene.background = new THREE.Color(pal.background);
    if (this.cloud) {
      const attr = this.cloud.geometry.getAttribute('color') as THREE.BufferAttribute;
      const col = attr.array as Float32Array;
      const { index } = this.ed.pointColors();
      const lut = this.settings.lut().rgb;
      const plain = new THREE.Color(pal.plain);
      const n = col.length / 3;
      for (let i = 0; i < n; i++) {
        const [r, g, b] = index && i < index.length ? lut[index[i]] : [plain.r * 255, plain.g * 255, plain.b * 255];
        col[i * 3] = r / 255;
        col[i * 3 + 1] = g / 255;
        col[i * 3 + 2] = b / 255;
      }
      attr.needsUpdate = true;
      (this.cloud.material as THREE.PointsMaterial).size = POINT_SIZE_M * this.settings.view().pointSize;
    }
    this.render();
  }

  private clearAxles(): void {
    for (const child of [...this.axleGroup.children]) {
      this.axleGroup.remove(child);
      const obj = child as THREE.Mesh | THREE.LineSegments;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  }

  private setAxles(): void {
    if (!this.renderer) return;
    this.clearAxles();
    const selected = this.ed.selectedKey();
    const pal = this.settings.palette();
    for (const a of this.ed.axles()) {
      const color = a.key === selected ? pal.selected : a.type === 'axle' ? pal.axle : pal.liftAxle;
      const geo = new THREE.CylinderGeometry(a.radius, a.radius, a.x_max - a.x_min, 40);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }),
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 30),
        new THREE.LineBasicMaterial({ color }),
      );
      for (const obj of [mesh, edges]) {
        obj.rotation.z = Math.PI / 2; // cylinder axis (y) -> x
        obj.position.set((a.x_min + a.x_max) / 2, a.y, a.z);
        this.axleGroup.add(obj);
      }
    }
    this.render();
  }

  private resize(): void {
    if (!this.renderer) return;
    const { width, height } = this.host.nativeElement.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    this.renderer?.render(this.scene, this.camera);
  }
}
