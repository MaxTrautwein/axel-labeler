"""Point loading. Only x, y, z (+ reflectivity if present) are used."""

from functools import lru_cache
from pathlib import Path

import numpy as np
from pypcd4 import PointCloud

FIELDS = ("x", "y", "z", "reflectivity")


def load_points(path: Path) -> np.ndarray:
    """(n, 4) float32 array [x, y, z, reflectivity]; rows with non-finite xyz are dropped."""
    st = path.stat()
    return _load(str(path), st.st_size, st.st_mtime_ns)


@lru_cache(maxsize=16)
def _load(path: str, _size: int, _mtime_ns: int) -> np.ndarray:
    data = PointCloud.from_path(path).pc_data
    n = len(data)
    out = np.zeros((n, 4), dtype=np.float32)
    for i, name in enumerate(FIELDS):
        if name in data.dtype.names:
            out[:, i] = data[name]
    out = out[np.isfinite(out[:, :3]).all(axis=1)]
    out[~np.isfinite(out[:, 3]), 3] = 0
    out.flags.writeable = False
    return out
