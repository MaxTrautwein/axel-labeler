# Axel Labler

A web app for labeling truck axles in per-vehicle LiDAR point clouds. You create, edit and delete
axles, starting from automatic prelabels or fully by hand. Each vehicle is then reviewed (OK /
Not OK), and the OK ones are exported for downstream use.

- Each axle is a **"circle with depth"**: a wheel centre `(y, z)`, a radius, and the lateral extent
  `x_min..x_max` of the visible wheel set. There are two types, `axle` and `lift_axle` (a lift axle
  is only labeled as such when it is raised).
- The **ground-truth axle spacing** from the weighing station is always drawn as a guide. It is
  stored 1:1 in every label file.
- File formats:
  - [docs/label-format.md](docs/label-format.md): labels and export, for consumers
  - [docs/prelabel-format.md](docs/prelabel-format.md): prelabel input, for the prelabeler
  - JSON Schemas in [docs/schema/](docs/schema/), examples in [docs/examples/](docs/examples/)

```
 transform step                   prelabeler
  <uuid>.pcd (+ .transform.json)    <uuid>.prelabel.json  (proposals + verbatim DB axle_space)
          │                                  │
          ▼  (read-only)                     ▼  (read-only)
 ┌──────────────── docker compose ────────────────┐
 │  web  (nginx + Angular)  ──/api──▶  api (FastAPI) │──▶ <uuid>.axles.json   (labels)
 └──────────────────────────────────────────────────┘──▶ export/<timestamp>/  (manifest + copies)
```

The app never connects to the weighing database. Ground truth reaches it only through the prelabel
files.

## Running it

Requirements: Docker with Compose. The data lives on the CIFS share, which is mounted on the host.

```bash
cp .env.example .env        # set the four directories (and BIND_ADDR/PORT if needed)
docker compose up -d --build
# open http://127.0.0.1:8080
docker compose down         # stop everything
```

`.env` settings:

| Variable | Meaning |
|---|---|
| `PCD_DIR` | Transformed PCDs (`<uuid>.pcd`, optional `<uuid>.transform.json`). Mounted read-only. |
| `PRELABEL_DIR` | Prelabel files from the prelabeler. Mounted read-only; it may stay empty. |
| `LABELS_DIR` | Where the label files are written. |
| `EXPORT_DIR` | Where exports are written. |
| `BIND_ADDR`, `PORT` | Where the UI is published. The default is `127.0.0.1:8080`. |
| `GT_TOLERANCE_M`, `MAX_DEPTH_M` | Ground-truth gap tolerance (default 0.10 m) and the maximum automatic wheel-set depth (default 0.8 m). |

### CIFS / permissions

- Mount the share on the host as usual (e.g. under `/mnt/share`) **before** starting. The
  compose file bind-mounts the configured subdirectories into the API container. If the share is
  not mounted, the vehicle list is simply empty.
- The API runs as root inside the container, so it can write `LABELS_DIR` and `EXPORT_DIR`. With
  rootless Docker, container root is your own user. With rootful Docker, the CIFS mount options
  (`uid=`/`gid=`) decide who owns the files.
- The app was built with a share in mind:
  - Files are written to a temp file and renamed into place, with retries.
  - Nothing relies on file watching, locks or modification times; use **Rescan** after files change.
  - The directory index is cached on a local volume.
- The top bar shows problems such as a missing directory or missing write permission.

### Exposing it on the network

`BIND_ADDR=0.0.0.0` (or a LAN address) publishes the UI on the network. There is **no
authentication**, so only do this inside a secured network. The API port itself is never published;
nginx proxies `/api`.

## Workflow

1. **Prelabels (optional).** The prelabeler writes `<uuid>.prelabel.json` into `PRELABEL_DIR`. A
   prelabel is imported automatically the first time you open a vehicle that has no labels yet. To
   import all of them at once, use **Import prelabels** (or the CLI).
