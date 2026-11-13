#!/usr/bin/env python3
"""Keep the Android app's copy of jdeath's price checker current, but only with versions we verified.

Subcommands (see docs/PRICE_SCRIPT_UPDATES.md):

  sync       Compare jdeath/CheckRoyalCaribbeanPrice's script with our copy. If it changed, copy it
             in, update UPSTREAM_VERSION and UPSTREAM_CHANGELOG.md. (Used by the daily workflow.)
  verify     Run the checks on our copy: byte-identical to upstream, py_compile, the bridge tests,
             jdeath's own unittests, and a dry run through the bridge with no real account.
  publish    After a merge: write the verified copy plus VERIFIED.json (sha256, upstream commit,
             date) into a folder, ready to attach to a GitHub release. (Used by the publish workflow.)
  checklist  Local: run the bridge with your own config.yaml and print the summary JSON, for
             checking a PR's script against a real booking before you merge.

Standard library only, except that the dry run and `checklist` import the bridge (needs PyYAML).
It never contacts Royal Caribbean: the dry run points the script at a dead proxy; `checklist`
is the one command that logs in, and only when you run it.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_PY_DIR = REPO / "android" / "app" / "src" / "main" / "python"
DEFAULT_BRIDGE_TESTS = REPO / "android" / "tests"
UPSTREAM_URL = "https://github.com/jdeath/CheckRoyalCaribbeanPrice.git"
SCRIPT = "CheckRoyalCaribbeanPrice.py"
VERSION_FILE = "UPSTREAM_VERSION"
CHANGELOG_FILE = "UPSTREAM_CHANGELOG.md"
RELEASE_BASE = "https://github.com/MrArron/royal-pebble/releases/download/price-script-latest"
REDACT_KEYS = {"stateroom_number", "guest_name", "friendly_name", "reservation_id", "guests_json"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compile_check(path: Path) -> None:
    """Raise SyntaxError if the file does not compile. Writes no .pyc anywhere."""
    compile(path.read_text(encoding="utf-8"), str(path), "exec")


def git(cwd: Path, *args: str, check: bool = True) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout.strip()


def read_version(upstream_dir: Path) -> tuple[str, str]:
    """(commit, date) from UPSTREAM_VERSION, or ('', '') if missing."""
    try:
        parts = (upstream_dir / VERSION_FILE).read_text(encoding="utf-8").split()
    except OSError:
        return "", ""
    return (parts[0] if parts else ""), (parts[1] if len(parts) > 1 else "")


def github_output(**values: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as f:
        for k, v in values.items():
            f.write(f"{k}={str(v).replace(chr(10), ' ')}\n")


# --------------------------------------------------------------------------------------------
# sync
# --------------------------------------------------------------------------------------------
def cmd_sync(a) -> int:
    src = Path(a.upstream_dir)
    if not (src / ".git").exists():
        src.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", a.clone_url, str(src)], check=True)
    ours = Path(a.py_dir) / "upstream"
    ours.mkdir(parents=True, exist_ok=True)
    new_script, old_script = src / SCRIPT, ours / SCRIPT
    if not new_script.exists():
        print(f"upstream has no {SCRIPT}", file=sys.stderr)
        return 1

    if old_script.exists() and sha256(old_script) == sha256(new_script):
        print("unchanged: our copy matches upstream")
        github_output(changed="false")
        return 0

    commit = git(src, "log", "-1", "--format=%H", "--", SCRIPT)
    date = git(src, "log", "-1", "--format=%cs", "--", SCRIPT)
    subject = git(src, "log", "-1", "--format=%s", "--", SCRIPT)
    old_commit, _ = read_version(ours)
    rng = f"{old_commit}..{commit}"
    ancestor = old_commit and subprocess.run(
        ["git", "merge-base", "--is-ancestor", old_commit, commit], cwd=src).returncode == 0
    log_args = ["log", "--format=%cs %h %s", rng, "--", SCRIPT] if ancestor else \
        ["log", "-1", "--format=%cs %h %s", commit, "--", SCRIPT]
    entries = git(src, *log_args).splitlines()

    shutil.copyfile(new_script, old_script)
    if (src / "LICENSE").exists():
        shutil.copyfile(src / "LICENSE", ours / "LICENSE")
    (ours / VERSION_FILE).write_text(f"{commit} {date}\n", encoding="utf-8")

    changelog = ours / CHANGELOG_FILE
    head = "# Upstream script changelog\n\nNewest first. Each entry is an upstream commit that touched the script.\n"
    body = changelog.read_text(encoding="utf-8") if changelog.exists() else head
    if not body.startswith("# "):
        body = head + "\n" + body
    marker = body.index("\n", body.index("Newest first")) + 1
    block = "\n## " + commit[:7] + " (" + date + ")\n\n" + "\n".join(f"- {e}" for e in entries) + "\n"
    changelog.write_text(body[:marker] + block + body[marker:], encoding="utf-8")

    print(f"changed: {old_commit[:7] or 'none'} -> {commit[:7]} ({date}): {subject}")
    github_output(changed="true", commit=commit, short=commit[:7], date=date, subject=subject)
    return 0


# --------------------------------------------------------------------------------------------
# bridge helpers (dry run, checklist)
# --------------------------------------------------------------------------------------------
class Collector:
    def __init__(self, echo=None):
        self.lines: list[str] = []
        self.echo = echo

    def onLine(self, line):  # noqa: N802 - the bridge calls this name (a Kotlin interface in the app)
        self.lines.append(line)
        if self.echo:
            self.echo(line)


def run_bridge(py_dir: Path, config: Path, work: Path, echo=None) -> tuple[dict, list[str]]:
    sys.path.insert(0, str(py_dir))
    import rcp_runner  # noqa: PLC0415 - the path above is what makes this importable
    out = Collector(echo)
    summary = json.loads(rcp_runner.run(str(config), str(work), out, False))
    return summary, out.lines


# --------------------------------------------------------------------------------------------
# verify
# --------------------------------------------------------------------------------------------
def step_identical(a) -> str:
    ours, theirs = Path(a.py_dir) / "upstream" / SCRIPT, Path(a.upstream_dir) / SCRIPT
    if sha256(ours) != sha256(theirs):
        raise RuntimeError("our copy differs from the upstream checkout")
    return f"sha256 {sha256(ours)[:12]}"


def step_compile(a) -> str:
    for p in (Path(a.py_dir) / "upstream" / SCRIPT, Path(a.py_dir) / "rcp_runner.py"):
        compile_check(p)
    return "script and bridge compile"


def pytest(cwd: Path, target: str, env_extra: dict | None = None) -> str:
    env = dict(os.environ, **(env_extra or {}))
    r = subprocess.run([sys.executable, "-m", "pytest", target, "-q", "-p", "no:cacheprovider"],
                       cwd=cwd, env=env, capture_output=True, text=True)
    tail = "\n".join((r.stdout + r.stderr).strip().splitlines()[-15:])
    if r.returncode != 0:
        raise RuntimeError(tail)
    return tail.splitlines()[-1] if tail else "ok"


def step_bridge_tests(a) -> str:
    return pytest(Path(a.bridge_tests).parent, str(a.bridge_tests))


def step_upstream_tests(a) -> str:
    up = Path(a.upstream_dir)
    if not (up / "unittests").is_dir():
        raise RuntimeError("upstream checkout has no unittests/ folder")
    return pytest(up, "unittests", {"PYTHONPATH": str(up)})


def step_dry_run(a) -> str:
    """Run the real script through the bridge with no account, offline. It must start, build its
    history database and exit cleanly: that catches syntax, import and startup breakage."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        cfg = work / "config.yaml"
        cfg.write_text('logFile: "output.txt"\naccountInfo: []\n', encoding="utf-8")
        dead = {"HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9",
                "http_proxy": "http://127.0.0.1:9", "https_proxy": "http://127.0.0.1:9", "NO_PROXY": ""}
        saved = {k: os.environ.get(k) for k in dead}
        os.environ.update(dead)
        try:
            summary, lines = run_bridge(Path(a.py_dir), cfg, work / "work")
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
    if summary.get("exitCode") != 0 or summary.get("error"):
        raise RuntimeError(f"exit {summary.get('exitCode')}: {summary.get('error')}\n" + "\n".join(lines[-10:]))
    if not any("Report generated" in ln for ln in lines):
        raise RuntimeError("script did not reach its report header\n" + "\n".join(lines[-10:]))
    return f"clean exit, {len(lines)} lines"


