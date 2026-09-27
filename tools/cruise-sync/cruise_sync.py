#!/usr/bin/env python3
"""
Royal Pebble sync tool (backup data path).

Downloads a Royal Caribbean sailing's itinerary and activity schedule and
writes them as one compact JSON bundle for the Royal Pebble phone settings
page ("Backup: paste cruise data"). Optionally logs in to your Royal
Caribbean account to add your stateroom, deck, muster station, purchased add-ons
(with the booked times of excursions and other timed bookings) and per-port
gangway times and locations.

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
COMMERCE = f"{API}/en/royal/web/commerce-api"
APPKEY = "hyNNqIPHHzaLzVpcICPdAdbFV8yvTsAm"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0"
LOGIN_URL = "https://www.royalcaribbean.com/auth/oauth2/access_token"
LOGIN_CLIENT = ("Basic ZzlTMDIzdDc0NDczWlVrOTA5Rk42OEYwYjRONjdQU09oOTJvMDR2TDBCUjY1MzdwSTJ5Mmg5NE02QmJVN0Q2SjpX"
                "NjY4NDZrUFF2MTc1MDk3NW9vZEg1TTh6QzZUYTdtMzBrSDJRNzhsMldtVTUwRkNncXBQMTN3NzczNzdrN0lC")
TIMEOUT = 30
PAGE = 200
# Largest bundle pasted into the settings page on a real phone (Android,
# docs/PHASE4_PLAN.md "Paste-in size"); all arrived whole.
PASTE_TESTED = 1024 * 1024
# Product types kept for the schedule (docs/DATA_FORMAT.md): the free activities,
# plus the shows you reserve (ENTERTAINMENT), the paid classes and experiences
# (ACTIVITIES), which come through with "reservation" set, and the shore
# excursions (SHOREX, paid). Spa and dining are booking slots, not events.
# Everything from here to fetch_schedule: keep in step with src/pkjs/royal.js.
SCHEDULE_TYPES = ("NON_REVENUE_SCHEDULABLE", "ENTERTAINMENT", "ACTIVITIES", "SHOREX")
PAID_TYPES = ("ACTIVITIES", "SHOREX")
EXCURSION_CAT = ["Shore excursions", ""]
# Left out by title: NextCruise sales appointments (about 22 slots a day) would
# push busy days past the watch's 160 events.
SKIP_TITLES = re.compile(r"nextcruise", re.I)
# Event details (docs/DATA_FORMAT.md, docs/PHASE4_PLAN.md items 2-7).
# Notes left out: boilerplate, the fee (already `paid`) and long legal text.
NOTE_SKIP = re.compile(r"(images are illustrative|this activity has a fee|fee applies)", re.I)
NOTE_MAX = 120
EARLY_MAX = 120   # arrive-early minutes from lead time or advisement text
MEET_MAX = 240    # a shore excursion's meeting time before its start
# Arrive-by wordings with a number. "Doors open 45 minutes prior" and "seats
# released 10 minutes prior" are facts, not arrive-by times, so they stay notes.
EARLY_TEXT = (re.compile(r"\barrive (\d+) minutes? early\b", re.I),
              re.compile(r"\bsign up (?:at the venue )?(\d+) minutes? before\b", re.I))
# Words a short description may add and still only restate the title.
SHORT_FILLER = {"a", "an", "and", "at", "by", "competition", "for", "game", "in", "of", "on", "seminar", "show",
                "the", "to", "with", "your"}


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


def restriction_age(text):
    """Royal's age restriction wording -> [min, max] years, or None when it isn't
    a limit ("Guests 16 and under must be accompanied" is a note)."""
    s = clean(text).lower()
    m = re.fullmatch(r"minimum (\d+) years? old", s)
    if m:
        return [int(m.group(1)), None]
    m = re.fullmatch(r"maximum (\d+) years? old", s)
    if m:
        return [None, int(m.group(1))]
    m = re.fullmatch(r"(\d+) to (\d+) years? old", s)
    return [int(m.group(1)), int(m.group(2))] if m else None


def text_age(text):
    """Age patterns in a title or venue name: (18+), (13-17), (Ages 13-17),
    (17 & Under), Adults-Only."""
    s = clean(text).lower()
    m = re.search(r"\((?:ages )?(\d+)\s*-\s*(\d+)\)", s)
    if m:
        return [int(m.group(1)), int(m.group(2))]
    m = re.search(r"\((\d+)\+\)", s)
    if m:
        return [int(m.group(1)), None]
    m = re.search(r"\((\d+) & under\)", s)
    if m:
        return [None, int(m.group(1))]
    return [18, None] if re.search(r"\badults?[- ]only\b", s) else None


def age_of(p: dict, title: str, venue: str):
    """[min, max] years (either may be None) or None. From Royal's age
    restrictions, its age experiences (ages/age18), then title and venue
    patterns; if several apply, the tightest wins."""
    found = [restriction_age(r.get("restrictionDisplayText")) for r in p.get("restrictions") or []
             if r.get("restrictionType") == "age"]
    for e in p.get("experiences") or []:
        m = re.fullmatch(r"ages/age(\d+)", e.get("experienceID") or "")
        if m:
            found.append([int(m.group(1)), None])
    found += [text_age(title), text_age(venue)]
    lows = [a[0] for a in found if a and a[0] is not None]
    highs = [a[1] for a in found if a and a[1] is not None]
    if not lows and not highs:
        return None
    return [max(lows) if lows else None, min(highs) if highs else None]


def clock_minutes(hhmm4):
    """'0745' -> 465, or None."""
    if not hhmm4 or not re.fullmatch(r"\d{4}", hhmm4):
        return None
    return int(hhmm4[0:2]) * 60 + int(hhmm4[2:4])


def early_of(p: dict, o: dict):
    """Minutes to arrive before an offering's start, or None. A shore excursion
    uses its meeting time; others Royal's lead time, then a number in an
    advisement."""
    start = clock_minutes(o.get("offeringTime"))
    if not start:  # untimed (00:00) or missing
        return None
    if (p.get("productType") or {}).get("productType") == "SHOREX":
        meet = clock_minutes(o.get("meetingTime"))
        return min(start - meet, MEET_MAX) if meet is not None and meet < start else None
    lead = (p.get("productDuration") or {}).get("leadTimeInMinutes")
    if isinstance(lead, (int, float)) and not isinstance(lead, bool) and lead == int(lead) and lead > 0:
        return min(int(lead), EARLY_MAX)
    for a in p.get("advisements") or []:
        for pattern in EARLY_TEXT:
            m = pattern.search(clean(a.get("advisementTitle")))
            if m and int(m.group(1)) > 0:
                return min(int(m.group(1)), EARLY_MAX)
    return None


def _words(text):
    return {w[:-1] if len(w) > 3 and w.endswith("s") else w for w in re.findall(r"[a-z0-9]+", text.lower())}


def says_more(short: str, title: str) -> bool:
    """A short description worth keeping: after lowercasing and dropping
    punctuation it has a word (beyond filler like "Seminar:") or a parenthesis
    that the title lacks."""
    return bool(_words(short) - _words(title) - SHORT_FILLER) or ("(" in short and "(" not in title)


def notes_of(p: dict, title: str) -> list:
    """[id, text] notes for a product: a short description that says more than
    the title, restrictions that aren't age limits, advisements and the waiver
    flag. Boilerplate, long text and repeated text are left out."""
    out = []

    def add(id_, text):
        text = clean(text)
        if text and len(text) <= NOTE_MAX and not NOTE_SKIP.match(text) \
                and all(t.lower() != text.lower() for _, t in out):
            out.append([clean(id_), text])

    short = clean(p.get("productShortDescription"))
    if short and says_more(short, title):
        add("short", short)
    for r in p.get("restrictions") or []:
        if r.get("restrictionType") != "age" or restriction_age(r.get("restrictionDisplayText")) is None:
            add(r.get("restrictionID"), r.get("restrictionDisplayText"))
    for a in p.get("advisements") or []:
        add(a.get("advisementID"), a.get("advisementTitle"))
    if p.get("isWaiverRequired") and not any(re.search(r"waiver|disclaimer", t, re.I) for _, t in out):
        add("waiver", "Signed waiver required")
    return out


def new_schedule_acc() -> dict:
    return {"cats": [], "venues": [], "notes": [], "infos": [], "events": [], "seen": set()}


def _index(table, value):
    if value not in table:
        table.append(value)
    return table.index(value)


def add_products(acc: dict, products: list) -> None:
    """Adds one page of Royal's products to `acc` (new_schedule_acc)."""
    for p in products:
        kind = (p.get("productType") or {}).get("productType")
        if kind not in SCHEDULE_TYPES or SKIP_TITLES.search(p.get("productTitle") or ""):
            continue
        parent, child = "Other", ""
        pcs = p.get("productCategory") or []
        if kind == "SHOREX":
            parent, child = EXCURSION_CAT
        elif pcs:
            parent = clean(pcs[0].get("categoryName")).capitalize() or "Other"
            kids = pcs[0].get("childCategory") or []
            if kids:
                items = kids[0].get("items")
                items = items[0] if isinstance(items, list) and items else items
                child = clean((items or {}).get("categoryName"))
        cat = _index(acc["cats"], [parent, child])
        loc = p.get("productLocation") or {}
        venue_name = clean(loc.get("locationTitle"))
        # By name and code, so a blank title with a code (VINT) is its own venue.
        venue = _index(acc["venues"], [venue_name, loc.get("locationCode") or None])
        title = clean(p.get("productTitle"))
        minutes = (p.get("productDuration") or {}).get("durationInMinutes") or 0
        # Paid classes, experiences and shore excursions: only the sessions the
        # owner picks on the settings page reach the watch (docs/DATA_FORMAT.md).
        paid = 1 if kind in PAID_TYPES else 0
        price = product_price(p)
        age = age_of(p, title, venue_name)
        notes = [_index(acc["notes"], n) for n in notes_of(p, title)]
        pid = clean(p.get("productID")) or None
        for o in p.get("offering") or []:
            d, t = o.get("offeringDate"), o.get("offeringTime")
            if not d or len(d) != 8:
                continue
            date = f"{d[0:4]}-{d[4:6]}-{d[6:8]}"
            time_ = f"{t[0:2]}:{t[2:4]}" if t and len(t) == 4 and t != "0000" else None  # 00:00 = untimed
            key = (title, date, time_, venue)
            if key in acc["seen"]:
                continue
            acc["seen"].add(key)
            early = early_of(p, o)
            info = _index(acc["infos"], [age, early, notes]) if age or early is not None or notes else None
            acc["events"].append([title, venue, cat, date, time_,
                                  int(o.get("offeringDurationInMinutes") or minutes),
                                  1 if (p.get("isFeatured") or o.get("isFeatured")) else 0,
                                  1 if p.get("isReservationRequired") else 0, paid, price, info, pid])


