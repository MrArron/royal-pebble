# Price script updates (verified copy)

The Android app runs jdeath's [`CheckRoyalCaribbeanPrice.py`](https://github.com/jdeath/CheckRoyalCaribbeanPrice)
unchanged (see the Android plan). The script changes every one to two weeks, so this pipeline keeps
our bundled copy current, and the app only ever downloads versions we have verified.

Code: `tools/verify-upstream/verify_upstream.py` (tests: `test_verify_upstream.py`).
Workflows: `.github/workflows/verify-upstream.yml` and `publish-verified-script.yml`.
Layout assumed: the app's Python lives in `android/app/src/main/python/` (script in `upstream/`,
bridge `rcp_runner.py`) and the bridge tests in `android/tests/`. Change `DEFAULT_PY_DIR` and
`DEFAULT_BRIDGE_TESTS` in the tool if that moves.

## Flow

1. **Daily check** (`verify-upstream.yml`, 06:17 UTC, or run it by hand). It clones jdeath's repo and
   compares the script's bytes with ours. Other upstream commits (docs, other scripts) do nothing.
2. **If it changed**, the tool copies the script and LICENSE into `upstream/`, writes
   `UPSTREAM_VERSION` (`<full commit> <date>` of the last commit touching the script) and adds the
   upstream commits since the last version to `upstream/UPSTREAM_CHANGELOG.md`.
3. **Checks** (`verify_upstream.py verify`): our copy is byte-identical to upstream; `py_compile`;
   the bridge tests; jdeath's own `unittests/`; a dry run of the script through the bridge with an
   empty account list and the network pointed at a dead proxy (it must start, build its history
   database and exit 0, and it contacts nobody).
4. **Pull request** `auto/upstream-script-<short sha>`, assigned to Arron with the results table. If
   a check fails it is a draft that says so. A branch per upstream commit means no duplicates.
5. **Arron's check against a real booking**, then merge:
   `python tools/verify-upstream/verify_upstream.py checklist --config <config.yaml> --redact`
   (on the PR branch; needs `pip install requests PyYAML apprise`). It runs the bridge with his
   config and prints the summary JSON; compare check-in label, per-guest status and boarding
   window, final payment date and balance with royalcaribbean.com. It logs in once per account.
   `--redact` hides cabin, guest names and reservation ids so the output can be shared. The runtime
   copy of the config (it holds the password) is deleted afterwards. Never commit the output.
6. **Merge publishes** (`publish-verified-script.yml`): releases `price-script-latest` (rolling) and
   `price-script-<short sha>` (fixed, for rollback), each with the three files below.

## What the app downloads

Base URL: `https://github.com/MrArron/royal-pebble/releases/download/price-script-latest/`

| File | Content |
| --- | --- |
| `VERIFIED.json` | `schema` 1, `upstreamCommit`, `upstreamDate`, `sha256`, `bytes`, `verifiedOn`, `repoCommit`, `scriptUrl` |
| `CheckRoyalCaribbeanPrice.py` | the verified script |
| `UPSTREAM_VERSION` | same format as the bundled one |

The app's "update script" should fetch `VERIFIED.json`, download the script, check its `sha256`,
compile it, and only then replace the old copy (keeping the bundled one as the fallback). It shows
"Verified by Royal Pebble on <verifiedOn>". The bridge's `update_script()` still points at
jdeath's raw URL (`UPSTREAM_RAW_URL`); switch it to this URL, keeping the jdeath URL behind the
advanced "follow jdeath's main" setting.

## Setup and safety

- One-time: Settings > Actions > General > allow GitHub Actions to create and approve pull requests.
- The checks run jdeath's code, so the checkout step does not keep the token; only the final
  push-and-PR step receives it.
- Branch protection on `main` is not needed. Nothing here pushes to `main`.
