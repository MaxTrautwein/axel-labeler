"""Command line: serve | import-prelabels | export | schema."""

import argparse
import json
from pathlib import Path

from axel_labler.config import Config
from axel_labler.model import json_schemas

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
DEFAULT_SCHEMA_DIR = Path(__file__).resolve().parents[3] / "docs" / "schema"


def _add_dirs(p: argparse.ArgumentParser) -> None:
    for name in ("pcd", "labels", "prelabel", "export", "cache"):
        p.add_argument(f"--{name}-dir", type=Path, help=f"overrides AXEL_{name.upper()}_DIR")


def _config(args: argparse.Namespace) -> Config:
    return Config.from_env(
        pcd_dir=args.pcd_dir,
        labels_dir=args.labels_dir,
        prelabel_dir=args.prelabel_dir,
        export_dir=args.export_dir,
        cache_dir=args.cache_dir,
    )


def write_schemas(out: Path) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for name, schema in json_schemas().items():
        path = out / name
        path.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n")
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="axel-labler", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    serve = sub.add_parser("serve", help="run the API server")
    _add_dirs(serve)
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)

    imp = sub.add_parser("import-prelabels", help="import all not yet imported prelabel files")
    _add_dirs(imp)

    exp = sub.add_parser("export", help="export labels with the given review status")
    _add_dirs(exp)
    exp.add_argument("--status", choices=["ok", "not_ok", "unreviewed"], default="ok")

    schema = sub.add_parser("schema", help="regenerate the JSON Schema files")
    schema.add_argument("--out", type=Path, default=DEFAULT_SCHEMA_DIR)

    args = parser.parse_args(argv)

    if args.cmd == "schema":
        for path in write_schemas(args.out):
            print(f"wrote {path}")
        return

    cfg = _config(args)
    if args.cmd == "serve":
        import uvicorn

        from axel_labler.server import create_app

        if args.host not in LOCAL_HOSTS:
            print(f"WARNING: listening on {args.host} without authentication")
        uvicorn.run(create_app(cfg), host=args.host, port=args.port, workers=1)
        return

    from axel_labler.store import Store

    store = Store(cfg)
    store.startup()
    if args.cmd == "import-prelabels":
        result = store.import_all()
        print(f"imported {result['imported']} prelabel(s)")
        for f in result["failed"]:
            print(f"  failed {f['vehicle_id']}: {f['error']}")
    elif args.cmd == "export":
        from axel_labler.export import run_export

        manifest, _folder = run_export(store, args.status)
        print(f"exported {manifest.count} vehicle(s) to {manifest.roots.export}")
        for s in manifest.skipped:
            print(f"  skipped {s.vehicle_id}: {s.reason}")