def finish_schedule(acc: dict) -> dict:
    events = sorted(acc["events"], key=lambda e: (e[3], e[4] or "", e[0]))
    return {"published": bool(events), "cats": acc["cats"],
            "venues": [v[0] for v in acc["venues"]], "venueCodes": [v[1] for v in acc["venues"]],
            "notes": acc["notes"], "infos": acc["infos"],
            "fields": ["title", "venue", "cat", "date", "time", "minutes", "featured", "reservation", "paid",
                       "price", "info", "pid"],
            "events": events}


def schedule_summary(schedule: dict) -> str:
    """'212 events (53 shore excursion sessions): 23 with age limits, 8 arrive
    early, 95 with notes'."""
    f = {name: i for i, name in enumerate(schedule["fields"])}
    events, infos = schedule["events"], schedule.get("infos") or []
    excursion = [i for i, c in enumerate(schedule["cats"]) if c == EXCURSION_CAT]
    rows = [infos[e[f["info"]]] for e in events if e[f["info"]] is not None]
    return (f"{len(events)} events ({sum(e[f['cat']] in excursion for e in events)} shore excursion sessions): "
            f"{sum(1 for r in rows if r[0])} with age limits, {sum(1 for r in rows if r[1] is not None)} arrive early, "
            f"{sum(1 for r in rows if r[2])} with notes")


