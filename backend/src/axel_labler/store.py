"""Label documents on disk and the in-memory index of vehicle summaries.

Directory layout (each may be a CIFS share):
    pcd_dir/       <id>.pcd (+ optional <id>.transform.json)      read-only
    prelabel_dir/  <id>.prelabel.json                             read-only
    labels_dir/    <id>.axles.json                                written by us
"""

import json
import os
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from pydantic import ValidationError

from axel_labler import __version__
from axel_labler.autodepth import DepthFit, fit_depth
from axel_labler.config import Config
from axel_labler.fsio import (
    atomic_write_bytes,
    atomic_write_json,
    cleanup_tmp,
    is_tmp,
    sha256_bytes,
    sha256_file,
)
from axel_labler.gt import compare
from axel_labler.model import (
    Frame,
    GroundTruth,
    LabelAxle,
    LabelDoc,
    LabelEdit,
    PcdInfo,
    PrelabelAxle,
    PrelabelDoc,
    PrelabelRef,
    Review,
    VehicleSummary,
    sort_axles,
    utc_now,
)
from axel_labler.pcd import load_points

ID_RE = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9._-]*$")
PCD_SUFFIX = ".pcd"
RAW_PCD_SUFFIX = "_raw.pcd"
LABEL_SUFFIX = ".axles.json"
PRELABEL_SUFFIX = ".prelabel.json"
TRANSFORM_SUFFIX = ".transform.json"
EPS_M = 0.001  # geometry closer than 1 mm counts as unchanged
FALLBACK_DEPTH_M = 0.3


class StoreError(Exception):
    status = 400


class NotFoundError(StoreError):
    status = 404


class ConflictError(StoreError):
    status = 409


class InvalidError(StoreError):
    status = 422


@dataclass
class OpenResult:
    doc: LabelDoc
    stale: bool
    prelabel_updated: bool
    warnings: list[str] = field(default_factory=list)


def etag(doc: LabelDoc) -> str:
    return doc.updated_at.isoformat()


def _normalize_etag(value: str) -> str:
    value = value.strip()
    if value.startswith("W/"):
        value = value[2:]
    return value.strip('"')


def _dump_axles(axles: list[LabelAxle]) -> list[dict[str, Any]]:
    return [a.model_dump(mode="json") for a in axles]


def unchanged_from_prelabel(doc: LabelDoc) -> bool:
    """True if the axles equal the imported prelabel axles (depth only if the prelabel had it)."""
    if doc.prelabel is None:
        return False
    pre = doc.prelabel.document.get("axles", [])
    if len(pre) != len(doc.axles):
        return False
    used: set[int] = set()
    for a in doc.axles:
        i = a.prelabel_index
        if i is None or i in used or i >= len(pre):
            return False
        used.add(i)
        p = pre[i]
        if p.get("type") != a.type:
            return False
        pairs = [(a.y, p.get("y")), (a.z, p.get("z")), (a.radius, p.get("radius"))]
        pairs += [(a.x_min, p.get("x_min")), (a.x_max, p.get("x_max"))]
        for ours, theirs in pairs:
            if theirs is not None and abs(ours - theirs) > EPS_M:
                return False
    return True


class _FileCache:
    """Derived per-file info keyed by (size, mtime_ns), persisted on local disk.

    Avoids re-reading every file over SMB after a restart.
    """

    def __init__(self, path: Path | None):
        self.path = path
        self.data: dict[str, dict[str, Any]] = {}
        self.dirty = False
        if path and path.exists():
            try:
                self.data = json.loads(path.read_text())
            except (OSError, ValueError):
                self.data = {}

    def get(self, key: str, st: os.stat_result) -> dict[str, Any] | None:
        e = self.data.get(key)
        if e and e["size"] == st.st_size and e["mtime_ns"] == st.st_mtime_ns:
            return e["info"]
        return None

    def put(self, key: str, st: os.stat_result, info: dict[str, Any]) -> None:
        self.data[key] = {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "info": info}
        self.dirty = True

    def prune(self, keep: set[str]) -> None:
        for key in set(self.data) - keep:
            del self.data[key]
            self.dirty = True

    def save(self) -> None:
        if self.path and self.dirty:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write_json(self.path, self.data)
            self.dirty = False


