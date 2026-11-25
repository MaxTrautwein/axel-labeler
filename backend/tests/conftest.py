import json
from pathlib import Path

import numpy as np
import pytest
from pypcd4 import PointCloud

from axel_labler.config import Config
from axel_labler.store import Store

VID = "veh-0001"
# Wheels (y, z, radius); y deliberately NOT on a 5 cm grid (no grid snapping assumed).
WHEELS = [(9.137, 0.512, 0.5), (5.0213, 0.498, 0.5), (3.6871, 0.505, 0.5)]
TIRE_X = (1.62, 2.01)  # visible sensor-side wheel set
AXLE_SPACE = "0;411;133"  # verbatim DB string, cm: gaps 4.11 m and 1.33 m


def make_points(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    parts = []
    for wy, wz, r in WHEELS:
        n = 1500
        ang = rng.uniform(0, 2 * np.pi, n)
        rad = r * np.sqrt(rng.uniform(0, 1, n))
        y = wy + rad * np.cos(ang)
        z = wz + rad * np.sin(ang)
        x = rng.uniform(*TIRE_X, n)
        parts.append(np.column_stack([x, y, z]))
        # far-side wheel seen under the vehicle
        m = 200
        parts.append(
            np.column_stack(
                [rng.uniform(0.0, 0.3, m), wy + rng.uniform(-0.3, 0.3, m), rng.uniform(0.3, 0.7, m)]
            )
        )
    # body above the wheels
    k = 3000
    parts.append(
        np.column_stack([rng.uniform(0, 2.1, k), rng.uniform(0, 10, k), rng.uniform(1.1, 3.5, k)])
    )
    # stray outlier on the sensor side inside the first wheel circle
    parts.append(np.array([[2.6, WHEELS[0][0], WHEELS[0][1]]]))
    xyz = np.concatenate(parts).astype(np.float32)
    refl = rng.uniform(0, 100, len(xyz)).astype(np.float32)
    return np.column_stack([xyz, refl])


def write_pcd(path: Path, points: np.ndarray) -> None:
    pc = PointCloud.from_points(
        points, ("x", "y", "z", "reflectivity"), (np.float32, np.float32, np.float32, np.float32)
    )
    pc.save(str(path))


def prelabel_doc(vid: str = VID, axle_space: str | None = AXLE_SPACE, **extra) -> dict:
    doc = {
        "format": "axel-prelabel",
        "format_version": 1,
        "vehicle_id": vid,
        "pcd": {"file": f"{vid}.pcd", "sha256": None},
        "tool": {"name": "my-prelabeler", "version": "abc1234"},
        "created_at": "2000-01-01T10:00:00Z",
        "ground_truth": {
            "axle_space": axle_space,
            "source": "DB.Table",
            "weighing_data_id": 4711,
        },
        # deliberately unsorted, slightly off, without depth
        "axles": [
            {"type": "axle", "y": 5.03, "z": 0.49, "radius": 0.49, "score": 12.5},
            {"type": "axle", "y": 9.12, "z": 0.49, "radius": 0.49, "score": 15.25},
            {"type": "axle", "y": 3.70, "z": 0.49, "radius": 0.49, "score": 9.0},
        ],
        "tool_meta": {"cy": 0.49, "offset": -1.44},
    }
    doc.update(extra)
    return doc


@pytest.fixture
def dirs(tmp_path: Path) -> dict[str, Path]:
    d = {n: tmp_path / n for n in ("pcd", "prelabels", "labels", "export", "cache")}
    for p in d.values():
        p.mkdir()
    return d


@pytest.fixture
def cfg(dirs) -> Config:
    return Config(
        pcd_dir=dirs["pcd"],
        labels_dir=dirs["labels"],
        prelabel_dir=dirs["prelabels"],
        export_dir=dirs["export"],
        cache_dir=dirs["cache"],
        pcd_dir_host="/mnt/share/pcd",
        export_dir_host="/mnt/share/export",
    )


@pytest.fixture
def vehicle(dirs) -> str:
    write_pcd(dirs["pcd"] / f"{VID}.pcd", make_points())
    (dirs["pcd"] / f"{VID}.transform.json").write_text(
        json.dumps({"params": {"yaw_deg": 180.0, "origin": [-2.5, -10.25]}, "config": {}})
    )
    return VID


@pytest.fixture
def prelabel(dirs, vehicle) -> Path:
    path = dirs["prelabels"] / f"{vehicle}.prelabel.json"
    # odd formatting on purpose: the stored copy must keep values, not bytes of formatting
    path.write_text(json.dumps(prelabel_doc(), indent=4))
    return path


@pytest.fixture
def store(cfg) -> Store:
    s = Store(cfg)
    s.startup()
    return s