def fetch_schedule(sess, code: str, date8: str) -> dict:
    acc = new_schedule_acc()
    for offset in range(0, 20000, PAGE):
        payload = get_json(sess, "GET", f"{API}/en/royal/web/v3/products",
                           params={"sailingID": code + date8, "limit": str(PAGE), "offset": str(offset)}).get("payload") or {}
        products = payload.get("products") or []
        add_products(acc, products)
        if len(products) < PAGE:
            break
    return finish_schedule(acc)


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


def hhmm(text):
    """Royal's many time spellings -> 'HH:MM' (24h), or None when it isn't one.
    Handles '2027-03-09T07:00:00', '20270309T070000', '7:00 AM', '17:30' and '1730'."""
    s = clean(text)
    if not s:
        return None
    m = re.search(r"\d{4}-?\d{2}-?\d{2}[T ](\d{2}):?(\d{2})", s)
    if not m:
        m = re.fullmatch(r"(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?(\s.*)?", s)
        if m:
            h = int(m.group(1)) % 12 + (12 if m.group(3).lower() == "p" else 0)
            return f"{h:02d}:{m.group(2)}" if int(m.group(2)) < 60 else None
        m = re.fullmatch(r"(\d{1,2}):(\d{2})(?::\d{2})?(\s.*)?", s) or re.fullmatch(r"(\d{2})(\d{2})", s)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    return f"{h:02d}:{mi:02d}" if h < 24 and mi < 60 else None


