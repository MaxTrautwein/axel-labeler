"""Lateral extent (x_min..x_max) of the visible sensor-side wheel set."""

from dataclasses import dataclass

import numpy as np

BIN_M = 0.02
GAP_M = 0.05
MIN_POINTS = 10
MIN_Z = 0.05


@dataclass
class DepthFit:
    x_min: float
    x_max: float
    n_points: int
    warning: str | None = None


def fit_depth(
    points: np.ndarray, y0: float, z0: float, radius: float, max_depth_m: float = 0.8
) -> DepthFit | None:
    """Fit from the points inside the side-view circle.

    Starting at the sensor side (largest x), take the first populated 2 cm bin (>= 10 % of the
    densest bin) and extend towards smaller x until ~5 cm without a populated bin. Isolated
    outliers on the sensor side and far-side structures (other wheels, chassis) are thereby
    ignored. None if too few points.
    """
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    inside = ((y - y0) ** 2 + (z - z0) ** 2 <= (0.95 * radius) ** 2) & (z >= MIN_Z)
    xs = x[inside].astype(np.float64)
    n = len(xs)
    if n < MIN_POINTS:
        return None
    top = xs.max()
    idx = np.floor((top - xs) / BIN_M).astype(int)
    counts = np.bincount(idx)
    threshold = max(3, 0.1 * counts.max())
    populated = counts >= threshold
    if not populated.any():
        return None
    start = int(np.argmax(populated))
    end = start
    gap_bins = round(GAP_M / BIN_M)
    empty = 0
    for i in range(start + 1, len(counts)):
        if populated[i]:
            end, empty = i, 0
        else:
            empty += 1
            if empty > gap_bins:
                break
    sel = (idx >= start) & (idx <= end)
    x_min, x_max = float(xs[sel].min()), float(xs[sel].max())
    warning = None
    if x_max - x_min > max_depth_m:
        x_min = x_max - max_depth_m
        warning = f"depth capped at {max_depth_m:.2f} m"
    if x_max - x_min < 0.01:
        x_min = x_max - 0.01
    return DepthFit(x_min, x_max, n, warning)
