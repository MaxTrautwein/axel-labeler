// Ground-truth interpretation; mirrors backend/src/axel_labler/gt.py.
// axle_space: ';'-separated cm, one value per axle on the ground. values[1:] are the gaps between
// consecutive regular axles (front to back); values[0] is not used.
import { GtState } from './models';

export interface GapRow {
  index: number;
  gtM: number | null;
  measuredM: number | null;
  deltaM: number | null;
  ok: boolean | null;
}

export interface GtComparison {
  state: GtState;
  values: number[] | null;
  rows: GapRow[];
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

export function parseAxleSpace(axleSpace: string): number[] | null {
  const tokens = axleSpace.split(';').map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.some((t) => !NUMBER.test(t))) return null;
  return tokens.map(Number);
}

export function compareGt(
  axleSpace: string | null | undefined,
  regularY: number[],
  tolM: number,
): GtComparison {
  if (axleSpace == null) return { state: 'missing', values: null, rows: [] };
  const values = parseAxleSpace(axleSpace);
  if (values === null) return { state: 'invalid', values: null, rows: [] };
  const ys = [...regularY].sort((a, b) => b - a);
  const gtGaps = values.slice(1).map((v) => v / 100);
  const measured = ys.slice(0, -1).map((y, i) => y - ys[i + 1]);
  const rows: GapRow[] = [];
  for (let i = 0; i < Math.max(gtGaps.length, measured.length); i++) {
    const g = i < gtGaps.length ? gtGaps[i] : null;
    const m = i < measured.length ? measured[i] : null;
    const d = g !== null && m !== null ? m - g : null;
    rows.push({ index: i, gtM: g, measuredM: m, deltaM: d, ok: d === null ? null : Math.abs(d) <= tolM });
  }
  let state: GtState = 'match';
  if (ys.length !== values.length) state = 'count_mismatch';
  else if (rows.some((r) => r.ok === false)) state = 'gap_mismatch';
  return { state, values, rows };
}

/** Axle positions (front to back) when the regular axle number anchorIndex (0 = front-most) sits at anchorY. */
export function gtPositions(anchorY: number, values: number[], anchorIndex = 0): number[] {
  const out = [0];
  for (const v of values.slice(1)) out.push(out[out.length - 1] - v / 100);
  const shift = anchorY - out[anchorIndex];
  return out.map((y) => y + shift);
}
