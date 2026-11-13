"""Tests for the Python bridge. Run from the repo root: python -m pytest tests"""
import json
import logging
import os
import sys
import textwrap

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
PY_SRC = os.path.join(HERE, "..", "app", "src", "main", "python")
sys.path.insert(0, PY_SRC)

import rcp_runner  # noqa: E402

FAKE_SCRIPT = textwrap.dedent('''
    import argparse, logging, sqlite3, sys, yaml, locale
    p = argparse.ArgumentParser(); p.add_argument("-c"); a = p.parse_args()
    cfg = yaml.safe_load(open(a.c))
    locale.setlocale(locale.LC_TIME, "xx_NOT_A_LOCALE")   # must not crash on Android
    logging.getLogger().addHandler(logging.StreamHandler(sys.stdout))
    print("\\033[1;31;40mCheck In Available! Fetching boarding documentation data...\\033[0m")
    print("\\tPassenger Check-In Status: COMPLETED")
    print("\\tAssigned Boarding Window: Not Selected")
    print("user=" + cfg["accountInfo"][0]["username"])
    print("history=" + cfg["historyDb"])
    print("pw=" + cfg["accountInfo"][0]["password"])
    db = sqlite3.connect(cfg["historyDb"])
    db.executescript("""
      CREATE TABLE runs (run_id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, status TEXT, error_summary TEXT);
      CREATE TABLE bookings (run_id INT, reservation_id TEXT, ship_code TEXT, ship_name TEXT, sail_date TEXT,
        nights INT, stateroom_type TEXT, stateroom_number TEXT, checkin_label TEXT, final_payment_date TEXT,
        past_final_payment INT, balance_due INT, friendly_name TEXT, guests_json TEXT);
      CREATE TABLE price_points (run_id INT, reservation_id TEXT, ship_code TEXT, sail_date TEXT, item_kind TEXT,
        item_name TEXT, guest_name TEXT, paid_price REAL, current_price REAL, currency TEXT, per_night INT,
        rebook_decision TEXT, discount_applied TEXT, order_date TEXT, status TEXT);
      INSERT INTO runs VALUES (1, 'a', 'b', 'ok', NULL);
      INSERT INTO bookings VALUES (1, '123', 'UT', 'Utopia', '20270101', 4, 'BALCONY', '1234', 'Open now', '20261001', 1, 0, NULL, '[]');
      INSERT INTO price_points VALUES (1, '123', 'UT', '20270101', 'addon', 'Deluxe Beverage', 'Arron', 99.0, 80.0, 'USD', 1, 'rebook', NULL, NULL, 'priced');
      INSERT INTO price_points VALUES (1, '123', 'UT', '20270101', 'addon', 'Wifi', 'Arron', 20.0, 25.0, 'USD', 1, 'best_price', NULL, NULL, 'priced');
    """)
    db.commit()
    sys.exit(2)
''')


@pytest.fixture
def fake_upstream(tmp_path, monkeypatch):
    bundled = tmp_path / "bundled"
    bundled.mkdir()
    (bundled / rcp_runner.SCRIPT_NAME).write_text(FAKE_SCRIPT)
    (bundled / "UPSTREAM_VERSION").write_text("abc123 2026-10-30")
    monkeypatch.setattr(rcp_runner, "BUNDLED_DIR", str(bundled))
    work = tmp_path / "work"
    work.mkdir()
    cfg = work / "config.yaml"
    cfg.write_text('accountInfo:\n  - username: "me@example.com"\n    password: "p\'w"\n    cruiseLine: royal\n')
    return work, cfg


class Collector:
    def __init__(self):
        self.lines = []

    def onLine(self, line):  # noqa: N802 - matches the Kotlin interface
        self.lines.append(line)


def test_run_streams_output_and_summarizes(fake_upstream):
    work, cfg = fake_upstream
    out = Collector()
    real_stdout = sys.stdout
    handlers_before = list(logging.getLogger().handlers)

    result = json.loads(rcp_runner.run(str(cfg), str(work), out, True))

    assert sys.stdout is real_stdout
    assert logging.getLogger().handlers == handlers_before
    assert result["exitCode"] == 2
    assert result["error"] is None
    assert "bundled (abc123" in result["script"]
    assert any("user=me@example.com" in line for line in out.lines)
    assert result["guestCheckin"] == [{"status": "COMPLETED", "window": "Not Selected"}]
    assert result["bookings"][0]["checkin_label"] == "Open now"
    assert len(result["drops"]) == 1
    drop = result["drops"][0]
    assert drop["item_name"] == "Deluxe Beverage" and drop["alert"] is True


