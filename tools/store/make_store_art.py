#!/usr/bin/env python3
"""Draft app store art for Royal Pebble: icons and a banner.

Writes store/art/icon-80.png, store/art/icon-144.png and
store/art/banner-720x320.png (sizes from the Pebble appstore's
"Preparing a Submission" guide). The design is original: a pebble-shaped
stone with a ship's wake across it, on deep sea blue. It deliberately uses no
Royal Caribbean or Pebble logo, crown, anchor or brand typeface, so the art
can't be mistaken for an official app.

These are drafts for the owner to accept or replace (docs/STORE_READINESS.md).

Needs Pillow. Run: python3 tools/store/make_store_art.py
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "store", "art")

SEA = (11, 37, 69)         # deep sea blue background
SEA_LIGHT = (19, 64, 116)  # banner gradient end
STONE = (238, 242, 246)    # the pebble
WAKE = (0, 170, 200)       # the wake across it
SUN = (255, 196, 61)       # small sun accent
SS = 4                     # supersampling for smooth edges

FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def font(size):
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    sys.exit("No bold TrueType font found; edit FONT_PATHS.")


def draw_mark(d, cx, cy, r):
    """The pebble with a wake, centered at (cx, cy), about 2r wide."""
    # Pebble: a slightly flattened, tilted ellipse.
    d.ellipse([cx - r, cy - r * 0.78, cx + r, cy + r * 0.78], fill=STONE)
    # Wake: two curved strokes across the lower half.
    w = max(2, int(r * 0.13))
    for i, dy in enumerate((-0.05, 0.22)):
        y = cy + r * dy
        box = [cx - r * 0.78, y - r * 0.30, cx + r * 0.78, y + r * 0.30]
        d.arc(box, start=25, end=155, fill=WAKE if i == 0 else SEA_LIGHT, width=w)
    # Sun above the wake.
    s = r * 0.17
    d.ellipse([cx + r * 0.22 - s, cy - r * 0.30 - s, cx + r * 0.22 + s, cy - r * 0.30 + s], fill=SUN)


def icon(size):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=SEA)
    draw_mark(d, big / 2, big / 2, big * 0.36)
    return img.resize((size, size), Image.LANCZOS)


def banner(w=720, h=320):
    bw, bh = w * SS, h * SS
    img = Image.new("RGB", (bw, bh), SEA)
    d = ImageDraw.Draw(img)
    for x in range(bw):  # left-to-right gradient
        t = x / bw
        c = tuple(int(SEA[i] + (SEA_LIGHT[i] - SEA[i]) * t) for i in range(3))
        d.line([(x, 0), (x, bh)], fill=c)
    draw_mark(d, bh * 0.42, bh / 2, bh * 0.26)
    x0, room = bh * 0.80, bw - bh * 0.80 - bh * 0.08
    lines = [("Royal Pebble", 0.15, STONE, 0.26),
             ("Your cruise on your wrist, offline at sea", 0.058, (190, 210, 228), 0.50),
             ("Free and open source. Unofficial.", 0.05, (150, 175, 200), 0.63)]
    for text, size, color, y in lines:
        f = font(int(bh * size))
        while d.textlength(text, font=f) > room:  # shrink to fit the banner
            f = font(f.size - 4)
        d.text((x0, bh * y), text, font=f, fill=color)
    return img.resize((w, h), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    icon(80).save(os.path.join(OUT, "icon-80.png"))
    icon(144).save(os.path.join(OUT, "icon-144.png"))
    banner().save(os.path.join(OUT, "banner-720x320.png"))
    print("Wrote icon-80.png, icon-144.png, banner-720x320.png to", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
