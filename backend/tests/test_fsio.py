import errno
import os
import time

import pytest

from axel_labler import fsio


def test_atomic_write_leaves_no_tmp(tmp_path):
    target = tmp_path / "a.json"
    fsio.atomic_write_json(target, {"a": 1})
    fsio.atomic_write_json(target, {"a": 2})
    assert target.read_text() == '{\n  "a": 2\n}\n'
    assert os.listdir(tmp_path) == ["a.json"]


def test_atomic_write_retries_busy_rename(tmp_path, monkeypatch):
    real_replace = os.replace
    calls = []

    def flaky(src, dst):
        calls.append(1)
        if len(calls) < 3:
            raise OSError(errno.EBUSY, "busy")
        real_replace(src, dst)

    monkeypatch.setattr(fsio.os, "replace", flaky)
    monkeypatch.setattr(fsio.time, "sleep", lambda _s: None)
    fsio.atomic_write_bytes(tmp_path / "b", b"x")
    assert len(calls) == 3
    assert (tmp_path / "b").read_bytes() == b"x"


def test_atomic_write_gives_up_and_cleans(tmp_path, monkeypatch):
    def always_busy(src, dst):
        raise OSError(errno.EBUSY, "busy")

    monkeypatch.setattr(fsio.os, "replace", always_busy)
    monkeypatch.setattr(fsio.time, "sleep", lambda _s: None)
    with pytest.raises(OSError):
        fsio.atomic_write_bytes(tmp_path / "c", b"x")
    assert os.listdir(tmp_path) == []


def test_cleanup_tmp(tmp_path):
    old = tmp_path / ".x.axles.json.tmp-abc"
    new = tmp_path / ".y.axles.json.tmp-def"
    old.write_text("")
    new.write_text("")
    past = time.time() - 7200
    os.utime(old, (past, past))
    assert fsio.cleanup_tmp(tmp_path) == 1
    assert not old.exists() and new.exists()
