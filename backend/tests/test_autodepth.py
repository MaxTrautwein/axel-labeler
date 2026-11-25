import numpy as np
from conftest import TIRE_X, WHEELS, make_points

from axel_labler.autodepth import fit_depth


def test_fit_finds_near_side_wheel_set():
    pts = make_points()
    for wy, wz, r in WHEELS:
        fit = fit_depth(pts, wy, wz, r)
        assert fit is not None
        assert abs(fit.x_max - TIRE_X[1]) < 0.02  # outlier at x=2.6 ignored
        assert abs(fit.x_min - TIRE_X[0]) < 0.02  # far-side cluster ignored
        assert fit.warning is None


def test_fit_caps_depth():
    rng = np.random.default_rng(1)
    n = 2000
    pts = np.column_stack(
        [rng.uniform(0, 2, n), rng.uniform(-0.4, 0.4, n), rng.uniform(0.1, 0.9, n), np.zeros(n)]
    )
    fit = fit_depth(pts, 0, 0.5, 0.5, max_depth_m=0.8)
    assert fit.x_max - fit.x_min == 0.8
    assert fit.warning


def test_fit_too_few_points():
    assert fit_depth(np.zeros((5, 4)), 0, 0.5, 0.5) is None
