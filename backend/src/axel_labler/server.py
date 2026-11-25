"""FastAPI app (API only; the Angular build is served by nginx)."""

from fastapi import Body, FastAPI, Header, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from axel_labler import __version__
from axel_labler.config import Config
from axel_labler.export import run_export
from axel_labler.model import (
    ExportManifest,
    LabelDoc,
    LabelEdit,
    ReviewStatus,
    VehicleSummary,
)
from axel_labler.store import OpenResult, Store, StoreError, etag


class VehicleResponse(BaseModel):
    doc: LabelDoc
    summary: VehicleSummary | None
    stale: bool
    prelabel_updated: bool
    warnings: list[str]


class SaveResponse(BaseModel):
    doc: LabelDoc
    summary: VehicleSummary | None


class AutodepthRequest(BaseModel):
    y: float
    z: float
    radius: float = Field(gt=0)


class AutodepthResponse(BaseModel):
    x_min: float
    x_max: float
    n_points: int
    warning: str | None


class ExportRequest(BaseModel):
    review_status: ReviewStatus = "ok"


class ExportResponse(BaseModel):
    folder: str
    manifest: ExportManifest


def create_app(cfg: Config | None = None) -> FastAPI:
    cfg = cfg or Config.from_env()
    store = Store(cfg)
    store.startup()
    app = FastAPI(title="axel-labler", version=__version__)
    app.state.store = store

    @app.exception_handler(StoreError)
    def _store_error(_request: Request, exc: StoreError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=exc.status)

    def vehicle_response(vid: str, result: OpenResult, response: Response) -> VehicleResponse:
        response.headers["ETag"] = f'"{etag(result.doc)}"'
        return VehicleResponse(
            doc=result.doc,
            summary=store.summary(vid),
            stale=result.stale,
            prelabel_updated=result.prelabel_updated,
            warnings=result.warnings,
        )

    @app.get("/api/health")
    def health(response: Response) -> dict:
        info = store.health()
        if not info["ok"]:
            response.status_code = 503
        return info

    @app.get("/api/config")
    def config() -> dict:
        return {
            "version": __version__,
            "gt_tolerance_m": cfg.gt_tolerance_m,
            "max_depth_m": cfg.max_depth_m,
            "prelabel_enabled": cfg.prelabel_dir is not None,
            "export_enabled": cfg.export_dir is not None,
        }

    @app.get("/api/vehicles")
    def vehicles(rescan: bool = False) -> list[VehicleSummary]:
        if rescan:
            store.rescan()
        return store.summaries()

    @app.get("/api/vehicles/{vid}")
    def get_vehicle(vid: str, response: Response) -> VehicleResponse:
        return vehicle_response(vid, store.open(vid), response)

    @app.put("/api/vehicles/{vid}")
    def put_vehicle(
        vid: str, edit: LabelEdit, response: Response, if_match: str | None = Header(None)
    ) -> SaveResponse:
        doc = store.save(vid, edit, if_match)
        response.headers["ETag"] = f'"{etag(doc)}"'
        return SaveResponse(doc=doc, summary=store.summary(vid))

    @app.get("/api/vehicles/{vid}/points")
    def points(vid: str) -> Response:
        pts = store.points(vid)
        return Response(
            content=pts.astype("<f4").tobytes(),
            media_type="application/octet-stream",
            headers={"X-Point-Count": str(len(pts)), "X-Point-Fields": "x,y,z,reflectivity"},
        )

    @app.post("/api/vehicles/{vid}/autodepth")
    def autodepth(vid: str, req: AutodepthRequest) -> AutodepthResponse:
        fit = store.autodepth(vid, req.y, req.z, req.radius)
        return AutodepthResponse(
            x_min=fit.x_min, x_max=fit.x_max, n_points=fit.n_points, warning=fit.warning
        )

    @app.post("/api/vehicles/{vid}/reimport-prelabel")
    def reimport(
        vid: str, response: Response, keep_axles: bool = Body(False, embed=True)
    ) -> VehicleResponse:
        return vehicle_response(vid, store.reimport_prelabel(vid, keep_axles), response)

    @app.post("/api/vehicles/{vid}/accept-pcd")
    def accept_pcd(vid: str, response: Response) -> VehicleResponse:
        return vehicle_response(vid, store.accept_pcd(vid), response)

    @app.post("/api/prelabels/import")
    def import_prelabels() -> dict:
        return store.import_all()

    @app.post("/api/export")
    def export(req: ExportRequest) -> ExportResponse:
        manifest, _folder = run_export(store, req.review_status)
        return ExportResponse(folder=manifest.roots.export, manifest=manifest)

    return app
