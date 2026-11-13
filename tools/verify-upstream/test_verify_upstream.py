"""Offline tests for verify_upstream.py. Run: python3 tools/verify-upstream/test_verify_upstream.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify_upstream as vu  # noqa: E402

SCRIPT_V1 = "def main():\n    print('v1')\n"
SCRIPT_V2 = "def main():\n    print('v2')\n"


def git(cwd, *args):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com",
               GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.com")
    return subprocess.run(["git", *args], cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout.strip()


def commit(repo, text, message):
    (repo / vu.SCRIPT).write_text(text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message)
    return git(repo, "rev-parse", "HEAD")


def sync_args(upstream, py_dir):
    return vu.argparse.Namespace(upstream_dir=str(upstream), clone_url=str(upstream), py_dir=str(py_dir))


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.up = self.root / "upstream-src"
        self.up.mkdir()
        git(self.up, "init", "-q")
        (self.up / "LICENSE").write_text("MIT")
        self.c1 = commit(self.up, SCRIPT_V1, "first")
        self.py = self.root / "py"
        os.environ.pop("GITHUB_OUTPUT", None)

    def tearDown(self):
        self.tmp.cleanup()


class SyncTests(Base):
    def test_first_sync_copies_script_and_writes_version(self):
        self.assertEqual(vu.cmd_sync(sync_args(self.up, self.py)), 0)
        ours = self.py / "upstream"
        self.assertEqual((ours / vu.SCRIPT).read_text(), SCRIPT_V1)
        commit_id, date = vu.read_version(ours)
        self.assertEqual(commit_id, self.c1)
        self.assertRegex(date, r"^\d{4}-\d{2}-\d{2}$")
        self.assertIn("first", (ours / vu.CHANGELOG_FILE).read_text())

    def test_unchanged_upstream_changes_nothing_and_reports_false(self):
        vu.cmd_sync(sync_args(self.up, self.py))
        out = self.root / "gh_out"
        os.environ["GITHUB_OUTPUT"] = str(out)
        before = (self.py / "upstream" / vu.CHANGELOG_FILE).read_text()
        # an upstream commit that does not touch the script must not count as a change
        (self.up / "README.md").write_text("docs")
        git(self.up, "add", "-A")
        git(self.up, "commit", "-q", "-m", "docs only")
        self.assertEqual(vu.cmd_sync(sync_args(self.up, self.py)), 0)
        self.assertIn("changed=false", out.read_text())
        self.assertEqual((self.py / "upstream" / vu.CHANGELOG_FILE).read_text(), before)

    def test_changed_upstream_updates_version_and_lists_new_commits_newest_first(self):
        vu.cmd_sync(sync_args(self.up, self.py))
        self.up.joinpath("x").write_text("")
        c2 = commit(self.up, SCRIPT_V2, "second fix")
        out = self.root / "gh_out"
        os.environ["GITHUB_OUTPUT"] = str(out)
        self.assertEqual(vu.cmd_sync(sync_args(self.up, self.py)), 0)
        ours = self.py / "upstream"
        self.assertEqual((ours / vu.SCRIPT).read_text(), SCRIPT_V2)
        self.assertEqual(vu.read_version(ours)[0], c2)
        log = (ours / vu.CHANGELOG_FILE).read_text()
        self.assertLess(log.index("second fix"), log.rindex("first"))
        self.assertEqual(log.count("## "), 2)
        text = out.read_text()
        self.assertIn("changed=true", text)
        self.assertIn(f"short={c2[:7]}", text)


class PublishTests(Base):
    def test_manifest_matches_the_file_and_notes_name_the_commit(self):
        vu.cmd_sync(sync_args(self.up, self.py))
        out = self.root / "dist"
        args = vu.argparse.Namespace(py_dir=str(self.py), out=str(out), date="2026-11-14", repo_commit="abc")
        self.assertEqual(vu.cmd_publish(args), 0)
        m = json.loads((out / "VERIFIED.json").read_text())
        self.assertEqual(m["sha256"], vu.sha256(out / vu.SCRIPT))
        self.assertEqual(m["upstreamCommit"], self.c1)
        self.assertEqual(m["verifiedOn"], "2026-11-14")
        self.assertTrue(m["scriptUrl"].endswith("/price-script-latest/" + vu.SCRIPT))
        notes = (out / "release-notes.md").read_text()
        self.assertIn("Verified by Royal Pebble on 2026-11-14", notes)
        self.assertIn(self.c1[:7], notes)

    def test_publish_refuses_a_script_that_does_not_compile(self):
        vu.cmd_sync(sync_args(self.up, self.py))
        (self.py / "upstream" / vu.SCRIPT).write_text("def broken(:\n")
        args = vu.argparse.Namespace(py_dir=str(self.py), out=str(self.root / "d"), date="", repo_commit="")
        with self.assertRaises(Exception):
            vu.cmd_publish(args)


class VerifyTests(Base):
    def args(self, **kw):
        base = dict(py_dir=str(self.py), upstream_dir=str(self.up), bridge_tests="", report_md=str(self.root / "r.md"),
                    skip_bridge_tests=True, skip_upstream_tests=True, skip_dry_run=True)
        base.update(kw)
        return vu.argparse.Namespace(**base)

    def make_bridge_stub(self):
        (self.py / "rcp_runner.py").write_text("x = 1\n")

    def test_identical_and_compile_pass(self):
        vu.cmd_sync(sync_args(self.up, self.py))
        self.make_bridge_stub()
        self.assertEqual(vu.cmd_verify(self.args()), 0)
        self.assertIn("| py_compile | pass |", (self.root / "r.md").read_text())

    def test_drift_from_upstream_fails(self):
        vu.cmd_sync(sync_args(self.up, self.py))
        self.make_bridge_stub()
        (self.py / "upstream" / vu.SCRIPT).write_text(SCRIPT_V2)
        self.assertEqual(vu.cmd_verify(self.args()), 1)
        self.assertIn("**FAIL**", (self.root / "r.md").read_text())

    def test_syntax_error_fails(self):
        vu.cmd_sync(sync_args(self.up, self.py))
        self.make_bridge_stub()
        broken = "def broken(:\n"
        (self.py / "upstream" / vu.SCRIPT).write_text(broken)
        (self.up / vu.SCRIPT).write_text(broken)
        self.assertEqual(vu.cmd_verify(self.args()), 1)


class RedactTests(unittest.TestCase):
    def test_masks_personal_fields_and_keeps_the_rest(self):
        out = vu.redact({"bookings": [{"stateroom_number": "9999", "checkin_label": "Open now", "guests_json": "[1]",
                                       "friendly_name": None}], "drops": [{"guest_name": "Pat", "item_name": "Wifi"}]})
        b, d = out["bookings"][0], out["drops"][0]
        self.assertEqual(b["stateroom_number"], "<redacted>")
        self.assertEqual(b["guests_json"], "<redacted>")
        self.assertIsNone(b["friendly_name"])
        self.assertEqual(b["checkin_label"], "Open now")
        self.assertEqual((d["guest_name"], d["item_name"]), ("<redacted>", "Wifi"))


if __name__ == "__main__":
    unittest.main()
