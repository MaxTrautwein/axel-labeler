import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from axel_labler.cli import DEFAULT_SCHEMA_DIR
from axel_labler.model import (
    ExportManifest,
    LabelAxle,
    LabelDoc,
    PrelabelDoc,
    json_schemas,
)

EXAMPLES = Path(__file__).resolve().parents[2] / "docs" / "examples"


def axle(**kw):
    base = {"type": "axle", "y": 1.0, "z": 0.5, "radius": 0.5, "x_min": 1.6, "x_max": 2.0}
    return {**base, **kw}


def test_schema_files_in_sync():
    for name, schema in json_schemas().items():
        committed = json.loads((DEFAULT_SCHEMA_DIR / name).read_text())
        assert committed == schema, f"{name} is outdated, run `axel-labler schema`"


@pytest.mark.parametrize(
    ("name", "model"),
    [
        ("example.axles.json", LabelDoc),
        ("example.prelabel.json", PrelabelDoc),
        ("example.manifest.json", ExportManifest),
    ],
)
def test_examples_validate(name, model):
    model.model_validate_json((EXAMPLES / name).read_bytes())


def test_example_label_embeds_valid_prelabel():
    doc = LabelDoc.model_validate_json((EXAMPLES / "example.axles.json").read_bytes())
    PrelabelDoc.model_validate(doc.prelabel.document)


def test_axle_rounding_and_validation():
    a = LabelAxle(**axle(y=1.234567))
    assert a.y == 1.2346
    with pytest.raises(ValidationError):
        LabelAxle(**axle(x_min=2.0, x_max=2.0))
    with pytest.raises(ValidationError):
        LabelAxle(**axle(z=0))
    with pytest.raises(ValidationError):
        LabelAxle(**axle(radius=float("nan")))
    with pytest.raises(ValidationError):
        LabelAxle(**axle(color="red"))  # strict: unknown keys rejected
    with pytest.raises(ValidationError):
        LabelAxle(**axle(type="trailer_axle"))


def test_label_doc_sorts_axles_front_to_back():
    doc = LabelDoc.model_validate(
        {
            "vehicle_id": "v",
            "pcd": {"file": "v.pcd", "sha256": "x", "point_count": 1},
            "axles": [axle(y=1.0), axle(y=7.0), axle(y=3.0)],
            "created_at": "2000-01-01T10:00:00Z",
            "updated_at": "2000-01-01T10:00:00Z",
            "labeler_version": "0.1.0",
        }
    )
    assert [a.y for a in doc.axles] == [7.0, 3.0, 1.0]
