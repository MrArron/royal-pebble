#!/usr/bin/env python3
"""Icon concepts for Royal Pebble (for the owner to pick from; D2 in
docs/STORE_READINESS.md).

Writes store/concepts/:
  a-watch-hull-ship-{144,80}.png   A cruise ship whose hull is a Pebble Time 2
                                   lying on its side: the screen is the row of
                                   windows, the watch's side buttons sit on
                                   deck, the strap ends form the bow and stern.
  b-ship-wave-watch-{144,80}.png   The Android app's launcher icon (white ship,
                                   gold funnel, light-blue wave on navy,
                                   android/app/src/main/res/drawable/
                                   ic_launcher.xml) with the cabin block drawn
                                   as a Pebble Time 2.
  c-watch-showing-ship-{144,80}.png  A Pebble Time 2 seen from the front, its
                                   screen showing that ship on the wave.
  sheet.png                        All three, large and at store sizes.

Original drawings: no Royal Caribbean or Pebble logos or wordmarks. The watch
is drawn generically (rectangular case, one button left, three right), which
says "Pebble Time 2" without using the brand. Needs Pillow.

Run: python3 tools/store/make_icon_concepts.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "store", "concepts")

NAVY = (11, 61, 145)        # #0B3D91, the Android icon's background
NAVY_DARK = (7, 38, 92)
WHITE = (255, 255, 255)
GOLD = (242, 183, 5)        # #F2B705, the Android icon's funnel
WAVE = (79, 195, 247)       # #4FC3F7, the Android icon's wave
CASE = (40, 44, 52)         # watch case
CASE_EDGE = (95, 102, 115)
SCREEN = (16, 24, 36)
BUTTON = (150, 158, 170)
SS = 8                      # supersampling


def canvas(size):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img), big


def tile(d, big, color=NAVY):
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=color)


def wave(d, big, y, amp, color, thick):
    """A row of soft humps across the icon, like the Android icon's wave."""
    n = 4
    w = big / n
    for i in range(n + 1):
        x0 = i * w - w / 2
        d.arc([x0, y - amp, x0 + w, y + amp], start=200, end=340, fill=color, width=int(thick))


def finish(img, size):
    return img.resize((size, size), Image.LANCZOS)


# --- Concept A: the hull is a Pebble Time 2 on its side --------------------
def concept_a(size=144):
    img, d, B = canvas(size)
    tile(d, B)
    u = B / 100.0
    # Superstructure decks (white), funnel (gold).
    d.rounded_rectangle([34 * u, 34 * u, 70 * u, 44 * u], radius=2 * u, fill=WHITE)
    d.rounded_rectangle([40 * u, 26 * u, 64 * u, 35 * u], radius=2 * u, fill=WHITE)
    d.polygon([(55 * u, 14 * u), (63 * u, 14 * u), (62 * u, 27 * u), (54 * u, 27 * u)], fill=GOLD)
    for x in range(42, 63, 5):  # bridge windows
        d.rectangle([x * u, 29 * u, (x + 2.5) * u, 32 * u], fill=NAVY)
    # Strap ends become bow (right, pointed) and stern (left, square).
    d.polygon([(76 * u, 46 * u), (92 * u, 46 * u), (80 * u, 66 * u), (76 * u, 66 * u)], fill=CASE)
    d.polygon([(12 * u, 46 * u), (24 * u, 46 * u), (24 * u, 66 * u), (16 * u, 66 * u)], fill=CASE)
    # The watch case lying on its side: buttons on the top edge (three) and
    # bottom edge (one), as the right and left sides of a Time 2 turned 90°.
    for x in (36, 46, 56):
        d.rounded_rectangle([x * u, 42.5 * u, (x + 7) * u, 46 * u], radius=1 * u, fill=BUTTON)
    d.rounded_rectangle([46 * u, 66 * u, 53 * u, 69.5 * u], radius=1 * u, fill=BUTTON)
    d.rounded_rectangle([22 * u, 45 * u, 78 * u, 67 * u], radius=5 * u, fill=CASE, outline=CASE_EDGE, width=int(1.2 * u))
    # Screen = a row of lit windows.
    d.rounded_rectangle([29 * u, 49 * u, 71 * u, 63 * u], radius=2 * u, fill=SCREEN)
    for x in range(32, 68, 6):
        d.rounded_rectangle([x * u, 53 * u, (x + 3.5) * u, 58.5 * u], radius=0.8 * u, fill=WAVE)
    # Sea.
    wave(d, B, 77 * u, 6 * u, WAVE, 3.2 * u)
    wave(d, B, 87 * u, 6 * u, (40, 120, 200), 3.2 * u)
    return img