def _scan(directory: Path | None, suffix: str) -> dict[str, os.DirEntry]:
    """id -> entry for regular files `<id><suffix>` (temp files and invalid ids skipped)."""
    if directory is None:
        return {}
    out = {}
    try:
        entries = list(os.scandir(directory))
    except OSError:
        return {}
    for e in entries:
        name = e.name
        if not name.endswith(suffix) or is_tmp(name) or name.endswith(RAW_PCD_SUFFIX):
            continue
        vid = name[: -len(suffix)]
        if ID_RE.match(vid) and e.is_file():
            out[vid] = e
    return out


def _label_info(doc: LabelDoc) -> dict[str, Any]:
    return {
        "valid": True,
        "axles": [[a.type, a.y] for a in doc.axles],
        "gt": doc.ground_truth.axle_space if doc.ground_truth else None,
        "unchanged": unchanged_from_prelabel(doc),
        "prelabel_sha": doc.prelabel.file_sha256 if doc.prelabel else None,
        "review": doc.review.status,
        "updated_at": doc.updated_at.isoformat(),
    }


def _read_prelabel(raw: bytes, vid: str) -> PrelabelDoc:
    try:
        pdoc = PrelabelDoc.model_validate_json(raw)
    except ValidationError as exc:
        raise InvalidError(f"prelabel file invalid: {_short(exc)}") from exc
    if pdoc.vehicle_id != vid:
        raise InvalidError(
            f"prelabel vehicle_id {pdoc.vehicle_id!r} does not match file name {vid!r}"
        )
    return pdoc


def _short(exc: Exception, limit: int = 400) -> str:
    text = str(exc).replace("\n", " ")
    return text if len(text) <= limit else text[:limit] + "…"


