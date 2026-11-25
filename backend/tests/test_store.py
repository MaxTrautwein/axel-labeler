import json

import pytest
from conftest import AXLE_SPACE, VID, make_points, prelabel_doc, write_pcd

from axel_labler.model import LabelDoc, LabelEdit, ReviewEdit
from axel_labler.store import (
    ConflictError,
    InvalidError,
    NotFoundError,
    Store,
    etag,
)


def edit(doc, status=None, comment="", **changes):
    axles = [a.model_copy(update=changes) for a in doc.axles]
    return LabelEdit(
        axles=axles, review=ReviewEdit(status=status or doc.review.status, comment=comment)
    )


def test_open_without_prelabel_creates_manual_doc(store, vehicle, dirs):
    r = store.open(vehicle)
    assert r.doc.axles == [] and r.doc.prelabel is None and r.doc.ground_truth is None
    assert r.doc.frame.transform["params"]["yaw_deg"] == 180.0  # copied verbatim
    assert r.doc.pcd.point_count == len(make_points())
    assert not r.stale
    on_disk = LabelDoc.model_validate_json((dirs["labels"] / f"{VID}.axles.json").read_bytes())
    assert on_disk == r.doc
    assert store.summary(VID).label_state == "none"


def test_prelabel_import_keeps_reference_verbatim(store, prelabel):
    r = store.open(VID)
    doc = r.doc
    assert doc.prelabel.document == json.loads(prelabel.read_bytes())
    assert doc.ground_truth.axle_space == AXLE_SPACE
    assert doc.ground_truth.weighing_data_id == 4711
    # sorted front to back, linked to their prelabel axle, depth filled by autodepth
    assert [a.y for a in doc.axles] == [9.12, 5.03, 3.7]
    assert [a.prelabel_index for a in doc.axles] == [1, 0, 2]
    assert all(abs(a.x_max - 2.01) < 0.03 for a in doc.axles)
    s = store.summary(VID)
    assert s.label_state == "prelabeled" and s.gt_state == "match" and s.axle_count == 3


def test_summary_before_import(store, prelabel):
    store.rescan()
    s = store.summary(VID)
    assert s.label_state == "prelabel_available" and s.has_prelabel and s.gt_state == "match"


def test_save_requires_current_etag(store, prelabel):
    doc = store.open(VID).doc
    with pytest.raises(ConflictError):
        store.save(VID, edit(doc), None)
    with pytest.raises(ConflictError):
        store.save(VID, edit(doc), '"2000-01-01T00:00:00+00:00"')
    saved = store.save(VID, edit(doc, radius=0.51), f'"{etag(doc)}"')
    assert all(a.radius == 0.51 for a in saved.axles)
    assert store.summary(VID).label_state == "edited"
    with pytest.raises(ConflictError):  # old etag is no longer valid
        store.save(VID, edit(doc), etag(doc))


def test_noop_save_does_not_write(store, prelabel):
    doc = store.open(VID).doc
    assert store.save(VID, edit(doc), etag(doc)).updated_at == doc.updated_at


def test_review_reset_on_axle_edit(store, prelabel):
    doc = store.open(VID).doc
    doc = store.save(VID, edit(doc, status="ok", comment="fine"), etag(doc))
    assert doc.review.status == "ok" and doc.review.reviewed_at is not None
    doc = store.save(VID, edit(doc, status="ok", comment="fine", z=0.5), etag(doc))
    assert doc.review.status == "unreviewed" and doc.review.comment == "fine"
    # setting the status in the same save as an edit is an explicit review of the new axles
    doc = store.save(VID, edit(doc, status="not_ok", z=0.52), etag(doc))
    assert doc.review.status == "not_ok"


def test_prelabel_index_validated(store, vehicle):
    doc = store.open(vehicle).doc
    from axel_labler.model import LabelAxle

    bad = LabelAxle(type="axle", y=1, z=0.5, radius=0.5, x_min=1, x_max=2, prelabel_index=0)
    with pytest.raises(InvalidError):
        store.save(
            vehicle, LabelEdit(axles=[bad], review=ReviewEdit(status="unreviewed")), etag(doc)
        )


