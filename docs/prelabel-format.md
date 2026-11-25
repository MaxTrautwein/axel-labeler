# Prelabel format (`axel-prelabel`, version 1)

This document specifies the files a prelabeler writes so that
**axel-labler** can import automatic axle proposals and the ground-truth axle spacing.
axel-labler never connects to the weighing-station database itself: **the ground truth reaches it
only through these files.**

JSON Schema: [`schema/axel-prelabel.v1.schema.json`](schema/axel-prelabel.v1.schema.json) ·
Example: [`examples/example.prelabel.json`](examples/example.prelabel.json)

## 1. Files

- One file per vehicle: `<prelabel_dir>/<vehicle_id>.prelabel.json`, where `vehicle_id` is the stem
  of the PCD file (`<vehicle_id>.pcd`) the prelabel was computed on.
- The directory is on a CIFS share that axel-labler reads concurrently. **Write atomically**: write
  to a temporary file in the same directory whose name starts with `.` and contains `.tmp-`
  (e.g. `.<vehicle_id>.prelabel.json.tmp-<random>`), then rename it over the target. Such temporary
  files are ignored by the labeler.
- Write a file even if no axles were found, as long as the ground truth is known: the labeler then
  still shows the ground-truth guide for manual labeling.
- Rewriting a file is allowed (e.g. a better prelabeler version). The labeler notices the change and
  offers to re-import it; it never overwrites manual work on its own.

## 2. Content

```json
{
  "format": "axel-prelabel",
  "format_version": 1,
  "vehicle_id": "UUID",
  "pcd": {"file": "UUID.pcd", "sha256": null},
  "tool": {"name": "my-prelabeler", "version": "abc1234"},
  "created_at": "2000-01-01T10:00:00Z",
  "ground_truth": {
    "axle_space": "0;411;133",
    "source": "DB.Table",
    "weighing_data_id": 4711
  },
  "axles": [
    {"type": "axle", "y": 9.12, "z": 0.49, "radius": 0.49, "score": 15.25},
    {"type": "axle", "y": 5.03, "z": 0.49, "radius": 0.49, "x_min": 1.6, "x_max": 2.0, "score": 12.5}
  ],
  "tool_meta": {"cy": 0.49, "offset": -1.44}
}
```

| Field | Required | Type | Meaning |
|---|---|---|---|
| `format`, `format_version` | yes | `"axel-prelabel"`, `1` | Format identification. |
| `vehicle_id` | yes | string | Must equal the file name stem; otherwise the file is rejected. |
| `pcd.file` | yes | string | File name of the PCD the proposal was computed on. |
| `pcd.sha256` | no | string \| null | SHA-256 of that PCD. If given and different from the PCD the labeler sees, a warning is shown. |
| `tool.name` | yes | string | e.g. `"my-prelabeler"`. |
| `tool.version` | no | string \| null | e.g. the git commit (`git rev-parse --short HEAD`, `+dirty` if uncommitted). |
| `created_at` | yes | timestamp | ISO 8601, UTC. |
| `ground_truth` | yes | object \| null | null if no weighing record was found for the vehicle. |
| `ground_truth.axle_space` | yes | string \| null | **The weighing-station database value, unmodified** (do not parse, round or reformat it). null if the field is empty. |
| `ground_truth.source` | no | string \| null | Where the value comes from, e.g. `"DB.Table"`. |
| `ground_truth.weighing_data_id` | no | int \| null | Id of the database row, for traceability. |
| `axles` | yes | array | Proposed axles, any order (may be empty). |
| `axles[].type` | yes | `"axle"` \| `"lift_axle"` | `lift_axle` only for a raised lift axle. |
| `axles[].y`, `axles[].z` | yes | number | Wheel centre, metres, in the frame of the PCD (see [label-format.md §1](label-format.md#1-coordinate-frame-side_view)); `z > 0`. |
| `axles[].radius` | yes | number | Wheel radius, metres, `> 0`. |
| `axles[].x_min`, `axles[].x_max` | no | number \| null | Lateral extent of the visible wheel set. If missing, the labeler fits it from the points. |
| `axles[].score` | no | number \| null | Tool-specific confidence. |
| `tool_meta` | no | object | Free-form tool data (fit parameters, debug values); stored but not interpreted. |

Numbers must be finite (no NaN/Infinity). Unknown keys outside `tool_meta` make the file invalid.

## 3. What the labeler does with it

- On first opening a vehicle that has no labels yet (or via "Import prelabels" /
  `axel-labler import-prelabels`), the file is imported: its complete content is stored unchanged as
  `prelabel.document` in the label file, `ground_truth` is copied into the label file as-is, and the
  proposed axles become the editable labels (sorted front to back).
- The original proposal stays in the label file as a reference, so the difference between the
  prelabel and the final labels can be evaluated later.
- Invalid files are reported in the UI and ignored; manual labeling keeps working.

## 4. Implementation notes (informative)

Convert numpy scalars with `float()` before serialising. A minimal atomic writer:

```python
import json, os, uuid
from pathlib import Path

def write_prelabel(directory: Path, doc: dict) -> None:
    target = directory / f"{doc['vehicle_id']}.prelabel.json"
    tmp = directory / f".{target.name}.tmp-{uuid.uuid4().hex}"
    tmp.write_text(json.dumps(doc, indent=2))
    os.replace(tmp, target)
```
