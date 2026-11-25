"""Pydantic models: the single source of truth for all file formats (see docs/*.md).

The JSON Schemas in docs/schema/ are generated from these models (`axel-labler schema`).
"""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

LABEL_FORMAT = "axel-labels"
PRELABEL_FORMAT = "axel-prelabel"
EXPORT_FORMAT = "axel-labels-export"
FORMAT_VERSION = 1

AxleType = Literal["axle", "lift_axle"]
ReviewStatus = Literal["unreviewed", "ok", "not_ok"]
LabelState = Literal["none", "prelabel_available", "prelabeled", "edited"]
GtState = Literal["missing", "invalid", "count_mismatch", "gap_mismatch", "match"]


def _round4(value: float) -> float:
    return round(value, 4)


# Geometry in metres, finite, rounded to 0.1 mm by the labeler.
Metres = Annotated[float, Field(allow_inf_nan=False), AfterValidator(_round4)]
PositiveMetres = Annotated[float, Field(gt=0, allow_inf_nan=False), AfterValidator(_round4)]
# Prelabel values are kept exactly as the prelabeler wrote them (no rounding).
Finite = Annotated[float, Field(allow_inf_nan=False)]
PositiveFinite = Annotated[float, Field(gt=0, allow_inf_nan=False)]


def utc_now() -> datetime:
    return datetime.now(UTC)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


def _check_depth(x_min: float | None, x_max: float | None) -> None:
    if x_min is not None and x_max is not None and not x_min < x_max:
        raise ValueError(f"x_min ({x_min}) must be smaller than x_max ({x_max})")


# --- shared ---------------------------------------------------------------------------------


class GroundTruth(Strict):
    """Weighing-station axle spacing, copied 1:1 from the database."""

    axle_space: str | None = Field(
        description="Verbatim weighing-station database value: ';'-separated centimetres, one "
        "value per axle on the ground. null if the database field is empty."
    )
    source: str | None = Field(
        default=None,
        description="Where the value comes from, e.g. 'DB.Table'.",
    )
    weighing_data_id: int | None = Field(
        default=None, description="Id of the database row, for traceability."
    )


# --- prelabel input (written by the prelabeler) ----------------------------------------------


class PrelabelPcd(Strict):
    file: str = Field(description="File name of the PCD the prelabel was computed on.")
    sha256: str | None = Field(default=None, description="SHA-256 of that PCD file, if known.")


class PrelabelTool(Strict):
    name: str = Field(description="Tool name, e.g. 'my-prelabeler'.")
    version: str | None = Field(default=None, description="Tool version, e.g. a git commit.")


class PrelabelAxle(Strict):
    type: AxleType
    y: Finite = Field(description="Wheel centre along the vehicle (m).")
    z: PositiveFinite = Field(description="Wheel centre height above ground (m).")
    radius: PositiveFinite = Field(description="Wheel radius (m).")
    x_min: Finite | None = Field(default=None, description="Lateral start of the wheel set (m).")
    x_max: Finite | None = Field(default=None, description="Lateral end of the wheel set (m).")
    score: Finite | None = Field(default=None, description="Tool-specific confidence score.")

    @model_validator(mode="after")
    def _depth(self) -> "PrelabelAxle":
        _check_depth(self.x_min, self.x_max)
        return self


class PrelabelDoc(Strict):
    """One prelabel file `<vehicle_id>.prelabel.json`, written by the prelabeler."""

    model_config = ConfigDict(title="AxelPrelabel")

    format: Literal["axel-prelabel"] = PRELABEL_FORMAT
    format_version: Literal[1] = FORMAT_VERSION
    vehicle_id: str
    pcd: PrelabelPcd
    tool: PrelabelTool
    created_at: datetime
    ground_truth: GroundTruth | None = Field(
        description="null if no weighing record was found for this vehicle."
    )
    axles: list[PrelabelAxle] = Field(description="Proposed axles, any order.")
    tool_meta: dict[str, Any] = Field(
        default_factory=dict, description="Free-form tool data (fit parameters, debug values)."
    )


# --- label file (owned by the labeler) ---------------------------------------------------------


class PcdInfo(Strict):
    file: str = Field(description="File name of the labeled PCD (`<vehicle_id>.pcd`).")
    sha256: str = Field(description="SHA-256 of the PCD file the labels refer to.")
    point_count: int = Field(ge=0)


class Frame(Strict):
    name: Literal["side_view"] = Field(
        default="side_view",
        description="x lateral (sensor side positive), y longitudinal (vehicle front positive), "
        "z up (ground at 0), metres.",
    )
    transform: dict[str, Any] | None = Field(
        default=None,
        description="Verbatim copy of `<vehicle_id>.transform.json` written by the transform step, "
        "or null if there was none.",
    )


class PrelabelRef(Strict):
    imported_at: datetime
    file_sha256: str = Field(description="SHA-256 of the imported prelabel file.")
    document: dict[str, Any] = Field(
        description="Verbatim content of the imported prelabel file (axel-prelabel format)."
    )