def cmd_verify(a) -> int:
    steps = [("Byte-identical to upstream", step_identical, bool(a.upstream_dir)),
             ("py_compile", step_compile, True),
             ("Bridge tests", step_bridge_tests, not a.skip_bridge_tests),
             ("jdeath's unittests", step_upstream_tests, bool(a.upstream_dir) and not a.skip_upstream_tests),
             ("Dry run through the bridge (no account, offline)", step_dry_run, not a.skip_dry_run)]
    results = []
    for name, fn, enabled in steps:
        if not enabled:
            results.append({"name": name, "status": "skipped", "detail": ""})
            continue
        try:
            results.append({"name": name, "status": "pass", "detail": fn(a)})
        except Exception as e:  # noqa: BLE001 - every failure is reported, never raised
            results.append({"name": name, "status": "FAIL", "detail": str(e)})
        print(f"{results[-1]['status']:7} {name}: {results[-1]['detail'].splitlines()[-1] if results[-1]['detail'] else ''}")
    ok = all(r["status"] != "FAIL" for r in results)
    if a.report_md:
        rows = ["| Check | Result |", "| --- | --- |"]
        icon = {"pass": "pass", "FAIL": "**FAIL**", "skipped": "skipped"}
        rows += [f"| {r['name']} | {icon[r['status']]} |" for r in results]
        fails = [f"<details><summary>{r['name']}</summary>\n\n```\n{r['detail']}\n```\n</details>"
                 for r in results if r["status"] == "FAIL"]
        Path(a.report_md).write_text("\n".join(rows + [""] + fails) + "\n", encoding="utf-8")
    github_output(verified="true" if ok else "false")
    return 0 if ok else 1