def test_lift_axles_excluded_from_gt(store, prelabel):
    doc = store.open(VID).doc
    from axel_labler.model import LabelAxle

    lift = LabelAxle(type="lift_axle", y=7.0, z=0.7, radius=0.5, x_min=1.6, x_max=2.0)
    e = edit(doc)
    e.axles.append(lift)
    store.save(VID, e, etag(doc))
    s = store.summary(VID)
    assert s.gt_state == "match" and s.lift_axle_count == 1 and s.axle_count == 3


def test_updated_prelabel_and_reimport(store, prelabel):
    doc = store.open(VID).doc
    store.save(VID, edit(doc, status="ok"), etag(doc))
    newer = prelabel_doc(axle_space="0;410;133")
    newer["axles"] = newer["axles"][:2]
    prelabel.write_text(json.dumps(newer))
    store.rescan()
    assert store.summary(VID).prelabel_updated
    r = store.open(VID)
    assert r.prelabel_updated
    kept = store.reimport_prelabel(VID, keep_axles=True).doc
    assert len(kept.axles) == 3 and all(a.prelabel_index is None for a in kept.axles)
    assert kept.ground_truth.axle_space == "0;410;133"
    replaced = store.reimport_prelabel(VID, keep_axles=False)
    assert len(replaced.doc.axles) == 2 and not replaced.prelabel_updated
    assert replaced.doc.review.status == "unreviewed"


def test_invalid_prelabel_is_a_warning(store, vehicle, dirs):
    (dirs["prelabels"] / f"{vehicle}.prelabel.json").write_text('{"format": "nope"}')
    r = store.open(vehicle)
    assert r.doc.prelabel is None and r.warnings
    store.rescan()
    assert store.summary(vehicle).error


def test_prelabel_for_other_vehicle_rejected(store, vehicle, dirs):
    (dirs["prelabels"] / f"{vehicle}.prelabel.json").write_text(json.dumps(prelabel_doc("other")))
    assert store.open(vehicle).warnings


def test_stale_pcd_and_accept(store, prelabel, dirs):
    doc = store.open(VID).doc
    store.save(VID, edit(doc, status="ok"), etag(doc))
    write_pcd(dirs["pcd"] / f"{VID}.pcd", make_points(seed=1))
    r = store.open(VID)
    assert r.stale and store.summary(VID).stale
    r = store.accept_pcd(VID)
    assert not r.stale and r.doc.review.status == "unreviewed"


def test_ids_are_validated(store):
    for bad in ("../etc/passwd", ".hidden", "a/b", ""):
        with pytest.raises(NotFoundError):
            store.open(bad)


def test_index_cache_avoids_rereading(cfg, prelabel, monkeypatch):
    first = Store(cfg)
    first.startup()
    first.open(VID)
    second = Store(cfg)

    def boom(*_a, **_k):
        raise AssertionError("file re-read although unchanged")

    monkeypatch.setattr(second, "_read_label_info", boom)
    monkeypatch.setattr(second, "_read_prelabel_info", boom)
    second.startup()
    assert second.summary(VID).label_state == "prelabeled"


def test_import_all(store, prelabel, dirs):
    write_pcd(dirs["pcd"] / "veh-0002.pcd", make_points(seed=2))
    result = store.import_all()
    assert result["imported"] == 1 and result["failed"] == []
    assert store.summary(VID).label_state == "prelabeled"
    assert store.summary("veh-0002").label_state == "none"


def test_raw_pcds_and_tmp_files_ignored(store, dirs, vehicle):
    write_pcd(dirs["pcd"] / f"{vehicle}_raw.pcd", make_points())
    (dirs["labels"] / f".{vehicle}.axles.json.tmp-123").write_text("garbage")
    store.rescan()
    assert [s.id for s in store.summaries()] == [vehicle]
