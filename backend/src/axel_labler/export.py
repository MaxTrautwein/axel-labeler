"""Export: a new folder with copies of the selected label files and a manifest.json."""

import posixpath
from pathlib import Path

from pydantic import ValidationError

from axel_labler import __version__
from axel_labler.fsio import atomic_write_bytes, sha256_file
from axel_labler.model import (
    ExportFilter,
    ExportItem,
    ExportManifest,
    ExportRoots,
    ExportSkipped,
    LabelDoc,
    ReviewStatus,
    utc_now,
)
from axel_labler.store import Store, StoreError


def _host(configured: str | None, actual: Path) -> str:
    return (configured or str(actual.resolve())).rstrip("/") or "/"


def run_export(store: Store, review_status: ReviewStatus = "ok") -> tuple[ExportManifest, Path]:
    cfg = store.cfg
    if cfg.export_dir is None:
        raise StoreError("no export directory configured (AXEL_EXPORT_DIR)")
    with store.lock:
        store.rescan()
        created = utc_now()
        stamp = created.strftime("%Y%m%d-%H%M%S")
        folder, n = cfg.export_dir / stamp, 1
        while folder.exists():
            n += 1
            folder = cfg.export_dir / f"{stamp}-{n}"
        (folder / "labels").mkdir(parents=True)
        pcd_root = _host(cfg.pcd_dir_host, cfg.pcd_dir)
        export_root = posixpath.join(_host(cfg.export_dir_host, cfg.export_dir), folder.name)

        items: list[ExportItem] = []
        skipped: list[ExportSkipped] = []
        for s in store.summaries():
            if s.review_status != review_status:
                continue
            path = store.label_path(s.id)
            try:
                raw = path.read_bytes()
                doc = LabelDoc.model_validate_json(raw)
            except (OSError, ValidationError):
                skipped.append(ExportSkipped(vehicle_id=s.id, reason="invalid"))
                continue
            if doc.review.status != review_status:
                continue
            pcd = store.pcd_path(s.id)
            if not pcd.exists():
                skipped.append(ExportSkipped(vehicle_id=s.id, reason="missing_pcd"))
                continue
            if sha256_file(pcd) != doc.pcd.sha256:
                skipped.append(ExportSkipped(vehicle_id=s.id, reason="stale_pcd"))
                continue
            atomic_write_bytes(folder / "labels" / path.name, raw)
            items.append(
                ExportItem(
                    vehicle_id=s.id,
                    pcd=posixpath.join(pcd_root, pcd.name),
                    labels=posixpath.join(export_root, "labels", path.name),
                    axle_count=sum(1 for a in doc.axles if a.type == "axle"),
                    lift_axle_count=sum(1 for a in doc.axles if a.type == "lift_axle"),
                    reviewed_at=doc.review.reviewed_at,
                )
            )
        manifest = ExportManifest(
            created_at=created,
            labeler_version=__version__,
            filter=ExportFilter(review_status=review_status),
            roots=ExportRoots(pcd=pcd_root, export=export_root),
            count=len(items),
            items=items,
            skipped=skipped,
        )
        data = (manifest.model_dump_json(indent=2) + "\n").encode()
        atomic_write_bytes(folder / "manifest.json", data)
        return manifest, folder
