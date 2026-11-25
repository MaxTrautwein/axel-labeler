import json

import pytest
from conftest import VID, make_points, write_pcd
from fastapi.testclient import TestClient

from axel_labler.server import create_app


@pytest.fixture
def client(cfg, prelabel):
    return TestClient(create_app(cfg))


def test_health_and_config(client):
    assert client.get("/api/health").json()["ok"]
    assert client.get("/api/config").json()["gt_tolerance_m"] == 0.1


def test_vehicle_roundtrip(client):
    assert [v["id"] for v in client.get("/api/vehicles").json()] == [VID]
    r = client.get(f"/api/vehicles/{VID}")
    assert r.status_code == 200
    body = r.json()
    etag = r.headers["etag"]
    assert body["doc"]["ground_truth"]["axle_space"] == "0;411;133"
    assert body["summary"]["label_state"] == "prelabeled"

    edit = {"axles": body["doc"]["axles"], "review": {"status": "ok", "comment": ""}}
    edit["axles"][0]["radius"] = 0.52
    assert client.put(f"/api/vehicles/{VID}", json=edit).status_code == 409  # no If-Match
    r = client.put(f"/api/vehicles/{VID}", json=edit, headers={"If-Match": etag})
    assert r.status_code == 200
    assert r.json()["doc"]["review"]["status"] == "ok"
    assert r.headers["etag"] != etag
    assert (
        client.put(f"/api/vehicles/{VID}", json=edit, headers={"If-Match": etag}).status_code == 409
    )

    bad = {"axles": [{**edit["axles"][0], "x_min": 3, "x_max": 1}], "review": edit["review"]}
    r = client.put(f"/api/vehicles/{VID}", json=bad, headers={"If-Match": r.headers["etag"]})
    assert r.status_code == 422


def test_points(client):
    r = client.get(f"/api/vehicles/{VID}/points")
    n = len(make_points())
    assert int(r.headers["x-point-count"]) == n
    assert len(r.content) == n * 16


def test_autodepth(client):
    r = client.post(f"/api/vehicles/{VID}/autodepth", json={"y": 9.137, "z": 0.512, "radius": 0.5})
    assert r.status_code == 200 and abs(r.json()["x_max"] - 2.01) < 0.02
    r = client.post(f"/api/vehicles/{VID}/autodepth", json={"y": 50, "z": 0.5, "radius": 0.5})
    assert r.status_code == 422


def test_unknown_vehicle(client):
    assert client.get("/api/vehicles/nope").status_code == 404
    assert client.get("/api/vehicles/..%2Fx").status_code == 404


def test_export(client, dirs):
    write_pcd(dirs["pcd"] / "veh-0002.pcd", make_points(seed=2))
    for vid in (VID, "veh-0002"):
        r = client.get(f"/api/vehicles/{vid}")
        doc = r.json()["doc"]
        edit = {"axles": doc["axles"], "review": {"status": "ok", "comment": ""}}
        assert client.put(
            f"/api/vehicles/{vid}", json=edit, headers={"If-Match": r.headers["etag"]}
        )
    write_pcd(dirs["pcd"] / "veh-0002.pcd", make_points(seed=3))  # now stale

    r = client.post("/api/export", json={"review_status": "ok"})
    assert r.status_code == 200
    manifest = r.json()["manifest"]
    assert manifest["count"] == 1
    item = manifest["items"][0]
    assert item["pcd"] == f"/mnt/share/pcd/{VID}.pcd"
    assert item["labels"].startswith("/mnt/share/export/") and item["axle_count"] == 3
    assert manifest["skipped"] == [{"vehicle_id": "veh-0002", "reason": "stale_pcd"}]

    folder = next(dirs["export"].iterdir())
    on_disk = json.loads((folder / "manifest.json").read_text())
    assert on_disk == manifest
    copied = folder / "labels" / f"{VID}.axles.json"
    assert copied.read_bytes() == (dirs["labels"] / f"{VID}.axles.json").read_bytes()
