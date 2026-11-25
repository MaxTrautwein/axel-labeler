import pytest

from axel_labler.gt import compare, parse
from axel_labler.model import GroundTruth


def gt(s):
    return GroundTruth(axle_space=s)


def test_parse():
    assert parse("0;411;133") == [0, 411, 133]
    assert parse(" 0 ; 360.5 ;") == [0, 360.5]
    for bad in ("", ";", "a;b", "3,5;2"):
        with pytest.raises(ValueError):
            parse(bad)


def test_compare_states():
    ys = [9.13, 5.02, 3.69]  # gaps 4.11, 1.33
    assert compare(gt("0;411;133"), ys, 0.1)[0] == "match"
    assert compare(gt("0;411;133"), list(reversed(ys)), 0.1)[0] == "match"
    assert compare(gt("0;411;150"), ys, 0.1)[0] == "gap_mismatch"
    assert compare(gt("0;411"), ys, 0.1)[0] == "count_mismatch"
    assert compare(gt("x"), ys, 0.1)[0] == "invalid"
    assert compare(None, ys, 0.1)[0] == "missing"
    assert compare(gt(None), ys, 0.1)[0] == "missing"


def test_compare_rows():
    state, rows = compare(gt("0;411;150"), [9.13, 5.02, 3.69], 0.1)
    assert [r.ok for r in rows] == [True, False]
    assert rows[1].gt_m == 1.5
    assert rows[1].delta_m == pytest.approx(1.33 - 1.5)
