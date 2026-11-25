"""Runtime configuration from AXEL_* environment variables (Docker) with CLI overrides."""

import os
from dataclasses import dataclass, fields, replace
from pathlib import Path

ENV_PREFIX = "AXEL_"


@dataclass(frozen=True)
class Config:
    pcd_dir: Path
    labels_dir: Path
    prelabel_dir: Path | None = None
    export_dir: Path | None = None
    cache_dir: Path | None = None
    # Paths as seen by consumers outside the container (written into export manifests).
    pcd_dir_host: str | None = None
    export_dir_host: str | None = None
    gt_tolerance_m: float = 0.10
    max_depth_m: float = 0.8

    @classmethod
    def from_env(cls, **overrides: object) -> "Config":
        values: dict[str, object] = {}
        for f in fields(cls):
            raw = os.environ.get(ENV_PREFIX + f.name.upper())
            if raw:
                values[f.name] = raw
        values.update({k: v for k, v in overrides.items() if v is not None})
        missing = [n for n in ("pcd_dir", "labels_dir") if n not in values]
        if missing:
            names = ", ".join(ENV_PREFIX + n.upper() for n in missing)
            raise SystemExit(f"Missing configuration: {names} (or the matching --option)")
        return cls._coerce(values)

    @classmethod
    def _coerce(cls, values: dict[str, object]) -> "Config":
        out: dict[str, object] = {}
        for f in fields(cls):
            if f.name not in values:
                continue
            v = values[f.name]
            if f.name.endswith("_dir"):
                out[f.name] = Path(str(v))
            elif f.name.endswith("_m"):
                out[f.name] = float(str(v))
            else:
                out[f.name] = str(v)
        return cls(**out)  # type: ignore[arg-type]

    def with_overrides(self, **overrides: object) -> "Config":
        return replace(self, **{k: v for k, v in overrides.items() if v is not None})