2. **Label.** Use the side view (y–z) for wheel position and radius, and the **Section** view (x–z of
   the selected axle) for the lateral depth. The **3D** tab is for checking the result.
   - The blue dashed circles show where the ground truth expects the regular axles. They are anchored
     at the selected regular axle, otherwise at the front-most one.
   - **Snap GT** (`G`) moves the other regular axles onto the guide. **Fill from GT** does the same
     and adds missing axles. With **follow GT** (GT panel) on, moving a regular axle moves the others
     along at the ground-truth spacing.
   - The original prelabel stays in the label file as a reference. **P** shows it as an overlay,
     and the axle table shows the change against it. **↺** in the axle table reverts one axle;
     **Reset to prelabel** (prelabel panel) reverts all of them.
3. **Review.** Mark the vehicle **OK** (`O`) or **Not OK** (`N`, with a comment). Any later edit of
   the axles resets the review to *unreviewed*.

   The vehicle list filters with chips for review status, label state, ground-truth match and flags.
   Each chip shows how many vehicles it would match. Chips in one row combine with *or*, rows with
   *and*, and the filter is kept in the URL. `←`/`→` (or `↑`/`↓`) walk through the filtered list.

   Vehicles without a PCD are hidden; the count line says how many. Such an entry is a label file
   left over after its PCD was removed (opening a vehicle creates its label file). The **no PCD**
   chip shows them. The files stay on disk, and the export skips them.
4. **Export.** **Export…** writes `EXPORT_DIR/<timestamp>/` containing:
   - `manifest.json`, listing the PCD path and label path of each vehicle
   - `labels/` with copies of the label files

   Vehicles whose PCD has changed since labeling are skipped, and the manifest lists them.

**Settings** (menu ☰, top left) holds the defaults of the view, stored per browser: dark or light
theme, colormap, point size, and the colour scale for lateral x and reflectivity: *auto* stretches
over the percentiles of each vehicle (reflectivity: logarithmic by default, so a few retroreflectors
don't wash out the rest); *fixed* uses one range for all vehicles. Changes made in the toolbar last
for the session unless you click **Save view as default**.

Changes are saved with `Ctrl+S`, and automatically when you switch vehicles. If a label file was
changed elsewhere (for example by the CLI), saving reports a conflict. You can then reload the file
or overwrite it with your version.

### Keyboard

| Key | Action |
|---|---|
| double-click / `A` | add an axle at the cursor (its depth is fitted automatically) |
| drag circle / rim handle | move it (`Shift`: keep its height) / change its radius |
| `1`–`9`, `Esc` | select an axle / clear the selection |
| arrows, `Shift`+arrows | nudge the selected axle by 1 cm / 10 cm; with no axle selected: previous (`←` `↑`) / next (`→` `↓`) vehicle in the filtered list |
| `[` `]` | change the radius by 1 cm (`Shift`: 10 cm) |
| `T`, `D`, `Del` | toggle lift axle, fit depth, delete |
| `G` | move the other regular axles onto the GT guide |
| `P`, `F`, `L` | prelabel overlay, fit the view, hide/show the vehicle list |
| `O`, `N` | review OK (saves) / Not OK (focuses the comment) |
| `PageDown` / `PageUp` | next / previous vehicle, even with an axle selected |
| `Ctrl+S`, `Ctrl+Z`, `Ctrl+Shift+Z` | save, undo, redo |

## CLI

```bash
docker compose run --rm api axel-labler import-prelabels
docker compose run --rm api axel-labler export --status ok
```

## Development

- **Backend** (`backend/`, Python 3.12, uv, ruff):
  ```bash
  cd backend
  uv run ruff check && uv run pytest
  uv run axel-labler serve --pcd-dir /path/to/pcds --labels-dir /tmp/labels   # API on :8000
  uv run axel-labler schema   # after changing model.py: regenerates docs/schema/*.json
  ```
- **Frontend** (`frontend/`, Angular): no local Node is needed.
  - `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` serves the dev server on
    `http://127.0.0.1:4200`, with live reload for both the API and the UI.
  - Tests: `docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps ui-dev npm test`.
  - The TypeScript types for the file formats are generated from `docs/schema` before every
    build or test (`npm run gen:types`).
- `backend/src/axel_labler/model.py` is the single source of truth for the formats. After a change,
  regenerate the schemas, then update `docs/*.md` and `docs/examples/`. A test checks that the
  schemas and examples are in sync.
