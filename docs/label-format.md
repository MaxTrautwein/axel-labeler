# Axle label format (`axel-labels`, version 1)

This document specifies the label files written by **axel-labler** and the manifest written by its
export. It is the contract for every application that consumes the labels.

| Artifact | File | JSON Schema |
|---|---|---|
| Label file, one per vehicle | `<vehicle_id>.axles.json` | [`schema/axel-labels.v1.schema.json`](schema/axel-labels.v1.schema.json) |
| Export manifest | `manifest.json` | [`schema/axel-labels-export.v1.schema.json`](schema/axel-labels-export.v1.schema.json) |
| Prelabel input (embedded copy) | see [prelabel-format.md](prelabel-format.md) | [`schema/axel-prelabel.v1.schema.json`](schema/axel-prelabel.v1.schema.json) |

Examples: [`examples/example.axles.json`](examples/example.axles.json),
[`examples/example.manifest.json`](examples/example.manifest.json).

All files are UTF-8 JSON. Timestamps are ISO 8601 in UTC (`2000-01-01T10:00:00Z`, optionally with
fractional seconds). Lengths are metres. Unknown keys are not allowed (the schemas use
`additionalProperties: false`), except inside the verbatim copies `frame.transform` and
`prelabel.document.tool_meta`.

## 1. Coordinate frame `side_view`

Labels are given in the coordinate frame of the labeled PCD file (`pcd.file`), which is the output
of an upstream transform step:

| Axis | Meaning |
|---|---|
| x | lateral (across the vehicle); **positive towards the sensor** |
| y | longitudinal (along the vehicle); **vehicle front at larger y** |
| z | up; **ground at z = 0** |

Nothing else about the transform is assumed: in particular neither snapping of y to a grid nor a
particular origin is required. If the PCD came with a `<vehicle_id>.transform.json`, it is copied
verbatim into `frame.transform`, so the labels can be mapped back to the original sensor frame with
the transform step's own definition of that file. The labeler does not interpret it.

## 2. Label file

```json
{
  "format": "axel-labels",
  "format_version": 1,
  "vehicle_id": "UUID",
  "pcd": {"file": "UUID.pcd", "sha256": "5526f6…", "point_count": 8101},
  "frame": {"name": "side_view", "transform": {"params": {…}, "config": {…}}},
  "ground_truth": {"axle_space": "0;411;133", "source": "DB.Table", "weighing_data_id": 4711},
  "prelabel": {"imported_at": "…", "file_sha256": "…", "document": {…verbatim prelabel file…}},
  "axles": [
    {"type": "axle", "y": 9.12, "z": 0.505, "radius": 0.505, "x_min": 1.6201, "x_max": 2.0098, "prelabel_index": 1},
    {"type": "lift_axle", "y": 7.412, "z": 0.684, "radius": 0.49, "x_min": 1.64, "x_max": 2.0, "prelabel_index": null}
  ],
  "review": {"status": "ok", "comment": "", "reviewed_at": "2000-01-01T12:00:00.679280Z"},
  "created_at": "…",
  "updated_at": "…",
  "labeler_version": "0.1.0"
}
```

| Field | Type | Meaning |
|---|---|---|
| `format`, `format_version` | `"axel-labels"`, `1` | Format identification. |
| `vehicle_id` | string | Vehicle id = PCD file stem (the lidar vehicle uuid). |
| `pcd.file` | string | File name of the labeled PCD. |
| `pcd.sha256` | string | SHA-256 of the PCD **the labels refer to**. If the PCD on disk has a different hash, the labels are stale (the PCD was regenerated) and must not be used. |
| `pcd.point_count` | int | Number of points used by the labeler. |
| `frame.name` | `"side_view"` | See section 1. |
| `frame.transform` | object \| null | Verbatim copy of `<vehicle_id>.transform.json`, or null. |
| `ground_truth` | object \| null | Weighing-station axle spacing (section 4); null if unknown. |
| `prelabel` | object \| null | Unchanged reference copy of the imported prelabel (section 5); null if labeled fully manually. |
| `axles` | array | The labels (section 3), ordered **front to back** (descending y). |
| `review` | object | Review result (section 6). |
| `created_at`, `updated_at` | timestamp | File creation / last change. |
| `labeler_version` | string | axel-labler version that wrote the file. |

## 3. Axles: "circle with depth"

Each entry describes the **visible sensor-side wheel set** of one axle as a cylinder whose axis is
parallel to x:

| Field | Type | Meaning |
|---|---|---|
| `type` | `"axle"` \| `"lift_axle"` | `lift_axle` only for a **raised** lift axle. A lowered lift axle cannot be told apart from a regular one and is labeled `axle`. |
| `y`, `z` | number | Wheel centre (hub) in the side view. `z > 0`. |
| `radius` | number | Wheel (tire) radius, `> 0`. |
| `x_min`, `x_max` | number | Lateral extent of the visible wheel set, from its inner edge to the outer tire face; for twin tires both tires are included. `x_min < x_max`. |
| `prelabel_index` | int \| null | Index into `prelabel.document.axles` of the prelabel axle this axle was derived from; null if the axle was added manually. |

Geometry is rounded to 0.1 mm. The cylinder is centred at `((x_min + x_max) / 2, y, z)` with length
`x_max - x_min`. Only the sensor side is labeled; the far-side wheels are not represented.

Whether an axle was **edited** is not stored; compare it with its prelabel axle
(`prelabel.document.axles[prelabel_index]`) instead.

## 4. Ground truth

`ground_truth.axle_space` is the axle-spacing value of the weighing-station database, stored **1:1**
(it is never parsed, normalised or edited by the labeler). `weighing_data_id` identifies the
database row, `source` names the database.
The whole object is copied from the prelabel file at import.

Interpretation used by the labeler (informative, not part of the stored data):

- `axle_space` is a `;`-separated list of centimetres with one value per axle **on the ground**.
- `values[1:]` are the distances between consecutive **regular** axles (`type: "axle"`), front to back.
  The meaning of `values[0]` is unknown; it is not used.
- Raised lift axles are not part of the ground truth.

The labeler compares these gaps with the labeled regular axles (default tolerance 0.10 m).

## 5. Prelabel reference

`prelabel.document` is the complete, unmodified content of the prelabel file that was imported
(format: [prelabel-format.md](prelabel-format.md)), `prelabel.file_sha256` the hash of that file and
`prelabel.imported_at` the import time. It is kept as a reference so the difference between the
automatic proposal and the final labels can always be evaluated:

- per axle: `axles[i]` vs `prelabel.document.axles[axles[i].prelabel_index]`
- removed proposals: indices of `prelabel.document.axles` not referenced by any axle
- added axles: axles with `prelabel_index: null`

If an axle's prelabel had no `x_min`/`x_max`, the labeler filled them by fitting the points; the
reference copy still contains `null`.

## 6. Review

| Field | Type | Meaning |
|---|---|---|
| `status` | `"unreviewed"` \| `"ok"` \| `"not_ok"` | Review result for the whole vehicle. |
| `comment` | string | Free text. |
| `reviewed_at` | timestamp \| null | When the status was last set (null while unreviewed). |

Any change of the axles after a review resets the status to `unreviewed`, so `ok` always refers to
the axles as they are in the file. **Consumers should only use vehicles with `status: "ok"`**, which
is exactly what the export contains.

## 7. Export

An export creates a new folder `<export_dir>/<YYYYMMDD-HHMMSS>/` containing

- `labels/<vehicle_id>.axles.json` — byte-identical copies of the label files (a frozen snapshot)
- `manifest.json` — the list of exported vehicles

```json
{
  "format": "axel-labels-export",
  "format_version": 1,
  "created_at": "2000-01-01T12:00:00.681094Z",
  "labeler_version": "0.1.0",
  "filter": {"review_status": "ok"},
  "roots": {"pcd": "/mnt/share/pcd", "export": "/mnt/share/export/20000101-120000"},
  "count": 1,
  "items": [
    {
      "vehicle_id": "UUID",
      "pcd": "/mnt/share/pcd/UUID.pcd",
      "labels": "/mnt/share/export/20000101-120000/labels/UUID.axles.json",
      "axle_count": 3,
      "lift_axle_count": 1,
      "reviewed_at": "2000-01-01T12:00:00.679280Z"
    }
  ],
  "skipped": [{"vehicle_id": "…", "reason": "stale_pcd"}]
}
```

- `items[].pcd` / `items[].labels` are absolute paths **as seen on the host** (not inside the
  container). `roots` gives the two base directories so a consumer with a different mount point can
  replace the prefix.
- The PCDs are not copied; `items[].pcd` points to the original file whose hash was verified against
  `pcd.sha256` at export time.
- `skipped` lists vehicles matching the filter that were left out: `stale_pcd` (PCD changed since
  labeling), `missing_pcd`, `invalid` (label file does not validate).

## 8. Versioning

Any incompatible change increments `format_version` (and the schema file name). Consumers must
check `format` and `format_version` and reject unknown versions.