class LabelAxle(Strict):
    """One axle = the visible sensor-side wheel set, a cylinder with its axis parallel to x."""

    type: AxleType = Field(description="'axle', or 'lift_axle' for a RAISED lift axle.")
    y: Metres = Field(description="Wheel centre along the vehicle (m).")
    z: PositiveMetres = Field(description="Wheel centre height above ground (m).")
    radius: PositiveMetres = Field(description="Wheel radius (m).")
    x_min: Metres = Field(description="Lateral start of the visible wheel set (m).")
    x_max: Metres = Field(description="Lateral end of the visible wheel set (m).")
    prelabel_index: int | None = Field(
        default=None,
        ge=0,
        description="Index into prelabel.document.axles this axle was derived from; "
        "null if added manually.",
    )

    @model_validator(mode="after")
    def _depth(self) -> "LabelAxle":
        _check_depth(self.x_min, self.x_max)
        return self


def sort_axles(axles: list[LabelAxle]) -> list[LabelAxle]:
    """Front to back = descending y."""
    return sorted(axles, key=lambda a: -a.y)


class Review(Strict):
    status: ReviewStatus = "unreviewed"
    comment: str = ""
    reviewed_at: datetime | None = None


class LabelDoc(Strict):
    """One label file `<vehicle_id>.axles.json`."""

    model_config = ConfigDict(title="AxelLabels")

    format: Literal["axel-labels"] = LABEL_FORMAT
    format_version: Literal[1] = FORMAT_VERSION
    vehicle_id: str
    pcd: PcdInfo
    frame: Frame = Field(default_factory=Frame)
    ground_truth: GroundTruth | None = Field(
        default=None, description="Copied verbatim from the imported prelabel; null if unknown."
    )
    prelabel: PrelabelRef | None = Field(
        default=None, description="Unchanged reference copy of the imported prelabel."
    )
    axles: list[LabelAxle] = Field(
        default_factory=list, description="Ordered front to back (descending y)."
    )
    review: Review = Field(default_factory=Review)
    created_at: datetime
    updated_at: datetime
    labeler_version: str

    @model_validator(mode="after")
    def _order(self) -> "LabelDoc":
        self.axles = sort_axles(self.axles)
        return self


# --- API payloads (not file formats) --------------------------------------------------------


class ReviewEdit(Strict):
    status: ReviewStatus
    comment: str = ""


class LabelEdit(Strict):
    axles: list[LabelAxle]
    review: ReviewEdit


class VehicleSummary(BaseModel):
    id: str
    has_pcd: bool
    has_prelabel: bool
    axle_count: int = 0
    lift_axle_count: int = 0
    label_state: LabelState = "none"
    prelabel_updated: bool = False
    review_status: ReviewStatus = "unreviewed"
    gt_state: GtState = "missing"
    stale: bool | None = None
    updated_at: datetime | None = None
    error: str | None = None


# --- export manifest ----------------------------------------------------------------------------


class ExportFilter(Strict):
    review_status: ReviewStatus = "ok"


class ExportRoots(Strict):
    pcd: str = Field(description="Directory of the PCD files (host path).")
    export: str = Field(description="This export folder (host path).")


class ExportItem(Strict):
    vehicle_id: str
    pcd: str = Field(description="Absolute (host) path of the PCD file.")
    labels: str = Field(description="Absolute (host) path of the exported label JSON copy.")
    axle_count: int
    lift_axle_count: int
    reviewed_at: datetime | None


class ExportSkipped(Strict):
    vehicle_id: str
    reason: Literal["stale_pcd", "missing_pcd", "invalid"]


class ExportManifest(Strict):
    """`manifest.json` of one export folder."""

    model_config = ConfigDict(title="AxelLabelsExport")

    format: Literal["axel-labels-export"] = EXPORT_FORMAT
    format_version: Literal[1] = FORMAT_VERSION
    created_at: datetime
    labeler_version: str
    filter: ExportFilter
    roots: ExportRoots
    count: int
    items: list[ExportItem]
    skipped: list[ExportSkipped]


JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"

SCHEMA_FILES: dict[str, type[BaseModel]] = {
    "axel-labels.v1.schema.json": LabelDoc,
    "axel-prelabel.v1.schema.json": PrelabelDoc,
    "axel-labels-export.v1.schema.json": ExportManifest,
}


def json_schemas() -> dict[str, dict[str, Any]]:
    """Generated JSON Schemas, keyed by file name."""
    out = {}
    for name, model in SCHEMA_FILES.items():
        schema = model.model_json_schema(mode="serialization")
        out[name] = {"$schema": JSON_SCHEMA_DIALECT, "$id": name, **schema}
    # The verbatim prelabel copy is described by the prelabel schema file.
    document = out["axel-labels.v1.schema.json"]["$defs"]["PrelabelRef"]["properties"]["document"]
    document["$ref"] = "axel-prelabel.v1.schema.json"
    return out
