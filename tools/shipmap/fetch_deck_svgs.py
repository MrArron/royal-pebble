#!/usr/bin/env python3
"""Download a ship's deck-plan SVGs from royalcaribbean.com.

Usage: python fetch_deck_svgs.py <ship-slug> <profile> <out_dir>
  e.g. python tools/shipmap/fetch_deck_svgs.py harmony-of-the-seas 2396 tools/shipmap/decks/HM
The profile is the sail-date range picked on the deck plans page (it's in the
page URL as ?profile=...). Files are saved as deck-<number>.svg.
"""
import os, re, sys, urllib.request

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36'
SITE = 'https://www.royalcaribbean.com'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8', 'replace')


def main():
    slug, profile, out = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)
    page = get('%s/cruise-ships/%s/deck-plans?profile=%s' % (SITE, slug, profile))
    codes = re.findall(r'\\"code\\":\\"(\d\d)\\",\\"name\\":\\"Deck \d+', page)
    if not codes:
        sys.exit('No deck list found on the page; Royal may have changed the page.')
    for code in codes:
        p = get('%s/cruise-ships/%s/deck-plans?profile=%s&deck=%s' % (SITE, slug, profile, code))
        m = re.search(r'deckImage\\":\\"([^\\"]+\.svg)', p)
        if not m:
            print('deck %s: no SVG found, skipped' % code)
            continue
        svg = get(SITE + m.group(1))
        path = os.path.join(out, 'deck-%d.svg' % int(code))
        open(path, 'w', encoding='utf-8').write(svg)
        print('deck %d: %s' % (int(code), m.group(1)))


if __name__ == '__main__':
    main()
