#!/usr/bin/env python3
"""
Royal Pebble sync tool (backup data path).

Downloads a Royal Caribbean sailing's itinerary and activity schedule and
writes them as one compact JSON bundle for the Royal Pebble phone settings
page ("Backup: paste cruise data"). Optionally logs in to your Royal
Caribbean account to add your stateroom and purchased add-ons.

Usage:
    py cruise_sync.py                       (interactive: asks for ship and date)
    py cruise_sync.py --ship harmony --date YYYY-MM-DD
    py cruise_sync.py --ship HM --date YYYY-MM-DD --login

Your password is never saved. It is read from the RCCL_PASSWORD environment
variable if set, otherwise typed at a hidden prompt.

These are Royal Caribbean's own website endpoints, which are unofficial and
undocumented; they can change without notice. The endpoint knowledge, app key
and login client come from jdeath/CheckRoyalCaribbeanPrice (MIT License,
Copyright (c) 2025 jdeath).
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import getpass
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

try:  # curl_cffi mimics a real browser, which avoids most "403 Access Denied" blocks
    from curl_cffi import requests as http

    def new_session():
        return http.Session(impersonate="chrome")
    BROWSER_MIMIC = True
except ImportError:  # plain requests works for most people
    import requests as http

    def new_session():
        return http.Session()
    BROWSER_MIMIC = False

FORMAT_NAME = "cruise-watch"
FORMAT_VERSION = 1

API = "https://aws-prd.api.rccl.com"
APPKEY = "hyNNqIPHHzaLzVpcICPdAdbFV8yvTsAm"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0"
LOGIN_URL = "https://www.royalcaribbean.com/auth/oauth2/access_token"
LOGIN_CLIENT = ("Basic ZzlTMDIzdDc0NDczWlVrOTA5Rk42OEYwYjRONjdQU09oOTJvMDR2TDBCUjY1MzdwSTJ5Mmg5NE02QmJVN0Q2SjpX"
                "NjY4NDZrUFF2MTc1MDk3NW9vZEg1TTh6QzZUYTdtMzBrSDJRNzhsMldtVTUwRkNncXBQMTN3NzczNzdrN0lC")
TIMEOUT = 30
PAGE = 200
# Product types kept for the schedule (docs/DATA_FORMAT.md): the free activities,
# plus the shows you reserve (ENTERTAINMENT) and the paid classes and experiences
# (ACTIVITIES), which come through with "reservation" set. Spa, dining and shore
# excursions are booking slots, not events. Keep in step with src/pkjs/royal.js.
SCHEDULE_TYPES = ("NON_REVENUE_SCHEDULABLE", "ENTERTAINMENT", "ACTIVITIES")
# Left out by title: NextCruise sales appointments (about 22 slots a day) would
# push busy days past the watch's 160 events.
SKIP_TITLES = re.compile(r"nextcruise", re.I)


class SyncError(Exception):
    """A problem worth showing the user as a plain message."""


# ---------------------------------------------------------------- helpers

def clean(text) -> str:
    """Plain, watch-friendly text: straight quotes, no trademark symbols."""
    if not text:
        return ""
    s = str(text)
    for a, b in (("\u2019", "'"), ("\u2018", "'"), ("\u201c", '"'), ("\u201d", '"'),
                 ("\u2013", "-"), ("\u2014", "-"), ("\u00a0", " "), ("\u2026", "...")):
        s = s.replace(a, b)
    s = re.sub(r"[\u00ae\u2120\u2122\u00a9]", "", s)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", s).strip()


def get_json(sess, method, url, *, params=None, headers=None, data=None, retries=3):
    """One API call with retries for network hiccups and 5xx errors."""
    hdrs = {"AppKey": APPKEY, "Accept": "application/json", "User-Agent": USER_AGENT}
    hdrs.update(headers or {})
    last = None
    for attempt in range(1, retries + 1):
        try:
            r = sess.request(method, url, params=params, headers=hdrs, data=data, timeout=TIMEOUT)
        except Exception as e:  # connection problems
            last = f"could not reach Royal Caribbean ({e})"
        else:
            if r.status_code == 403:
                hint = "" if BROWSER_MIMIC else " Installing curl_cffi usually fixes this (see README)."
                raise SyncError("Royal Caribbean refused the request (403 Access Denied)." + hint)
            if 400 <= r.status_code < 500:
                raise SyncError(f"Royal Caribbean returned error {r.status_code} for {url.split('?')[0]}")
            if r.status_code < 400:
                try:
                    return r.json()
                except ValueError:
                    last = "the reply was not valid data"
            else:
                last = f"server error {r.status_code}"
        if attempt < retries:
            time.sleep(2 * attempt)
    raise SyncError(f"Giving up: {last}. Check your internet connection and try again.")


def split_stamp(stamp):
    """'20270309T070000' -> ('2027-03-09', '07:00')."""
    if not stamp or len(stamp) < 13:
        return None, None
    return f"{stamp[0:4]}-{stamp[4:6]}-{stamp[6:8]}", f"{stamp[9:11]}:{stamp[11:13]}"


# ---------------------------------------------------------------- public data

def find_ship(sess, query: str) -> dict:
    ships = get_json(sess, "GET", f"{API}/en/royal/web/v2/ships")["payload"]["ships"]
    ships = [s for s in ships if s.get("brand") == "R"]
    q = query.strip().lower()
    exact = [s for s in ships if s["shipCode"].lower() == q or s["name"].lower() == q]
    if exact:
        return exact[0]
    partial = [s for s in ships if q in s["name"].lower()]
    if len(partial) == 1:
        return partial[0]
    names = ", ".join(sorted(f"{s['name']} ({s['shipCode']})" for s in (partial or ships)))
    if partial:
        raise SyncError(f"'{query}' matches several ships: {names}")
    raise SyncError(f"No Royal Caribbean ship matches '{query}'. Ships: {names}")


def list_sailings(sess, code: str) -> list[str]:
    raw = json.dumps(get_json(sess, "GET", f"{API}/en/royal/web/v3/ships/{code}/voyages"))
    return sorted(set(re.findall(r'"sailDate": "(\d{8})"', raw)))


def fetch_itinerary(sess, code: str, date8: str) -> list[dict]:
    payload = get_json(sess, "GET", f"{API}/en/royal/web/v3/ships/{code}/sailDate/{date8}").get("payload") or {}
    info = payload.get("sailingInfo")
    info = info[0] if isinstance(info, list) and info else info
    events = ((info or {}).get("itinerary") or {}).get("events") or []
    days = []
    for ev in events:
        port = (ev or {}).get("port") or {}
        kind = port.get("portType", "UNKNOWN")
        date, arrive = split_stamp(port.get("arrivalDateTime"))
        _, depart = split_stamp(port.get("departureDateTime"))
        # Royal fills unused times with placeholders (00:00, 23:59); drop them
        if kind in ("CRUISING", "EMBARK"):
            arrive = None
        if kind in ("CRUISING", "DEBARK"):
            depart = None
        days.append({"day": ev.get("day"), "date": date, "port": clean(port.get("portName")),
                     "code": port.get("portCode"), "type": kind, "arrive": arrive, "depart": depart})
    if not days:
        raise SyncError("Royal Caribbean returned no itinerary for that sailing.")
    return days


def product_price(p: dict):
    """The adult "from" price in dollars (cents kept), or None when none is listed."""
    v = (p.get("startingFromPrice") or {}).get("adultPrice")
    if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
        return None
    v = round(float(v), 2)
    return int(v) if v == int(v) else v


def fetch_schedule(sess, code: str, date8: str) -> dict:
    cats, venues, events, seen = [], [], [], set()

    def index(table, value):
        if value not in table:
            table.append(value)
        return table.index(value)

    for offset in range(0, 20000, PAGE):
        payload = get_json(sess, "GET", f"{API}/en/royal/web/v3/products",
                           params={"sailingID": code + date8, "limit": str(PAGE), "offset": str(offset)}).get("payload") or {}
        products = payload.get("products") or []
        for p in products:
            if ((p.get("productType") or {}).get("productType")) not in SCHEDULE_TYPES                     or SKIP_TITLES.search(p.get("productTitle") or ""):
                continue
            parent, child = "Other", ""
            pcs = p.get("productCategory") or []
            if pcs:
                parent = clean(pcs[0].get("categoryName")).capitalize() or "Other"
                kids = pcs[0].get("childCategory") or []
                if kids:
                    items = kids[0].get("items")
                    items = items[0] if isinstance(items, list) and items else items
                    child = clean((items or {}).get("categoryName"))
            cat = index(cats, [parent, child])
            venue = index(venues, clean((p.get("productLocation") or {}).get("locationTitle")))
            title = clean(p.get("productTitle"))
            minutes = (p.get("productDuration") or {}).get("durationInMinutes") or 0
            # Paid classes and experiences: only the sessions the owner picks on the
            # settings page reach the watch (docs/DATA_FORMAT.md).
            paid = 1 if (p.get("productType") or {}).get("productType") == "ACTIVITIES" else 0
            price = product_price(p)
            for o in p.get("offering") or []:
                d, t = o.get("offeringDate"), o.get("offeringTime")
                if not d or len(d) != 8:
                    continue
                date = f"{d[0:4]}-{d[4:6]}-{d[6:8]}"
                time_ = f"{t[0:2]}:{t[2:4]}" if t and len(t) == 4 and t != "0000" else None  # 00:00 = untimed
                key = (title, date, time_, venue)
                if key in seen:
                    continue
                seen.add(key)
                events.append([title, venue, cat, date, time_, int(o.get("offeringDurationInMinutes") or minutes),
                               1 if (p.get("isFeatured") or o.get("isFeatured")) else 0,
                               1 if p.get("isReservationRequired") else 0, paid, price])
        if len(products) < PAGE:
            break
    events.sort(key=lambda e: (e[3], e[4] or "", e[0]))
    return {"published": bool(events), "cats": cats, "venues": venues,
            "fields": ["title", "venue", "cat", "date", "time", "minutes", "featured", "reservation", "paid",
                       "price"],
            "events": events}


# ---------------------------------------------------------------- logged-in data

def login(sess, email: str, password: str) -> dict:
    body = "grant_type=password&username={}&password={}&scope=openid+profile+email+vdsid".format(
        _quote(email), _quote(password))
    r = sess.post(LOGIN_URL, data=body, timeout=TIMEOUT, headers={
        "Content-Type": "application/x-www-form-urlencoded", "Authorization": LOGIN_CLIENT, "User-Agent": USER_AGENT})
    if r.status_code != 200:
        raise SyncError(f"Login failed (error {r.status_code}). Check your email and password.")
    token = r.json().get("access_token") or ""
    try:
        part = token.split(".")[1]
        account_id = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))["sub"]
    except Exception:
        raise SyncError("Logged in, but could not read the login token. Royal may have changed their login.")
    return {"Access-Token": token, "account-id": account_id, "vds-id": account_id}


def _quote(value: str) -> str:
    from urllib.parse import quote
    return quote(value, safe="")


def fetch_mine(sess, auth: dict, code: str, date8: str) -> dict:
    """Stateroom and purchased add-ons for the matching booking (experimental)."""
    res = get_json(sess, "GET", f"{API}/v1/profileBookings/enriched/{auth['account-id']}",
                   params={"brand": "R", "includeCheckin": "true"}, headers=auth)
    bookings = (res.get("payload") or {}).get("profileBookings") or []
    match = [b for b in bookings if b.get("shipCode") == code and str(b.get("sailDate", "")).replace("-", "") == date8]
    if not match:
        raise SyncError("Logged in, but found no booking on your account for that ship and date.")
    b = match[0]
    # Guarantee bookings list "GTY" until a cabin is assigned; a real one has digits.
    room = str(b.get("stateroomNumber") or "")
    mine = {"stateroom": room if re.search(r"[0-9]", room) else None, "orders": []}
    params = {"passengerId": b.get("passengerId"), "reservationId": b.get("bookingId"),
              "sailingId": code + date8, "includeMedia": "false"}
    base = f"{API}/en/royal/web/commerce-api/calendar/v1/{code}/orderHistory"
    try:
        history = get_json(sess, "GET", base, params=params, headers=auth).get("payload") or {}
    except SyncError as e:
        mine["ordersError"] = str(e)
        return mine
    for order in (history.get("myOrders") or []) + (history.get("ordersOthersHaveBookedForMe") or []):
        code_ = order.get("orderCode")
        if not code_:
            continue
        try:
            detail = get_json(sess, "GET", f"{base}/{code_}", params=params, headers=auth).get("payload") or {}
        except SyncError:
            continue
        for item in detail.get("orderHistoryDetailItems") or []:
            summary = item.get("productSummary") or {}
            guests = [g for g in item.get("guests") or [] if g.get("orderStatus") != "CANCELLED"]
            if not guests:
                continue
            entry = {"title": clean(summary.get("title")),
                     "category": (summary.get("productTypeCategory") or {}).get("id", ""),
                     "guests": len(guests)}
            # Times for excursions/dining are not confirmed in this data; keep any date/time
            # fields found so the app (and we) can see what is actually there.
            when = {k: v for src in (item, summary) for k, v in src.items()
                    if isinstance(v, str) and re.search(r"(date|time)", k, re.I)}
            if when:
                entry["when"] = when
            mine["orders"].append(entry)
    return mine


# ---------------------------------------------------------------- output

def copy_to_clipboard(path: Path) -> bool:
    if os.name != "nt":
        return False
    cmd = ["powershell", "-NoProfile", "-Command",
           f"Get-Content -Raw -Encoding UTF8 -LiteralPath '{str(path).replace(chr(39), chr(39) * 2)}' | Set-Clipboard"]
    try:
        return subprocess.run(cmd, capture_output=True, timeout=30).returncode == 0
    except Exception:
        return False


def ask(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except EOFError:
        raise SyncError("No input given.")


def pick_date(sess, ship: dict) -> str:
    today = dt.date.today().strftime("%Y%m%d")
    upcoming = [d for d in list_sailings(sess, ship["shipCode"]) if d >= today][:12]
    if not upcoming:
        raise SyncError(f"No upcoming sailings found for {ship['name']}.")
    print(f"\nUpcoming sailings for {ship['name']}:")
    for i, d in enumerate(upcoming, 1):
        print(f"  {i:2}. {dt.datetime.strptime(d, '%Y%m%d').strftime('%a %b %d, %Y')}")
    choice = ask("Pick a number (or type a date YYYY-MM-DD): ")
    if choice.isdigit() and 1 <= int(choice) <= len(upcoming):
        return upcoming[int(choice) - 1]
    return normalize_date(choice)


def normalize_date(text: str) -> str:
    try:
        return dt.datetime.strptime(text.strip(), "%Y-%m-%d").strftime("%Y%m%d")
    except ValueError:
        raise SyncError(f"'{text}' is not a date like 2027-03-06.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Download cruise data for the Royal Pebble app.")
    ap.add_argument("--ship", help="ship name or code, e.g. harmony or HM")
    ap.add_argument("--date", help="sail date, YYYY-MM-DD")
    ap.add_argument("--login", action="store_true", help="also fetch your stateroom and purchases (asks for password)")
    ap.add_argument("--email", help="Royal Caribbean login email (or set RCCL_EMAIL)")
    ap.add_argument("--out-dir", default=".", help="folder for the output file (default: current folder)")
    ap.add_argument("--no-clipboard", action="store_true", help="don't copy the result to the clipboard")
    args = ap.parse_args(argv)

    sess = new_session()
    ship = find_ship(sess, args.ship or ask("Ship name (e.g. Harmony): "))
    date8 = normalize_date(args.date) if args.date else pick_date(sess, ship)
    pretty = dt.datetime.strptime(date8, "%Y%m%d").strftime("%a %b %d, %Y")
    print(f"\nFetching {ship['name']}, sailing {pretty}...")

    if date8 not in list_sailings(sess, ship["shipCode"]):
        raise SyncError(f"{ship['name']} has no sailing on {pretty}.")
    itinerary = fetch_itinerary(sess, ship["shipCode"], date8)
    print(f"  Itinerary: {len(itinerary)} days")
    schedule = fetch_schedule(sess, ship["shipCode"], date8)
    if schedule["published"]:
        print(f"  Activity schedule: {len(schedule['events'])} events")
    else:
        print("  Activity schedule: not published yet (usually about two weeks before sailing)")

    bundle = {"format": FORMAT_NAME, "v": FORMAT_VERSION,
              "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
              "ship": {"code": ship["shipCode"], "name": ship["name"]},
              "sailDate": f"{date8[0:4]}-{date8[4:6]}-{date8[6:8]}",
              "itinerary": itinerary, "schedule": schedule}

    if args.login:
        email = args.email or os.environ.get("RCCL_EMAIL") or ask("Royal Caribbean email: ")
        password = os.environ.get("RCCL_PASSWORD") or getpass.getpass("Password (hidden, not saved): ")
        auth = login(sess, email, password)
        password = None
        mine = fetch_mine(sess, auth, ship["shipCode"], date8)
        bundle["mine"] = mine
        print(f"  Your booking: stateroom {mine.get('stateroom') or 'not assigned yet'}, {len(mine['orders'])} purchased items")
        if mine.get("ordersError"):
            print(f"  Purchases skipped: {mine['ordersError']}")

    out = Path(args.out_dir) / f"cruise-watch-{ship['shipCode']}-{date8}.json"
    text = json.dumps(bundle, separators=(",", ":"), ensure_ascii=True)
    out.write_text(text, encoding="utf-8")
    print(f"\nSaved {out.resolve()} ({len(text) / 1024:.0f} KB)")
    if "mine" in bundle:
        print("  Note: this file includes your stateroom. Don't post it publicly.")
    if not args.no_clipboard and copy_to_clipboard(out.resolve()):
        print("Copied to the clipboard. Get it to your phone (email, a notes app, etc.) and paste it into")
    else:
        print("Open the file, copy all of its text, get it to your phone and paste it into")
    print("Royal Pebble settings > Cruise > Backup: paste cruise data.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SyncError as e:
        print(f"\nError: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(1)