# --- Concept B: the Android icon, cabin block as a Pebble Time 2 ------------
def concept_b(size=144):
    img, d, B = canvas(size)
    tile(d, B)
    u = B / 108.0  # same 108-unit grid as ic_launcher.xml
    # Hull, exactly as the Android icon: M30,58 h48 l-7,14 h-34 z
    d.polygon([(30 * u, 62 * u), (78 * u, 62 * u), (71 * u, 76 * u), (37 * u, 76 * u)], fill=WHITE)
    # Funnel (gold square in the original), now behind the watch.
    d.rectangle([60 * u, 24 * u, 67 * u, 34 * u], fill=GOLD)
    # Cabin block: a Pebble Time 2 standing on deck, screen facing out.
    d.rounded_rectangle([38.5 * u, 37 * u, 40.5 * u, 45 * u], radius=0.6 * u, fill=BUTTON)  # left button
    for y in (36, 44, 52):  # three right buttons
        d.rounded_rectangle([67.5 * u, y * u, 69.5 * u, (y + 5) * u], radius=0.6 * u, fill=BUTTON)
    d.rounded_rectangle([40 * u, 30 * u, 68 * u, 62 * u], radius=4 * u, fill=CASE, outline=CASE_EDGE, width=int(1 * u))
    d.rounded_rectangle([44 * u, 34 * u, 64 * u, 57 * u], radius=1.5 * u, fill=SCREEN)
    # Screen content: an all-aboard countdown bar and two text lines.
    d.rectangle([46 * u, 37 * u, 62 * u, 40 * u], fill=GOLD)
    d.rectangle([46 * u, 43 * u, 60 * u, 45.5 * u], fill=WHITE)
    d.rectangle([46 * u, 48 * u, 56 * u, 50.5 * u], fill=WAVE)
    # Wave, as the Android icon (light blue), a little lower.
    wave(d, B, 84 * u, 5 * u, WAVE, 4 * u)
    return img


# --- Concept C: the watch, its screen showing the ship ----------------------
def concept_c(size=144):
    img, d, B = canvas(size)
    tile(d, B)
    u = B / 100.0
    # Buttons, then the case (portrait, Time 2 proportions).
    d.rounded_rectangle([18 * u, 34 * u, 23 * u, 46 * u], radius=1 * u, fill=BUTTON)
    for y in (28, 44, 60):
        d.rounded_rectangle([77 * u, y * u, 82 * u, (y + 10) * u], radius=1 * u, fill=BUTTON)
    d.rounded_rectangle([21 * u, 12 * u, 79 * u, 88 * u], radius=9 * u, fill=CASE, outline=CASE_EDGE, width=int(1.5 * u))
    sx0, sy0, sx1, sy1 = 28 * u, 20 * u, 72 * u, 80 * u
    d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=2.5 * u, fill=NAVY_DARK)
    # The Android icon's ship and wave, inside the screen.
    cx, w = (sx0 + sx1) / 2, (sx1 - sx0)
    def sx(f):
        return sx0 + w * f
    d.polygon([(sx(0.14), 58 * u), (sx(0.86), 58 * u), (sx(0.74), 66 * u), (sx(0.26), 66 * u)], fill=WHITE)
    d.rectangle([sx(0.30), 50 * u, sx(0.70), 57 * u], fill=WHITE)
    d.rectangle([sx(0.44), 43 * u, sx(0.56), 49 * u], fill=GOLD)
    for i in range(3):
        x0 = sx0 + i * w / 3
        d.arc([x0 - 1 * u, 66 * u, x0 + w / 3 + 1 * u, 76 * u], start=200, end=340, fill=WAVE, width=int(2.4 * u))
    # Top bar on the watch screen: a thin time line, like the app's top bar.
    d.rectangle([sx(0.3), 24 * u, sx(0.7), 26.5 * u], fill=(190, 205, 225))
    return img


def label_font(px):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, px)
    return ImageFont.load_default()


def main():
    os.makedirs(OUT, exist_ok=True)
    concepts = [("a-watch-hull-ship", "A  Ship with a Time 2 hull", concept_a),
                ("b-ship-wave-watch", "B  App icon, watch cabin", concept_b),
                ("c-watch-showing-ship", "C  Watch showing the ship", concept_c)]
    sheet = Image.new("RGB", (3 * 300 + 40, 470), (245, 246, 248))
    sd = ImageDraw.Draw(sheet)
    for i, (name, label, fn) in enumerate(concepts):
        big = fn(144)
        for s in (144, 80):
            finish(big, s).save(os.path.join(OUT, "%s-%d.png" % (name, s)))
        x = 20 + i * 300
        large = finish(big, 256)
        sheet.paste(large, (x + 12, 20), large)
        for s, dx in ((144, 12), (80, 180)):
            small = Image.open(os.path.join(OUT, "%s-%d.png" % (name, s)))
            sheet.paste(small, (x + dx, 300), small)
        sd.text((x + 12, 440), label, font=label_font(17), fill=(30, 35, 45))
    sheet.save(os.path.join(OUT, "sheet.png"))
    print("Wrote", len(concepts), "concepts and sheet.png to", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