def test_runtime_config_points_history_at_app_storage_and_is_removed(fake_upstream):
    work, cfg = fake_upstream
    out = Collector()
    rcp_runner.run(str(cfg), str(work), out, True)
    assert f"history={work / 'history.db'}" in out.lines
    assert "pw=p'w" in out.lines
    # the runtime copy holds the password, so it must not stay on disk
    assert not (work / "runtime-config.yaml").exists()


def test_crash_is_reported_not_raised(fake_upstream, tmp_path, monkeypatch):
    work, cfg = fake_upstream
    (tmp_path / "bundled" / rcp_runner.SCRIPT_NAME).write_text("raise RuntimeError('boom')\n")
    out = Collector()
    result = json.loads(rcp_runner.run(str(cfg), str(work), out, True))
    assert result["exitCode"] == 1
    assert "boom" in result["error"]
    assert result["bookings"] == []


def test_prefers_downloaded_script_when_present(fake_upstream):
    work, cfg = fake_upstream
    script, version = rcp_runner._downloaded_paths(str(work))
    os.makedirs(os.path.dirname(script))
    with open(script, "w") as f:
        f.write("print('downloaded copy ran')\n")
    with open(version, "w") as f:
        f.write("def456 2026-11-12")
    out = Collector()
    result = json.loads(rcp_runner.run(str(cfg), str(work), out, True))
    assert "downloaded (def456" in result["script"]
    assert "downloaded copy ran" in out.lines
    # ...but the bundled copy is used when the toggle is off
    result = json.loads(rcp_runner.run(str(cfg), str(work), Collector(), False))
    assert result["script"].startswith("bundled")


def test_bundled_upstream_script_compiles():
    import py_compile
    py_compile.compile(os.path.join(PY_SRC, "upstream", rcp_runner.SCRIPT_NAME), doraise=True)


BIG_SCRIPT = ("# padding\n" * 2000 + "def main():\n    pass\n").encode()


def _fake_fetch(monkeypatch, files):
    def fetch(url, timeout=60):
        for name, body in files.items():
            if url.endswith(name):
                return body
        raise OSError("404 " + url)
    monkeypatch.setattr(rcp_runner, "_fetch", fetch)


def test_update_downloads_verified_copy_and_checks_sha(tmp_path, monkeypatch):
    import hashlib
    manifest = {"sha256": hashlib.sha256(BIG_SCRIPT).hexdigest(), "upstreamCommit": "abcdef1234567",
                "upstreamDate": "2026-11-01", "verifiedOn": "2026-11-05"}
    _fake_fetch(monkeypatch, {"VERIFIED.json": json.dumps(manifest).encode(),
                              rcp_runner.SCRIPT_NAME: BIG_SCRIPT})
    result = json.loads(rcp_runner.update_script(str(tmp_path)))
    assert result["ok"] is True
    assert "abcdef1" in result["version"] and "verified by Royal Pebble 2026-11-05" in result["version"]
    assert "verified by Royal Pebble" in rcp_runner.downloaded_version(str(tmp_path))


def test_update_refuses_checksum_mismatch_and_keeps_old_copy(tmp_path, monkeypatch):
    script, version = rcp_runner._downloaded_paths(str(tmp_path))
    os.makedirs(os.path.dirname(script))
    open(script, "w").write("print('old')\n")
    open(version, "w").write("old")
    _fake_fetch(monkeypatch, {"VERIFIED.json": json.dumps({"sha256": "0" * 64}).encode(),
                              rcp_runner.SCRIPT_NAME: BIG_SCRIPT})
    result = json.loads(rcp_runner.update_script(str(tmp_path)))
    assert result["ok"] is False and "checksum" in result["error"]
    assert open(script).read() == "print('old')\n"
    assert not os.path.exists(script + ".download")


def test_update_follow_upstream_uses_jdeath_url(tmp_path, monkeypatch):
    seen = []

    def fetch(url, timeout=60):
        seen.append(url)
        if "api.github.com" in url:
            return b"[]"
        return BIG_SCRIPT
    monkeypatch.setattr(rcp_runner, "_fetch", fetch)
    result = json.loads(rcp_runner.update_script(str(tmp_path), True))
    assert result["ok"] is True and "not verified" in result["version"]
    assert rcp_runner.UPSTREAM_RAW_URL in seen
    assert not any("royal-pebble" in u for u in seen)


def test_update_rejects_script_that_does_not_compile(tmp_path, monkeypatch):
    import hashlib
    bad = BIG_SCRIPT + b"def (\n"
    _fake_fetch(monkeypatch, {"VERIFIED.json": json.dumps({"sha256": hashlib.sha256(bad).hexdigest()}).encode(),
                              rcp_runner.SCRIPT_NAME: bad})
    result = json.loads(rcp_runner.update_script(str(tmp_path)))
    assert result["ok"] is False
