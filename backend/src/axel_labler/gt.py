"""Ground-truth axle spacing: parsing and comparison (no database access).

Convention (see docs/label-format.md): axle_space holds one value per axle on the ground, in cm.
values[1:] are the gaps between consecutive regular axles, front to back; the meaning of values[0]
is unknown and it is not used. Raised lift axles are not part of the ground truth.
"""

from dataclasses import dataclass

from axel_labler.model import GroundTruth, GtState


@dataclass
class GapRow:
    index: int  # gap between regular axle `index` and `index + 1` (0-based, front to back)
    gt_m: float | None
    measured_m: float | None
    delta_m: float | None
    ok: bool | None


def parse(axle_space: str) -> list[float]:
    """';'-separated centimetres -> floats. Raises ValueError for anything else."""
    tokens = [t.strip() for t in axle_space.split(";")]
    values = [float(t) for t in tokens if t]
    if not values:
        raise ValueError("empty axle_space")
    return values


def compare(
    gt: GroundTruth | None, regular_y: list[float], tol_m: float
) -> tuple[GtState, list[GapRow]]:
    """Compare GT gaps with the measured gaps of the regular axles (any order of regular_y)."""
    if gt is None or gt.axle_space is None:
        return "missing", []
    try:
        values = parse(gt.axle_space)
    except ValueError:
        return "invalid", []
    ys = sorted(regular_y, reverse=True)
    gt_gaps = [v / 100 for v in values[1:]]
    measured = [ys[i] - ys[i + 1] for i in range(len(ys) - 1)]
    rows = []
    for i in range(max(len(gt_gaps), len(measured))):
        g = gt_gaps[i] if i < len(gt_gaps) else None
        m = measured[i] if i < len(measured) else None
        d = m - g if g is not None and m is not None else None
        rows.append(GapRow(i, g, m, d, None if d is None else abs(d) <= tol_m))
    if len(ys) != len(values):
        return "count_mismatch", rows
    if any(r.ok is False for r in rows):
        return "gap_mismatch", rows
    return "match", rows
