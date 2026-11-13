"""
Bridge between the Android app and jdeath's CheckRoyalCaribbeanPrice.py.

The upstream script is run UNCHANGED, exactly as `python CheckRoyalCaribbeanPrice.py -c config.yaml`
would run it on a computer. This module only:
  * picks which copy of the script to run (a newer one downloaded from GitHub, or the one bundled
    in the APK),
  * writes a runtime copy of the user's config with `historyDb` pointed at app storage,
  * streams every output line back to Kotlin, and
  * reads the script's own SQLite history database afterwards to build a JSON summary
    (bookings, check-in labels, price drops) for the app's UI and notifications.
"""
from __future__ import annotations

import contextlib
import io
import json
import locale
import logging
import os
import py_compile
import re
import runpy
import sqlite3
import sys
import threading
import traceback
import urllib.request

import yaml

UPSTREAM_RAW_URL = (
    "https://raw.githubusercontent.com/jdeath/CheckRoyalCaribbeanPrice/refs/heads/main/"
    "CheckRoyalCaribbeanPrice.py"
)
UPSTREAM_COMMITS_URL = (
    "https://api.github.com/repos/jdeath/CheckRoyalCaribbeanPrice/commits"
    "?path=CheckRoyalCaribbeanPrice.py&per_page=1"
)
SCRIPT_NAME = "CheckRoyalCaribbeanPrice.py"
BUNDLED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "upstream")

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_CHECKIN_STATUS = re.compile(r"Passenger Check-In Status:\s*(\S+)")
_BOARDING_WINDOW = re.compile(r"Assigned Boarding Window:\s*(.+)")
_run_lock = threading.Lock()


