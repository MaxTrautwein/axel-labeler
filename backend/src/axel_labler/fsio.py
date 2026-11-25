"""File I/O that behaves on a CIFS/SMB share.

- Writes go to a temp file in the target directory and are renamed over the target, so a reader
  never sees a half-written file. Renames are retried because SMB may briefly refuse them while
  another client holds the file open.
- No inotify, no file locks: callers rescan and compare content (ETags), not mtimes.
"""

import errno
import hashlib
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

TMP_MARKER = ".tmp-"
_RETRY_ERRNOS = {errno.EBUSY, errno.EACCES, errno.ETXTBSY, errno.EAGAIN, errno.EPERM}
RETRIES = 5


def is_tmp(name: str) -> bool:
    return name.startswith(".") and TMP_MARKER in name


def atomic_write_bytes(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}{TMP_MARKER}{uuid.uuid4().hex}")
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        for attempt in range(RETRIES):
            try:
                os.replace(tmp, path)
                return
            except OSError as exc:
                if exc.errno not in _RETRY_ERRNOS or attempt == RETRIES - 1:
                    raise
                time.sleep(0.05 * 2**attempt)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def atomic_write_json(path: Path, obj: Any) -> None:
    atomic_write_bytes(path, (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode())


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cleanup_tmp(directory: Path, max_age_s: float = 3600) -> int:
    """Delete our own leftover temp files older than max_age_s. Returns the number removed."""
    removed = 0
    now = time.time()
    try:
        entries = list(os.scandir(directory))
    except OSError:
        return 0
    for entry in entries:
        if is_tmp(entry.name) and entry.is_file():
            try:
                if now - entry.stat().st_mtime > max_age_s:
                    os.unlink(entry.path)
                    removed += 1
            except OSError:
                pass
    return removed
