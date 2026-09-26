#!/usr/bin/env python3
"""
Royal Pebble account explorer (test tool, not part of the normal sync).

Logs in to your Royal Caribbean account and calls every known read-only
endpoint once, to see what data a login can reach. It writes one folder:

  royal-pebble-explore-<time>/raw/      full replies. PRIVATE: your name,
                                        booking, loyalty number and more.
  royal-pebble-explore-<time>/report.txt
                                        the shape of each reply: field names,
                                        types, list sizes and date/time formats
                                        (digits shown as 9), plus the values of
                                        type/status/category-like fields. No
                                        names, numbers or IDs. Safe to share.

Usage:
    py explore_account.py                         (asks which booking)
    py explore_account.py --ship HM --date YYYY-MM-DD
    py explore_account.py --report-only <folder>  (rebuild report.txt from raw/)

Read-only and gentle: after the login, only GET requests, one at a time, one
attempt each, with a pause between them (about 15-60 requests in total).
Nothing is bought, changed or saved on Royal's side.

Endpoints come from jdeath/CheckRoyalCaribbeanPrice (MIT License,
Copyright (c) 2025 jdeath). They are unofficial and can change without notice.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import getpass
import json
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cruise_sync as cs  # noqa: E402  (shared login, session and constants)

PAUSE = 1.5          # seconds between requests
MAX_ORDERS = 40      # order details fetched at most
MAX_PRODUCTS = 8     # catalog product pages fetched at most
MAX_LINES = 600      # report lines per endpoint

COMMERCE = f"{cs.API}/en/royal/web/commerce-api"


# ---------------------------------------------------------------- requests

class Explorer:
    def __init__(self, sess, auth: dict, out: Path):
        self.sess, self.auth, self.out = sess, auth, out
        self.raw = out / "raw"
        self.raw.mkdir(parents=True, exist_ok=True)
        self.calls: list[dict] = []
        self.ids = {"accountId": auth["account-id"]}

    def get(self, name: str, path: str, params: dict | None = None):
        """GET cs.API + path (path may hold {placeholders} from self.ids).
        Never raises: returns the parsed JSON, or None."""
        if self.calls:
            time.sleep(PAUSE)
        n = sum(1 for c in self.calls if c["n"]) + 1
        url = (path if path.startswith("http") else cs.API + path).format(**self.ids)
        shown = path.replace(cs.API, "")
        rec = {"n": n, "name": name, "path": shown, "params": sorted((params or {}).keys()),
               "status": None, "kb": 0.0, "file": None}
        self.calls.append(rec)
        headers = {"AppKey": cs.APPKEY, "Accept": "application/json", "User-Agent": cs.USER_AGENT,
                   "Access-Token": self.auth["Access-Token"], "account-id": self.auth["account-id"],
                   "vds-id": self.auth["vds-id"]}
        try:
            r = self.sess.request("GET", url, params=params, headers=headers, timeout=cs.TIMEOUT)
        except Exception as e:
            rec["status"] = "no reply"
            print(f"  {n:2}. {name:<26} no reply")
            return None
        body = r.content or b""
        rec["status"], rec["kb"] = r.status_code, round(len(body) / 1024, 1)
        try:
            data = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            data = None
        fname = f"{n:02d}-{name}.json" if data is not None else f"{n:02d}-{name}.txt"
        target = self.raw / fname
        if data is not None:
            target.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        else:
            target.write_bytes(body)
        rec["file"] = fname
        print(f"  {n:2}. {name:<26} {r.status_code}  {rec['kb']:>7.1f} KB")
        return data if (data is not None and r.status_code < 400) else None

    def save_calls(self):
        (self.raw / "_calls.json").write_text(json.dumps(self.calls, indent=2), encoding="utf-8")


def find_key(data, pattern: str):
    """First non-empty scalar value whose key matches pattern, searching depth-first."""
    rx = re.compile(pattern, re.I)
    stack = [data]
    while stack:
        cur = stack.pop(0)
        if isinstance(cur, dict):
            for k, v in cur.items():
                if rx.search(k) and isinstance(v, (str, int)) and not isinstance(v, bool) and str(v):
                    return str(v)
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
    return None


def token_claims(token: str) -> dict:
    try:
        part = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except Exception:
        return {}


def pick_booking(bookings: list[dict], ship: str | None, date8: str | None) -> dict:
    def d8(b):
        return str(b.get("sailDate") or "").replace("-", "")[:8]
    if ship or date8:
        match = [b for b in bookings if (not ship or b.get("shipCode") == ship) and (not date8 or d8(b) == date8)]
        if not match:
            raise cs.SyncError("No booking on your account matches that ship and date.")
        return match[0]
    if len(bookings) == 1:
        return bookings[0]
    today = dt.date.today().strftime("%Y%m%d")
    ordered = sorted(bookings, key=lambda b: (d8(b) < today, d8(b)))
    print("\nBookings on your account:")
    for i, b in enumerate(ordered, 1):
        print(f"  {i:2}. {b.get('shipCode', '?')}  {d8(b)[0:4]}-{d8(b)[4:6]}-{d8(b)[6:8]}")
    choice = cs.ask("Pick a number [1]: ") or "1"
    if not (choice.isdigit() and 1 <= int(choice) <= len(ordered)):
        raise cs.SyncError("Not a number from the list.")
    return ordered[int(choice) - 1]


def explore(ex: Explorer, ship_arg: str | None, date8: str | None, currency: str | None):
    # Account
    ex.get("profile", "/en/royal/web/v3/guestAccounts/{accountId}")
    loyalty = ex.get("loyalty-info", "/en/royal/web/v1/guestAccounts/loyalty/info")
    number = find_key(loyalty, r"^(crownAndAnchorId|captainsClubId|loyaltyNumber|loyaltyId)$")
    if number:
        ex.get("loyalty-history-summary", "/en/royal/web/v1/guestAccounts/loyalty/history/summary",
               {"loyaltyNumber": number})
    res = ex.get("bookings", "/v1/profileBookings/enriched/{accountId}", {"brand": "R", "includeCheckin": "true"})
    bookings = ((res or {}).get("payload") or {}).get("profileBookings") or []
    if not bookings:
        print("  No bookings found; stopping after the account endpoints.")
        return

    ship = None
    if ship_arg:
        ship = ship_arg.upper() if re.fullmatch(r"[A-Za-z]{2}", ship_arg) else cs.find_ship(ex.sess, ship_arg)["shipCode"]
    b = pick_booking(bookings, ship, date8)
    sail8 = str(b.get("sailDate") or "").replace("-", "")[:8]
    ex.ids.update(ship=b.get("shipCode"), sail8=sail8, reservationId=b.get("bookingId"))
    cur = currency or b.get("bookingCurrency") or "USD"
    common = {"passengerId": b.get("passengerId"), "reservationId": b.get("bookingId"),
              "sailingId": f"{b.get('shipCode')}{sail8}", "currencyIso": cur}
    print(f"\nBooking {b.get('shipCode')} {sail8[0:4]}-{sail8[4:6]}-{sail8[6:8]}:")

    ex.get("voyage-enriched", "/en/royal/web/v3/ships/voyages/{ship}{sail8}/enriched")
    ex.get("onboard-credit", f"{COMMERCE}/cart/v1/obc/reservations/{{reservationId}}",
           {k: common[k] for k in ("passengerId", "sailingId", "currencyIso")})
    ex.get("promotions", f"{COMMERCE}/catalog/v2/promotions/list",
           {"sailingId": common["sailingId"], "page": "1", "currencyIso": cur})

    hist = ex.get("order-history", f"{COMMERCE}/calendar/v1/{{ship}}/orderHistory",
                  dict(common, includeMedia="false")) or {}
    payload = hist.get("payload") or {}
    orders = [o for key in ("myOrders", "ordersOthersHaveBookedForMe") for o in payload.get(key) or []]
    codes = [o.get("orderCode") for o in orders if o.get("orderCode")]
    if len(codes) > MAX_ORDERS:
        print(f"  {len(codes)} orders; fetching details for the first {MAX_ORDERS}.")
    products = []
    for i, code in enumerate(codes[:MAX_ORDERS], 1):
        ex.ids["orderCode"] = code
        detail = ex.get(f"order-detail-{i:02d}", f"{COMMERCE}/calendar/v1/{{ship}}/orderHistory/{{orderCode}}",
                        dict(common, includeMedia="false")) or {}
        for item in (detail.get("payload") or {}).get("orderHistoryDetailItems") or []:
            s = item.get("productSummary") or {}
            prefix = (s.get("productTypeCategory") or {}).get("id")
            opts = s.get("baseOptions") or []
            prod = ((opts[0] if opts else {}).get("selected") or {}).get("code")
            if prefix and prod and (prefix, prod) not in products:
                products.append((prefix, prod))

    for i, (prefix, prod) in enumerate(products[:MAX_PRODUCTS], 1):
        ex.ids.update(prefix=prefix, product=prod)
        ex.get(f"catalog-product-{i:02d}", f"{COMMERCE}/catalog/v2/{{ship}}/categories/{{prefix}}/products/{{product}}",
               {"reservationId": b.get("bookingId"), "passengerId": b.get("passengerId"), "currencyIso": cur,
                "startDate": f"{sail8[0:4]}-{sail8[4:6]}-{sail8[6:8]}"})


# ---------------------------------------------------------------- report (no values)

TEMPORAL = re.compile(
    r"\d{4}-?\d{2}-?\d{2}([T ]\d{2}:?\d{2}(:?\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?"
    r"|\d{1,2}:\d{2}(:\d{2})?( ?[AaPp][Mm])?"
    r"|\d{1,2}/\d{1,2}/\d{2,4}( \d{1,2}:\d{2}(:\d{2})?( ?[AaPp][Mm])?)?")
TIMEY_KEY = re.compile(r"date|time|day|start|end|arriv|depart|expir|open|close|when|zone|offset", re.I)
ENUM_KEY = re.compile(r"(type|status|kind|category|currency(iso)?|brand|unit|state|level|tier)$", re.I)
ENUM_VALUE = re.compile(r"[A-Z][A-Z0-9_ -]{1,30}")
PERSONAL_KEY = re.compile(r"name|email|phone|address|number|id$|code$|token|birth|passport|zip|city|country", re.I)


class Node:
    def __init__(self):
        self.types, self.lens, self.patterns, self.enums, self.bools = Counter(), [], Counter(), Counter(), Counter()
        self.children: dict[str, Node] = {}
        self.items: Node | None = None

    def add(self, v, key: str = ""):
        if isinstance(v, dict):
            self.types["obj"] += 1
            for k, x in v.items():
                self.children.setdefault(k, Node()).add(x, k)
        elif isinstance(v, list):
            self.types["list"] += 1
            self.lens.append(len(v))
            self.items = self.items or Node()
            for x in v:
                self.items.add(x, key)
        elif isinstance(v, bool):
            self.types["bool"] += 1
            self.bools[str(v).lower()] += 1
        elif isinstance(v, (int, float)):
            self.types["num"] += 1
            if TIMEY_KEY.search(key) and not PERSONAL_KEY.search(key):
                self.patterns[re.sub(r"\d", "9", str(v))] += 1
        elif v is None:
            self.types["null"] += 1
        else:
            s = str(v)
            self.types["str"] += 1
            if s == "":
                self.patterns["(empty)"] += 1
            elif TEMPORAL.fullmatch(s) or (TIMEY_KEY.search(key) and re.fullmatch(r"[\d:.\-/TZ+ APMapm]{3,32}", s)):
                self.patterns[re.sub(r"\d", "9", s)] += 1
            elif ENUM_KEY.search(key) and not PERSONAL_KEY.search(key) and ENUM_VALUE.fullmatch(s):
                self.enums[s] += 1


def describe(node: Node) -> str:
    parts = []
    for t in ("obj", "list", "str", "num", "bool", "null"):
        if not node.types[t]:
            continue
        if t == "list":
            lo, hi = min(node.lens), max(node.lens)
            inner = ""
            if node.items and node.items.types and not node.items.types["obj"]:
                inner = " of " + describe(node.items)
            parts.append(f"list[{lo}]" + inner if lo == hi else f"list[{lo}-{hi}]" + inner)
        else:
            parts.append(t)
    text = " | ".join(parts)
    if node.patterns:
        text += "  fmt: " + ", ".join(f'"{p}"' for p, _ in node.patterns.most_common(4))
    if node.enums:
        vals = [v for v, _ in node.enums.most_common(10)]
        text += "  = " + " / ".join(vals) + (" / ..." if len(node.enums) > 10 else "")
    if node.bools:
        text += "  (" + ", ".join(f"{k} x{c}" for k, c in sorted(node.bools.items())) + ")"
    return text


def render(node: Node, name: str, path: str, depth: int, parent_objs: int, out: list, temporal: list):
    seen = sum(node.types.values())
    presence = f"  [in {seen} of {parent_objs}]" if parent_objs and seen < parent_objs else ""
    out.append("  " * depth + f"{name}: {describe(node)}{presence}")
    if node.patterns and not set(node.patterns) <= {"(empty)"}:
        temporal.append((path, ", ".join(f'"{p}"' for p, _ in node.patterns.most_common(3))))
    for k, child in node.children.items():
        render(child, k, f"{path}.{k}", depth + 1, node.types["obj"], out, temporal)
    if node.items and node.items.types["obj"]:
        for k, child in node.items.children.items():
            render(child, "[]." + k, f"{path}[].{k}", depth + 1, node.items.types["obj"], out, temporal)


def build_report(folder: Path) -> Path:
    raw = folder / "raw"
    calls = json.loads((raw / "_calls.json").read_text(encoding="utf-8"))
    head, body, temporal_all = [], [], []
    head += ["Royal Pebble account explorer report",
             "Shapes only: field names, types, list sizes, date/time formats (digits as 9) and",
             "type/status-like values. No personal values. Full replies are in raw/ (private).",
             "",
             f"{'#':>3}  {'name':<26} {'status':<8} {'KB':>7}  path (params)"]
    for c in calls:
        params = f"  ({', '.join(c['params'])})" if c["params"] else ""
        head.append(f"{c['n']:>3}  {c['name']:<26} {str(c['status']):<8} {c['kb']:>7}  {c['path']}{params}")
    # Repeated calls (order-detail-01, -02, ...) are merged into one shape.
    groups: dict[str, list[dict]] = {}
    for c in calls:
        groups.setdefault(re.sub(r"-\d+$", "", c["name"]), []).append(c)
    for name, group in groups.items():
        c = group[0]
        statuses = ", ".join(f"{s} x{k}" for s, k in Counter(str(g["status"]) for g in group).items())
        label = f"{name} (all {len(group)} merged)" if len(group) > 1 else f"{c['n']:02d} {name}"
        body += ["", "=" * 78, f"{label}  -  {c['path']}  -  status {statuses}", "=" * 78]
        files = [raw / g["file"] for g in group if g["file"] and (raw / g["file"]).exists()]
        jsons = [f for f in files if f.suffix == ".json"]
        if not files:
            body.append("(no reply saved)")
            continue
        if not jsons:
            body.append(f"(not JSON, {c['kb']} KB)")
            continue
        node = Node()
        for f in jsons:
            node.add(json.loads(f.read_text(encoding="utf-8")))
        lines, temporal = [], []
        render(node, "(root)", "", 0, 0, lines, temporal)
        if len(lines) > MAX_LINES:
            lines = lines[:MAX_LINES] + [f"... {len(lines) - MAX_LINES} more lines"]
        body += lines
        temporal_all += [(name, p, fmt) for p, fmt in temporal]
    head += ["", "Date and time fields found (the open question: do orders carry usable times?)"]
    if temporal_all:
        head += [f"  {n:<26} {p or '(root)'}  {fmt}" for n, p, fmt in temporal_all]
    else:
        head.append("  (none)")
    report = folder / "report.txt"
    report.write_text("\n".join(head + body) + "\n", encoding="utf-8")
    return report


# ---------------------------------------------------------------- main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="See every piece of data a Royal Caribbean login can reach (test tool).")
    ap.add_argument("--ship", help="ship name or code of the booking to explore, e.g. HM")
    ap.add_argument("--date", help="sail date of the booking, YYYY-MM-DD")
    ap.add_argument("--email", help="Royal Caribbean login email (or set RCCL_EMAIL)")
    ap.add_argument("--currency", help="currency for prices (default: the booking's)")
    ap.add_argument("--out-dir", default=".", help="where to create the output folder (default: current folder)")
    ap.add_argument("--report-only", metavar="FOLDER", help="rebuild report.txt from an earlier run's raw/ folder")
    args = ap.parse_args(argv)

    if args.report_only:
        print(f"Wrote {build_report(Path(args.report_only)).resolve()}")
        return 0

    date8 = cs.normalize_date(args.date) if args.date else None
    sess = cs.new_session()
    email = args.email or os.environ.get("RCCL_EMAIL") or cs.ask("Royal Caribbean email: ")
    password = os.environ.get("RCCL_PASSWORD") or getpass.getpass("Password (hidden, not saved): ")
    auth = cs.login(sess, email, password)
    password = None

    out = Path(args.out_dir) / f"royal-pebble-explore-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    ex = Explorer(sess, auth, out)
    (ex.raw / "00-token-claims.json").write_text(json.dumps(token_claims(auth["Access-Token"]), indent=2),
                                                 encoding="utf-8")
    ex.calls.append({"n": 0, "name": "token-claims", "path": "(login token contents)", "params": [],
                     "status": "-", "kb": 0.0, "file": "00-token-claims.json"})
    print("\nLogged in. Calling each endpoint once:")
    try:
        explore(ex, args.ship, date8, args.currency)
    finally:
        ex.save_calls()
        report = build_report(out)
    ok = sum(1 for c in ex.calls if isinstance(c["status"], int) and c["status"] < 400)
    tried = sum(1 for c in ex.calls if c["n"])
    print(f"\n{ok} of {tried} requests returned data.")
    print(f"Report (safe to share): {report.resolve()}")
    print(f"Full replies (private, don't share or commit): {ex.raw.resolve()}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except cs.SyncError as e:
        print(f"\nError: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(1)