# --------------------------------------------------------------------------------------------
# Script selection / updating
# --------------------------------------------------------------------------------------------
def bundled_version() -> str:
    try:
        with open(os.path.join(BUNDLED_DIR, "UPSTREAM_VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "unknown"


def _downloaded_paths(work_dir: str):
    d = os.path.join(work_dir, "upstream")
    return os.path.join(d, SCRIPT_NAME), os.path.join(d, "UPSTREAM_VERSION")


def downloaded_version(work_dir: str) -> str:
    script, version = _downloaded_paths(work_dir)
    if not os.path.exists(script):
        return ""
    try:
        with open(version, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return "unknown"


def update_script(work_dir: str) -> str:
    """Download the newest upstream script. Returns a JSON status string; never raises."""
    script, version_file = _downloaded_paths(work_dir)
    os.makedirs(os.path.dirname(script), exist_ok=True)
    tmp = script + ".download"
    try:
        sha = ""
        try:
            req = urllib.request.Request(UPSTREAM_COMMITS_URL, headers={"Accept": "application/vnd.github+json",
                                                                        "User-Agent": "RoyalPriceCheck-Android"})
            with urllib.request.urlopen(req, timeout=20) as r:
                commits = json.loads(r.read().decode("utf-8"))
                if commits:
                    sha = f"{commits[0]['sha']} {commits[0]['commit']['committer']['date'][:10]}"
        except Exception:
            pass  # version label is cosmetic; the download below is what matters

        req = urllib.request.Request(UPSTREAM_RAW_URL, headers={"User-Agent": "RoyalPriceCheck-Android"})
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
        if len(body) < 10_000 or b"def main" not in body:
            raise ValueError("downloaded file does not look like the price check script")
        with open(tmp, "wb") as f:
            f.write(body)
        # Refuse a file that does not even compile; keep the previous copy instead.
        py_compile.compile(tmp, doraise=True)
        os.replace(tmp, script)
        with open(version_file, "w", encoding="utf-8") as f:
            f.write(sha or "downloaded")
        return json.dumps({"ok": True, "version": sha or "downloaded"})
    except Exception as e:  # noqa: BLE001
        with contextlib.suppress(OSError):
            os.remove(tmp)
        return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})


def delete_downloaded(work_dir: str) -> None:
    for p in _downloaded_paths(work_dir):
        with contextlib.suppress(OSError):
            os.remove(p)


def _choose_script(work_dir: str, prefer_downloaded: bool):
    script, _ = _downloaded_paths(work_dir)
    if prefer_downloaded and os.path.exists(script):
        return script, f"latest from GitHub ({downloaded_version(work_dir)})"
    return os.path.join(BUNDLED_DIR, SCRIPT_NAME), f"bundled ({bundled_version()})"


# --------------------------------------------------------------------------------------------
# Running
# --------------------------------------------------------------------------------------------
class _LineStream(io.TextIOBase):
    """File-like object that hands complete lines to a callback."""

    def __init__(self, on_line):
        super().__init__()
        self._on_line = on_line
        self._buf = ""
        self._lock = threading.Lock()

    def writable(self):
        return True

    def write(self, s):
        if not isinstance(s, str):
            s = str(s)
        with self._lock:
            self._buf += s
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                self._emit(line)
        return len(s)

    def flush(self):
        with self._lock:
            if self._buf:
                self._emit(self._buf)
                self._buf = ""

    def isatty(self):
        return False

    def _emit(self, line):
        try:
            self._on_line(line.rstrip("\r"))
        except Exception:  # noqa: BLE001 - a UI callback failure must not kill the run
            pass


@contextlib.contextmanager
def _android_compat():
    """Small, reversible shims for things the desktop script assumes but Android lacks."""
    real_setlocale = locale.setlocale

    def safe_setlocale(category, loc=None):
        try:
            return real_setlocale(category, loc)
        except locale.Error:
            return real_setlocale(category, "C")

    locale.setlocale = safe_setlocale
    try:
        yield
    finally:
        locale.setlocale = real_setlocale


def _write_runtime_config(config_path: str, work_dir: str) -> tuple[str, str]:
    with open(config_path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError("config.yaml must be a YAML mapping (key: value pairs)")
    db_path = os.path.join(work_dir, "history.db")
    data["historyDb"] = db_path  # the app reads results from here
    log_file = data.get("logFile")
    if log_file and not os.path.isabs(str(log_file)):
        data["logFile"] = os.path.join(work_dir, str(log_file))
    runtime = os.path.join(work_dir, "runtime-config.yaml")
    with open(runtime, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)
    return runtime, db_path


def run(config_path: str, work_dir: str, callback, prefer_downloaded: bool = True) -> str:
    """
    Run the price check. `callback` is any object with an `onLine(str)` method (a Kotlin
    object from the app). Returns a JSON summary string.
    """
    def emit(line):
        callback.onLine(line)

    with _run_lock:
        os.makedirs(work_dir, exist_ok=True)
        stream = _LineStream(emit)
        script, script_label = _choose_script(work_dir, prefer_downloaded)
        exit_code = 0
        error = None
        checkin_lines = []

        def tap(line):
            plain = _ANSI.sub("", line)
            m = _CHECKIN_STATUS.search(plain)
            if m:
                checkin_lines.append({"status": m.group(1)})
            m = _BOARDING_WINDOW.search(plain)
            if m and checkin_lines and "window" not in checkin_lines[-1]:
                checkin_lines[-1]["window"] = m.group(1).strip()
            emit(line)

        stream._on_line = tap
        emit(f"[app] Running {script_label}")

        old_argv, old_cwd = sys.argv, os.getcwd()
        old_stdout, old_stderr = sys.stdout, sys.stderr
        root = logging.getLogger()
        old_handlers = list(root.handlers)
        db_path = None
        try:
            runtime_config, db_path = _write_runtime_config(config_path, work_dir)
            os.chdir(work_dir)
            sys.argv = [script, "-c", runtime_config]
            sys.stdout = stream
            sys.stderr = stream
            with _android_compat():
                runpy.run_path(script, run_name="__main__")
        except SystemExit as e:
            exit_code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
        except BaseException as e:  # noqa: BLE001
            exit_code = 1
            error = f"{type(e).__name__}: {e}"
            traceback.print_exc(file=stream)
        finally:
            stream.flush()
            # The script replaces sys.stdout and installs logging handlers; undo all of it.
            sys.stdout, sys.stderr = old_stdout, old_stderr
            for h in list(root.handlers):
                if h not in old_handlers:
                    root.removeHandler(h)
                    with contextlib.suppress(Exception):
                        h.close()
            sys.argv = old_argv
            with contextlib.suppress(OSError):
                os.chdir(old_cwd)

        summary = summarize(db_path) if db_path else {}
        summary.update({
            "exitCode": exit_code,
            "error": error,
            "script": script_label,
            "guestCheckin": checkin_lines,
        })
        return json.dumps(summary)


# --------------------------------------------------------------------------------------------
# Reading the script's own history database
# --------------------------------------------------------------------------------------------
ALERT_DECISIONS = ("rebook", "consider_booking")


def summarize(db_path: str) -> dict:
    if not db_path or not os.path.exists(db_path):
        return {"bookings": [], "drops": [], "run": None}
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        run_row = conn.execute("SELECT * FROM runs ORDER BY run_id DESC LIMIT 1").fetchone()
        if run_row is None:
            return {"bookings": [], "drops": [], "run": None}
        run_id = run_row["run_id"]
        bookings = [dict(r) for r in conn.execute(
            "SELECT reservation_id, ship_code, ship_name, sail_date, nights, stateroom_type, "
            "stateroom_number, checkin_label, final_payment_date, past_final_payment, balance_due, "
            "friendly_name, guests_json FROM bookings WHERE run_id = ? ORDER BY sail_date", (run_id,))]
        drops = [dict(r) for r in conn.execute(
            "SELECT reservation_id, ship_code, sail_date, item_kind, item_name, guest_name, paid_price, "
            "current_price, currency, per_night, rebook_decision, discount_applied, order_date "
            "FROM price_points WHERE run_id = ? AND current_price IS NOT NULL AND paid_price IS NOT NULL "
            "AND current_price < paid_price ORDER BY (paid_price - current_price) DESC", (run_id,))]
        priced = conn.execute(
            "SELECT COUNT(*) FROM price_points WHERE run_id = ? AND status = 'priced'", (run_id,)).fetchone()[0]
        for d in drops:
            d["alert"] = d.get("rebook_decision") in ALERT_DECISIONS
        return {
            "run": {k: run_row[k] for k in run_row.keys()},
            "bookings": bookings,
            "drops": drops,
            "itemsChecked": priced,
        }
    except sqlite3.Error as e:
        return {"bookings": [], "drops": [], "run": None, "dbError": str(e)}
    finally:
        conn.close()