def iso_parts(text):
    """'2027-03-09T07:00:00' -> ('2027-03-09', '07:00'); (None, None) when unreadable."""
    m = re.match(r"(\d{4})-?(\d{2})-?(\d{2})[T ](\d{2}):?(\d{2})", str(text or ""))
    if not m:
        return None, None
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", f"{m.group(4)}:{m.group(5)}"


def or_none(value):
    v = clean(value)
    return v or None


def fetch_voyage(sess, auth: dict, code: str, date8: str) -> dict:
    """Logged-in extras for the sailing: gangway times and approximate coordinates
    per port day, and the embarkation port's time zone. Formats of the gangway
    times and the coordinates' exact spot are unverified (docs/ROYAL_LOGIN_DATA.md)."""
    payload = get_json(sess, "GET", f"{API}/en/royal/web/v3/ships/voyages/{code}{date8}/enriched",
                       headers=auth).get("payload") or {}
    info = payload.get("sailingInfo")
    info = info[0] if isinstance(info, list) and info else info or {}
    ports = []
    for p in ((info.get("itinerary") or {}).get("portInfo")) or []:
        entry = {"day": p.get("day"), "code": p.get("portCode")}
        for key in ("gangwayDown", "gangwayUp"):
            raw = clean(p.get(key))
            if raw:
                # HH:MM when readable, otherwise Royal's text as-is (format not yet seen)
                entry[key] = hhmm(raw) or raw
        for poi in p.get("pointsOfInterest") or []:
            lat, lon = poi.get("latitude"), poi.get("longitude")
            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and (lat or lon):
                entry["lat"], entry["lon"] = round(float(lat), 4), round(float(lon), 4)
                break
        if len(entry) > 2:
            ports.append(entry)
    tz = (info.get("departurePortInformation") or {}).get("timeZoneName")
    return {"ports": ports, "embarkTimeZone": or_none(tz)}


def offering_times(sess, auth: dict, code: str, date8: str, booking: dict, summary: dict, offering: dict) -> dict:
    """Meeting time, end time and length of a booked, timed product, from its catalog
    page. Empty when the page has no offering matching the booked one."""
    prefix = (summary.get("productTypeCategory") or {}).get("id")
    opts = summary.get("baseOptions") or []
    product = ((opts[0] if opts else {}).get("selected") or {}).get("code")
    if not prefix or not product:
        return {}
    detail = get_json(sess, "GET", f"{COMMERCE}/catalog/v2/{code}/categories/{prefix}/products/{product}",
                      params={"reservationId": booking.get("bookingId"), "passengerId": booking.get("passengerId"),
                              "currencyIso": booking.get("bookingCurrency") or "USD",
                              "startDate": f"{date8[0:4]}-{date8[4:6]}-{date8[6:8]}"},
                      headers=auth).get("payload") or {}
    offers = (detail.get("bookingOfferingData") or {}).get("offerings") or []
    match = [o for o in offers if o.get("id") and o.get("id") == offering.get("id")] or \
            [o for o in offers if o.get("dateTime") and o.get("dateTime") == offering.get("dateTime")]
    out = {}
    if match:
        date = iso_parts(offering.get("dateTime"))[0]
        for key, name in (("meetingTime", "meet"), ("endDateTime", "end")):
            d, t = iso_parts(match[0].get(key))
            if t and d == date:
                out[name] = t
    minutes = detail.get("durationInMins")
    if isinstance(minutes, int) and not isinstance(minutes, bool) and minutes > 0:
        out["minutes"] = minutes
    return out


