import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

/** Base for the 2D canvas views: HiDPI sizing that follows the host element, draw scheduling. */
@Directive()
export abstract class CanvasView implements AfterViewInit, OnDestroy {
  protected readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected canvas!: HTMLCanvasElement;
  protected ctx: CanvasRenderingContext2D | null = null;
  protected width = 0;
  protected height = 0;
  protected dpr = 1;
  private raf = 0;
  private observer?: ResizeObserver;

  ngAfterViewInit(): void {
    this.canvas = this.host.nativeElement.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d');
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host.nativeElement);
    this.resize();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    cancelAnimationFrame(this.raf);
  }

  requestDraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.ctx && this.width > 0 && this.height > 0) this.draw(this.ctx);
    });
  }

  protected abstract draw(ctx: CanvasRenderingContext2D): void;

  protected onResize(): void {}

  protected local(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Start drawing in CSS pixels. */
  protected begin(ctx: CanvasRenderingContext2D, background: string): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private resize(): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.width = Math.max(0, Math.floor(rect.width));
    this.height = Math.max(0, Math.floor(rect.height));
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.onResize();
    this.requestDraw();
  }
}

/** Grid step (m) so that lines are at least minPx apart. */
export function gridStep(scale: number, minPx = 60): number {
  for (const s of [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]) if (s * scale >= minPx) return s;
  return 50;
}
