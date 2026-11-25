import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class Notify {
  readonly toasts = signal<Toast[]>([]);
  private next = 1;

  info(text: string): void {
    this.push('info', text, 4000);
  }

  error(text: string): void {
    this.push('error', text, 9000);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(kind: Toast['kind'], text: string, ms: number): void {
    const id = this.next++;
    this.toasts.update((list) => [...list.slice(-4), { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
}
