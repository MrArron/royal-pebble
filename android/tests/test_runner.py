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


def test_runtime_config_points_history_at_app_storage(fake_upstream):
    work, cfg = fake_upstream
    rcp_runner.run(str(cfg), str(work), Collector(), True)
    runtime = (work / "runtime-config.yaml").read_text()
    assert str(work / "history.db") in runtime
    assert "p'w" in rcp_runner.yaml.safe_load(runtime)["accountInfo"][0]["password"]


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
    assert "latest from GitHub (def456" in result["script"]
    assert "downloaded copy ran" in out.lines
    # ...but the bundled copy is used when the toggle is off
    result = json.loads(rcp_runner.run(str(cfg), str(work), Collector(), False))
    assert result["script"].startswith("bundled")


def test_bundled_upstream_script_compiles():
    import py_compile
    py_compile.compile(os.path.join(PY_SRC, "upstream", rcp_runner.SCRIPT_NAME), doraise=True)