class Store:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.lock = threading.RLock()
        cache_path = cfg.cache_dir / "index-cache.json" if cfg.cache_dir else None
        self._cache = _FileCache(cache_path)
        self._pcd_ids: set[str] = set()
        self._labels: dict[str, dict[str, Any]] = {}
        self._prelabels: dict[str, dict[str, Any]] = {}
        self._stale: dict[str, bool] = {}
        self._summaries: dict[str, VehicleSummary] = {}

    # --- setup / paths ----------------------------------------------------------------------

    def startup(self) -> None:
        self.cfg.labels_dir.mkdir(parents=True, exist_ok=True)
        cleanup_tmp(self.cfg.labels_dir)
        self.rescan()

    def check_id(self, vid: str) -> str:
        if not ID_RE.match(vid):
            raise NotFoundError(f"invalid vehicle id {vid!r}")
        return vid

    def pcd_path(self, vid: str) -> Path:
        return self.cfg.pcd_dir / f"{vid}{PCD_SUFFIX}"

    def transform_path(self, vid: str) -> Path:
        return self.cfg.pcd_dir / f"{vid}{TRANSFORM_SUFFIX}"

    def label_path(self, vid: str) -> Path:
        return self.cfg.labels_dir / f"{vid}{LABEL_SUFFIX}"

    def prelabel_path(self, vid: str) -> Path | None:
        if self.cfg.prelabel_dir is None:
            return None
        return self.cfg.prelabel_dir / f"{vid}{PRELABEL_SUFFIX}"

    def health(self) -> dict[str, Any]:
        cfg = self.cfg

        def writable(d: Path | None) -> bool | None:
            return None if d is None else d.is_dir() and os.access(d, os.W_OK)

        pcd_ok = cfg.pcd_dir.is_dir()
        labels_ok = writable(cfg.labels_dir)
        prelabel_ok = None if cfg.prelabel_dir is None else cfg.prelabel_dir.is_dir()
        export_ok = writable(cfg.export_dir)
        ok = pcd_ok and bool(labels_ok) and prelabel_ok is not False and export_ok is not False
        return {
            "ok": ok,
            "version": __version__,
            "pcd_dir": pcd_ok,
            "pcd_count": len(self._pcd_ids),
            "labels_dir_writable": labels_ok,
            "prelabel_dir": prelabel_ok,
            "export_dir_writable": export_ok,
        }

    # --- index --------------------------------------------------------------------------------

    def rescan(self) -> None:
        with self.lock:
            pcds = _scan(self.cfg.pcd_dir, PCD_SUFFIX)
            labels: dict[str, dict[str, Any]] = {}
            prelabels: dict[str, dict[str, Any]] = {}
            seen: set[str] = set()
            for vid, entry in _scan(self.cfg.labels_dir, LABEL_SUFFIX).items():
                labels[vid] = self._cached(f"L:{entry.name}", entry, self._read_label_info, seen)
            for vid, entry in _scan(self.cfg.prelabel_dir, PRELABEL_SUFFIX).items():
                reader = lambda path, vid=vid: self._read_prelabel_info(path, vid)  # noqa: E731
                prelabels[vid] = self._cached(f"P:{entry.name}", entry, reader, seen)
            self._cache.prune(seen)
            self._cache.save()
            self._pcd_ids = set(pcds)
            self._labels = labels
            self._prelabels = prelabels
            ids = self._pcd_ids | set(labels)
            self._summaries = {vid: self._summary(vid) for vid in ids}

    def _cached(self, key, entry, reader, seen: set[str]) -> dict[str, Any]:
        seen.add(key)
        try:
            st = entry.stat()
        except OSError:
            return {"valid": False, "error": "unreadable"}
        info = self._cache.get(key, st)
        if info is None:
            info = reader(Path(entry.path))
            self._cache.put(key, st, info)
        return info

    def _read_label_info(self, path: Path) -> dict[str, Any]:
        try:
            return _label_info(LabelDoc.model_validate_json(path.read_bytes()))
        except (OSError, ValidationError) as exc:
            return {"valid": False, "error": f"label file invalid: {_short(exc, 200)}"}

    def _read_prelabel_info(self, path: Path, vid: str) -> dict[str, Any]:
        try:
            raw = path.read_bytes()
        except OSError as exc:
            return {"valid": False, "error": f"prelabel unreadable: {exc}"}
        sha = sha256_bytes(raw)
        try:
            pdoc = _read_prelabel(raw, vid)
        except InvalidError as exc:
            return {"valid": False, "sha": sha, "error": str(exc)}
        return {
            "valid": True,
            "sha": sha,
            "axles": [[a.type, a.y] for a in pdoc.axles],
            "gt": pdoc.ground_truth.axle_space if pdoc.ground_truth else None,
        }

    def _summary(self, vid: str) -> VehicleSummary:
        li = self._labels.get(vid)
        pi = self._prelabels.get(vid)
        has_prelabel = bool(pi and pi["valid"])
        s = VehicleSummary(
            id=vid,
            has_pcd=vid in self._pcd_ids,
            has_prelabel=has_prelabel,
            stale=self._stale.get(vid),
        )
        errors = [i["error"] for i in (li, pi) if i and not i["valid"]]
        if errors:
            s.error = "; ".join(errors)
        valid_label = li is not None and li["valid"]
        axles: list[list[Any]] = []
        gt: str | None = None
        if valid_label:
            s.review_status = li["review"]
            s.updated_at = datetime.fromisoformat(li["updated_at"])
            gt = li["gt"]
            imported = li["prelabel_sha"] is not None
            if li["axles"] or imported:
                s.label_state = "prelabeled" if imported and li["unchanged"] else "edited"
                axles = li["axles"]
            s.prelabel_updated = imported and has_prelabel and pi["sha"] != li["prelabel_sha"]
        if s.label_state == "none" and has_prelabel:
            s.label_state = "prelabel_available"
            axles, gt = pi["axles"], pi["gt"]
        s.axle_count = sum(1 for t, _ in axles if t == "axle")
        s.lift_axle_count = sum(1 for t, _ in axles if t == "lift_axle")
        ground_truth = GroundTruth(axle_space=gt) if gt is not None else None
        regular = [y for t, y in axles if t == "axle"]
        s.gt_state = compare(ground_truth, regular, self.cfg.gt_tolerance_m)[0]
        return s

    def summaries(self) -> list[VehicleSummary]:
        with self.lock:
            return [self._summaries[k] for k in sorted(self._summaries)]

    def summary(self, vid: str) -> VehicleSummary | None:
        return self._summaries.get(vid)

    def _refresh(self, vid: str, doc: LabelDoc | None = None) -> None:
        if doc is not None:
            info = _label_info(doc)
            self._labels[vid] = info
            try:
                path = self.label_path(vid)
                self._cache.put(f"L:{path.name}", path.stat(), info)
                self._cache.save()
            except OSError:
                pass
        if self.pcd_path(vid).exists():
            self._pcd_ids.add(vid)
        self._summaries[vid] = self._summary(vid)

    # --- documents ----------------------------------------------------------------------------

    def read_doc(self, vid: str) -> LabelDoc | None:
        path = self.label_path(vid)
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            return None
        try:
            return LabelDoc.model_validate_json(raw)
        except ValidationError as exc:
            raise InvalidError(f"label file invalid: {_short(exc)}") from exc

    def _write_doc(self, doc: LabelDoc) -> None:
        data = (doc.model_dump_json(indent=2) + "\n").encode()
        atomic_write_bytes(self.label_path(doc.vehicle_id), data)
        self._refresh(doc.vehicle_id, doc)

    def _read_transform(self, vid: str) -> dict[str, Any] | None:
        try:
            value = json.loads(self.transform_path(vid).read_bytes())
        except (OSError, ValueError):
            return None
        return value if isinstance(value, dict) else None

    def _new_doc(self, vid: str, pcd_sha: str, point_count: int) -> LabelDoc:
        now = utc_now()
        return LabelDoc(
            vehicle_id=vid,
            pcd=PcdInfo(file=self.pcd_path(vid).name, sha256=pcd_sha, point_count=point_count),
            frame=Frame(transform=self._read_transform(vid)),
            created_at=now,
            updated_at=now,
            labeler_version=__version__,
        )

    def _load_prelabel(self, vid: str) -> tuple[bytes, PrelabelDoc] | None:
        path = self.prelabel_path(vid)
        if path is None:
            return None
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            return None
        return raw, _read_prelabel(raw, vid)

    def _axle_from_prelabel(self, index: int, p: PrelabelAxle, points: np.ndarray) -> LabelAxle:
        x_min, x_max = p.x_min, p.x_max
        if x_min is None or x_max is None:
            fit = fit_depth(points, p.y, p.z, p.radius, self.cfg.max_depth_m)
            if fit is not None:
                x_min, x_max = fit.x_min, fit.x_max
            else:
                x_max = float(points[:, 0].max()) if len(points) else FALLBACK_DEPTH_M
                x_min = x_max - FALLBACK_DEPTH_M
        return LabelAxle(
            type=p.type,
            y=p.y,
            z=p.z,
            radius=p.radius,
            x_min=x_min,
            x_max=x_max,
            prelabel_index=index,
        )

    def _apply_prelabel(
        self, doc: LabelDoc, raw: bytes, pdoc: PrelabelDoc, keep_axles: bool = False
    ) -> None:
        doc.prelabel = PrelabelRef(
            imported_at=utc_now(), file_sha256=sha256_bytes(raw), document=json.loads(raw)
        )
        doc.ground_truth = pdoc.ground_truth.model_copy() if pdoc.ground_truth else None
        if keep_axles:
            doc.axles = [a.model_copy(update={"prelabel_index": None}) for a in doc.axles]
        else:
            points = load_points(self.pcd_path(doc.vehicle_id))
            doc.axles = sort_axles(
                [self._axle_from_prelabel(i, p, points) for i, p in enumerate(pdoc.axles)]
            )

    def _prelabel_updated(self, vid: str, doc: LabelDoc) -> bool:
        path = self.prelabel_path(vid)
        if doc.prelabel is None or path is None or not path.exists():
            return False
        return sha256_file(path) != doc.prelabel.file_sha256

    def open(self, vid: str) -> OpenResult:
        """Read (or create) the label doc; auto-import the prelabel into untouched docs."""
        self.check_id(vid)
        with self.lock:
            pcd = self.pcd_path(vid)
            if not pcd.exists():
                raise NotFoundError(f"no PCD for vehicle {vid}")
            pcd_sha = sha256_file(pcd)
            warnings: list[str] = []
            doc = self.read_doc(vid)
            changed = False
            if doc is None:
                doc = self._new_doc(vid, pcd_sha, len(load_points(pcd)))
                changed = True
            untouched = doc.prelabel is None and not doc.axles and doc.review.status == "unreviewed"
            if untouched:
                try:
                    pre = self._load_prelabel(vid)
                except InvalidError as exc:
                    warnings.append(str(exc))
                    pre = None
                if pre is not None:
                    self._apply_prelabel(doc, *pre)
                    changed = True
            if changed:
                doc.updated_at = utc_now()
                self._write_doc(doc)
            pre_doc = doc.prelabel.document if doc.prelabel else {}
            pre_sha = (pre_doc.get("pcd") or {}).get("sha256")
            if pre_sha and pre_sha != pcd_sha:
                warnings.append("the prelabel was computed on a different version of this PCD")
            stale = doc.pcd.sha256 != pcd_sha
            self._stale[vid] = stale
            result = OpenResult(doc, stale, self._prelabel_updated(vid, doc), warnings)
            self._refresh(vid)
            return result

    def save(self, vid: str, edit: LabelEdit, if_match: str | None) -> LabelDoc:
        self.check_id(vid)
        with self.lock:
            doc = self.read_doc(vid)
            if doc is None:
                raise NotFoundError(f"no label file for vehicle {vid}")
            if if_match is None or _normalize_etag(if_match) != etag(doc):
                raise ConflictError("the label file was changed elsewhere; reload it first")
            n_pre = len(doc.prelabel.document.get("axles", [])) if doc.prelabel else 0
            for a in edit.axles:
                if a.prelabel_index is not None and a.prelabel_index >= n_pre:
                    raise InvalidError(f"prelabel_index {a.prelabel_index} out of range")
            axles = sort_axles(edit.axles)
            axles_changed = _dump_axles(axles) != _dump_axles(doc.axles)
            status, comment = edit.review.status, edit.review.comment
            if axles_changed and status == doc.review.status:
                status = "unreviewed"  # an OK must always refer to the current axles
            if status == doc.review.status:
                reviewed_at = doc.review.reviewed_at
            else:
                reviewed_at = None if status == "unreviewed" else utc_now()
            review = Review(status=status, comment=comment, reviewed_at=reviewed_at)
            if not axles_changed and review == doc.review:
                return doc
            doc.axles = axles
            doc.review = review
            doc.updated_at = utc_now()
            self._write_doc(doc)
            return doc

    def reimport_prelabel(self, vid: str, keep_axles: bool) -> OpenResult:
        self.check_id(vid)
        with self.lock:
            doc = self.read_doc(vid)
            if doc is None:
                raise NotFoundError(f"no label file for vehicle {vid}")
            pre = self._load_prelabel(vid)
            if pre is None:
                raise NotFoundError(f"no prelabel file for vehicle {vid}")
            before = _dump_axles(doc.axles)
            self._apply_prelabel(doc, *pre, keep_axles=keep_axles)
            if _dump_axles(doc.axles) != before:
                doc.review = Review(comment=doc.review.comment)
            doc.updated_at = utc_now()
            self._write_doc(doc)
            return self.open(vid)

    def accept_pcd(self, vid: str) -> OpenResult:
        self.check_id(vid)
        with self.lock:
            doc = self.read_doc(vid)
            pcd = self.pcd_path(vid)
            if doc is None or not pcd.exists():
                raise NotFoundError(f"no label file or PCD for vehicle {vid}")
            doc.pcd = PcdInfo(
                file=pcd.name, sha256=sha256_file(pcd), point_count=len(load_points(pcd))
            )
            doc.frame = Frame(transform=self._read_transform(vid))
            doc.review = Review(comment=doc.review.comment)
            doc.updated_at = utc_now()
            self._write_doc(doc)
            return self.open(vid)

    def points(self, vid: str) -> np.ndarray:
        self.check_id(vid)
        pcd = self.pcd_path(vid)
        if not pcd.exists():
            raise NotFoundError(f"no PCD for vehicle {vid}")
        return load_points(pcd)

    def autodepth(self, vid: str, y: float, z: float, radius: float) -> DepthFit:
        fit = fit_depth(self.points(vid), y, z, radius, self.cfg.max_depth_m)
        if fit is None:
            raise InvalidError("too few points inside the circle to fit the depth")
        return fit

    def import_all(self) -> dict[str, Any]:
        """Import every prelabel that has not been imported into an untouched label doc yet."""
        self.rescan()
        imported, failed = 0, []
        for s in self.summaries():
            if s.label_state != "prelabel_available" or not s.has_pcd:
                continue
            try:
                result = self.open(s.id)
            except StoreError as exc:
                failed.append({"vehicle_id": s.id, "error": str(exc)})
                continue
            if result.doc.prelabel is not None:
                imported += 1
            else:
                failed.append({"vehicle_id": s.id, "error": "; ".join(result.warnings)})
        return {"imported": imported, "failed": failed}
