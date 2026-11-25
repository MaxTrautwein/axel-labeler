import { History } from './history';

describe('History', () => {
  it('undoes and redoes snapshots', () => {
    const h = new History<number>();
    h.push(1); // state was 1, now 2
    h.push(2); // state was 2, now 3
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBeUndefined();
    expect(h.redo(1)).toBe(2);
    h.push(2); // a new change clears the redo stack
    expect(h.canRedo).toBe(false);
  });

  it('is bounded', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 10; i++) h.push(i);
    let n = 0;
    while (h.undo(0) !== undefined) n++;
    expect(n).toBe(3);
  });
});