def fetch_mine(sess, auth: dict, code: str, date8: str) -> dict:
    """Stateroom, cabin details and purchased add-ons for the matching booking
    (docs/DATA_FORMAT.md, mine). Parts that fail are skipped with a note."""
    res = get_json(sess, "GET", f"{API}/v1/profileBookings/enriched/{auth['account-id']}",
                   params={"brand": "R", "includeCheckin": "true"}, headers=auth)
    bookings = (res.get("payload") or {}).get("profileBookings") or []
    match = [b for b in bookings if b.get("shipCode") == code and str(b.get("sailDate", "")).replace("-", "") == date8]
    if not match:
        raise SyncError("Logged in, but found no booking on your account for that ship and date.")
    b = match[0]
    # Guarantee bookings list "GTY" until a cabin is assigned; a real one has digits.
    room = str(b.get("stateroomNumber") or "")
    me = [p for p in b.get("passengers") or [] if str(p.get("passengerId")) == str(b.get("passengerId"))]
    mine = {"stateroom": room if re.search(r"[0-9]", room) else None,
            "deck": or_none(b.get("deckNumber")),
            "muster": or_none(b.get("musterStation")),
            # Terminal arrival appointment, empty until online check-in is done
            "arrival": (hhmm(me[0].get("arrivalTime")) or or_none(me[0].get("arrivalTime"))) if me else None,
            "orders": []}

    try:
        mine.update(fetch_voyage(sess, auth, code, date8))
    except SyncError as e:
        mine["voyageError"] = str(e)

    params = {"passengerId": b.get("passengerId"), "reservationId": b.get("bookingId"),
              "sailingId": code + date8, "includeMedia": "false"}
    base = f"{COMMERCE}/calendar/v1/{code}/orderHistory"
    try:
        history = get_json(sess, "GET", base, params=params, headers=auth).get("payload") or {}
    except SyncError as e:
        mine["ordersError"] = str(e)
        return mine
    for order in (history.get("myOrders") or []) + (history.get("ordersOthersHaveBookedForMe") or []):
        code_ = order.get("orderCode")
        if not code_ or order.get("status") == "CANCELLED":
            continue
        try:
            detail = get_json(sess, "GET", f"{base}/{code_}", params=params, headers=auth).get("payload") or {}
        except SyncError:
            continue
        for item in detail.get("orderHistoryDetailItems") or []:
            summary = item.get("productSummary") or {}
            guests = [g for g in item.get("guests") or [] if g.get("orderStatus") != "CANCELLED"]
            if not guests or item.get("status") == "CANCELLED":
                continue
            entry = {"title": clean(summary.get("title")),
                     "category": (summary.get("productTypeCategory") or {}).get("id", ""),
                     "guests": len(guests)}
            # Timed bookings (shore excursions, and probably dining and shows) carry the
            # booked session; packages and credits don't.
            offering = item.get("offering") or {}
            date, time_ = iso_parts(offering.get("dateTime"))
            if date:
                entry.update(date=date, time=time_)
                if isinstance(offering.get("dayOfCruise"), int):
                    entry["day"] = offering["dayOfCruise"]
                if offering.get("portCode"):
                    entry["port"] = offering["portCode"]
                try:
                    entry.update(offering_times(sess, auth, code, date8, b, summary, offering))
                except SyncError:
                    pass
            mine["orders"].append(entry)
    mine["orders"].sort(key=lambda o: (o.get("date") or "9999", o.get("time") or "", o["title"]))
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
    ap.add_argument("--login", action="store_true", help="also fetch your booking details and purchases (asks for password)")
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
        print(f"  Activity schedule: {schedule_summary(schedule)}")
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
        timed = sum(1 for o in mine["orders"] if o.get("time"))
        print(f"  Your booking: stateroom {mine.get('stateroom') or 'not assigned yet'}"
              f", deck {mine.get('deck') or '-'}, muster station {mine.get('muster') or 'not listed'}")
        print(f"  Purchased items: {len(mine['orders'])} ({timed} with a booked time)")
        if mine.get("ports"):
            print(f"  Port details (gangway times, locations): {len(mine['ports'])} days")
        for key, what in (("voyageError", "Port details"), ("ordersError", "Purchases")):
            if mine.get(key):
                print(f"  {what} skipped: {mine[key]}")

    out = Path(args.out_dir) / f"cruise-watch-{ship['shipCode']}-{date8}.json"
    text = json.dumps(bundle, separators=(",", ":"), ensure_ascii=True)
    out.write_text(text, encoding="utf-8")
    print(f"\nSaved {out.resolve()} ({len(text) / 1024:.0f} KB)")
    if len(text) > PASTE_TESTED:
        print("  Note: this is larger than any paste tested on a phone (1 MB). If pasting fails, "
              "use the phone app's Download instead.")
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
