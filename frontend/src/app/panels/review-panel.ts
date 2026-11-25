import { DatePipe } from '@angular/common';
import { Component, ElementRef, effect, inject, untracked, viewChild } from '@angular/core';

import { EditorStore } from '../core/editor';
import { ReviewStatus } from '../core/models';

@Component({
  selector: 'app-review-panel',
  imports: [DatePipe],
  template: `
    <section class="card card-body p-2">
      <header class="panel-head">
        <h3>Review</h3>
        @if (ed.doc()?.review?.reviewed_at; as at) {
          <span class="muted small">{{ at | date: 'short' }}</span>
        }
      </header>
      <div class="btn-group btn-group-sm w-100 mb-2" role="group" aria-label="Review status">
        <button type="button" class="btn btn-outline-success" [class.active]="ed.review().status === 'ok'"
          [attr.aria-pressed]="ed.review().status === 'ok'" (click)="set('ok')" title="Labels are correct (O)">OK</button>
        <button type="button" class="btn btn-outline-danger" [class.active]="ed.review().status === 'not_ok'"
          [attr.aria-pressed]="ed.review().status === 'not_ok'" (click)="set('not_ok')" title="Labels are wrong (N)">Not OK</button>
        <button type="button" class="btn btn-outline-secondary" [class.active]="ed.review().status === 'unreviewed'"
          [attr.aria-pressed]="ed.review().status === 'unreviewed'" (click)="set('unreviewed')">Unreviewed</button>
      </div>
      <textarea #comment class="form-control form-control-sm" rows="2" placeholder="Comment (what is wrong?)" [value]="ed.review().comment"
        (input)="ed.setComment(comment.value)" (keydown.escape)="comment.blur()"></textarea>
      <p class="muted small mb-0 mt-1">Editing axles after a review resets it to unreviewed.</p>
    </section>
  `,
  styles: `
    .btn-group .btn { flex: 1; }
    .btn-outline-success { --bs-btn-color: var(--good); --bs-btn-border-color: var(--good); --bs-btn-hover-bg: var(--good);
      --bs-btn-hover-border-color: var(--good); --bs-btn-active-bg: var(--good); --bs-btn-active-border-color: var(--good);
      --bs-btn-hover-color: var(--on-status); --bs-btn-active-color: var(--on-status); }
    .btn-outline-danger { --bs-btn-color: var(--bad); --bs-btn-border-color: var(--bad); --bs-btn-hover-bg: var(--bad);
      --bs-btn-hover-border-color: var(--bad); --bs-btn-active-bg: var(--bad); --bs-btn-active-border-color: var(--bad);
      --bs-btn-hover-color: var(--on-status); --bs-btn-active-color: var(--on-status); }
    textarea { resize: vertical; }
  `,
})
export class ReviewPanel {
  readonly ed = inject(EditorStore);
  private readonly comment = viewChild.required<ElementRef<HTMLTextAreaElement>>('comment');

  constructor() {
    effect(() => {
      if (this.ed.focusComment() > 0) untracked(() => this.comment().nativeElement.focus());
    });
  }

  set(status: ReviewStatus): void {
    this.ed.setReviewStatus(status);
    if (status === 'not_ok') this.comment().nativeElement.focus();
    void this.ed.save();
  }
}