# --------------------------------------------------------------------------------------------
# publish
# --------------------------------------------------------------------------------------------
def cmd_publish(a) -> int:
    ours = Path(a.py_dir) / "upstream"
    script = ours / SCRIPT
    compile_check(script)
    commit, date = read_version(ours)
    if not commit:
        print(f"{VERSION_FILE} is missing or empty", file=sys.stderr)
        return 1
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(script, out / SCRIPT)
    shutil.copyfile(ours / VERSION_FILE, out / VERSION_FILE)
    manifest = {
        "schema": 1,
        "upstreamRepo": "jdeath/CheckRoyalCaribbeanPrice",
        "upstreamCommit": commit,
        "upstreamDate": date,
        "sha256": sha256(script),
        "bytes": script.stat().st_size,
        "verifiedOn": a.date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
        "repoCommit": a.repo_commit or os.environ.get("GITHUB_SHA", ""),
        "scriptUrl": f"{RELEASE_BASE}/{SCRIPT}",
    }
    (out / "VERIFIED.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    notes = f"Verified by Royal Pebble on {manifest['verifiedOn']}.\n\nUpstream commit `{commit}` ({date}), sha256 `{manifest['sha256']}`.\n"
    changelog = ours / CHANGELOG_FILE
    if changelog.exists():
        text = changelog.read_text(encoding="utf-8")
        i = text.find("\n## ")
        j = text.find("\n## ", i + 1) if i >= 0 else -1
        if i >= 0:
            notes += "\n" + text[i:j if j > 0 else None].strip() + "\n"
    (out / "release-notes.md").write_text(notes, encoding="utf-8")
    github_output(short=commit[:7], verified_on=manifest["verifiedOn"])
    print(json.dumps(manifest, indent=2))
    return 0


# --------------------------------------------------------------------------------------------
# checklist (local, real account)
# --------------------------------------------------------------------------------------------
def redact(obj):
    if isinstance(obj, dict):
        return {k: ("<redacted>" if k in REDACT_KEYS and v not in (None, "") else redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


def cmd_checklist(a) -> int:
    cfg = Path(a.config).expanduser()
    if not cfg.exists():
        print(f"config not found: {cfg}", file=sys.stderr)
        return 1
    work = Path(a.work_dir).expanduser()
    work.mkdir(parents=True, exist_ok=True)
    ours = Path(a.py_dir) / "upstream"
    print(f"Running the script in {ours} (version {' '.join(read_version(ours)) or 'unknown'}) with {cfg}", file=sys.stderr)
    print("This logs in to Royal Caribbean once per account. Output below can contain personal data.", file=sys.stderr)
    try:
        summary, _ = run_bridge(Path(a.py_dir), cfg, work, echo=lambda ln: print(ln, file=sys.stderr))
    finally:
        # The bridge writes a runtime copy of the config, password included. Don't leave it behind.
        (work / "runtime-config.yaml").unlink(missing_ok=True)
    if a.redact:
        summary = redact(summary)
    print(json.dumps(summary, indent=2))

    err = sys.stderr
    print("\nCompare with royalcaribbean.com and the Royal app:", file=err)
    for b in summary.get("bookings", []):
        print(f"  - booking {b.get('reservation_id')}: check-in '{b.get('checkin_label')}', "
              f"final payment {b.get('final_payment_date')}, balance due {b.get('balance_due')}", file=err)
    for g in summary.get("guestCheckin", []):
        print(f"  - guest check-in {g.get('status')}, boarding window {g.get('window', 'n/a')}", file=err)
    print(f"  - {len(summary.get('drops', []))} price drop(s), exit code {summary.get('exitCode')}"
          + (f", error: {summary['error']}" if summary.get("error") else ""), file=err)
    print("If these match what Royal shows, merge the PR. Do not commit or paste this output.", file=err)
    return 0 if summary.get("exitCode") in (0, 2) and not summary.get("error") else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--py-dir", default=str(DEFAULT_PY_DIR), help="the Android app's python source folder")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("sync", help="copy upstream's script in if it changed")
    s.add_argument("--upstream-dir", default="upstream-src", help="checkout of jdeath's repo (cloned if missing)")
    s.add_argument("--clone-url", default=UPSTREAM_URL)
    s.set_defaults(fn=cmd_sync)

    v = sub.add_parser("verify", help="run every check on our copy")
    v.add_argument("--upstream-dir", default="", help="checkout of jdeath's repo (enables the identical + unittests checks)")
    v.add_argument("--bridge-tests", default=str(DEFAULT_BRIDGE_TESTS))
    v.add_argument("--report-md", default="", help="write a markdown results table here")
    v.add_argument("--skip-bridge-tests", action="store_true")
    v.add_argument("--skip-upstream-tests", action="store_true")
    v.add_argument("--skip-dry-run", action="store_true")
    v.set_defaults(fn=cmd_verify)

    u = sub.add_parser("publish", help="write the verified copy and VERIFIED.json")
    u.add_argument("--out", default="dist")
    u.add_argument("--date", default="", help="verification date YYYY-MM-DD (default: today, UTC)")
    u.add_argument("--repo-commit", default="")
    u.set_defaults(fn=cmd_publish)

    c = sub.add_parser("checklist", help="run with your own config and print the summary JSON")
    c.add_argument("--config", required=True, help="your price-check config.yaml")
    c.add_argument("--work-dir", default="~/.cache/royal-pebble-checklist")
    c.add_argument("--redact", action="store_true", help="mask cabin, guest names and reservation ids")
    c.set_defaults(fn=cmd_checklist)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
