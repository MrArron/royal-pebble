"""Generate Phase 2 (daily view) watch mockups as Claude Design .dc.html files.

Same format as docs/mockups/v1.1: 400x456 (2x), every style inline, Roboto
Condensed standing in for Gothic.
"""
import os

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "docs", "mockups", "phase2")
os.makedirs(OUT, exist_ok=True)

LIGHT = dict(name="light", bg="#FFFFFF", text="#000000", muted="#555555", divider="#AAAAAA",
             port="#AA5500", sea="#0055AA", cur_bg="#0055AA", cur_text="#FFFFFF", now="#005555")
DARK = dict(name="dark", bg="#000000", text="#FFFFFF", muted="#AAAAAA", divider="#555555",
            port="#FFAA00", sea="#00AAFF", cur_bg="#00AAFF", cur_text="#000000", now="#55FFAA")

BAND_PORT, BAND_SEA = "#005555", "#000055"

STAR = ('<svg width="{s}" height="{s}" viewBox="0 0 24 24" aria-hidden="true" style="flex-shrink: 0">'
        '<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6l-6.2 3.5 1.4-7L2 9.3l7-.8z" fill="{c}"></path></svg>')
ARROW_DOWN = ('<svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="3.2" '
              'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right: 2px">'
              '<path d="M6 1.5v17M1.5 13.5L6 18.5l4.5-5"></path></svg>')
CHECK = ('<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="3.4" '
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink: 0">'
         '<path d="M4 12l5 5 11-11"></path></svg>')


def bang(color, h=24):
    """Drawn '!' (new shape): digit cap height of the font beside it, bold-digit stroke."""
    return (f'<svg width="{h // 3}" height="{h}" viewBox="0 0 8 24" aria-hidden="true" style="flex-shrink: 0">'
            f'<rect x="1" y="0" width="6" height="15" rx="2" fill="{color}"></rect>'
            f'<rect x="1" y="18" width="6" height="6" rx="2" fill="{color}"></rect></svg>')


def page(title, body, width=400, height=456):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&amp;display=swap">
<style>
body{{margin:0}}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{width},"height":{height}}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    return {{}};
  }}
}}
</script>
</body>
</html>
"""


def frame(t, inner, extra=""):
    return (f'<div style="width: 400px; height: 456px; box-sizing: border-box; overflow: hidden; '
            f'background: {t["bg"]}; color: {t["text"]}; font-family: \'Roboto Condensed\', \'Arial Narrow\', '
            f'sans-serif; display: flex; flex-direction: column{extra}">\n{inner}</div>')


def top_bar(band, left, time, right=None):
    r = (f'\n<span style="color: #AAFFFF; font-size: 26px; font-weight: 700; font-variant: small-caps">{right}</span>'
         if right else "")
    return (f'<div style="height: 44px; flex-shrink: 0; background: {band}; display: flex; align-items: center; '
            f'justify-content: space-between; padding: 0 14px; position: relative">\n'
            f'<span style="position: absolute; left: 50%; transform: translateX(-50%); color: #FFFFFF; '
            f'font-size: 28px; font-weight: 700">{time}</span>\n'
            f'<span style="color: #FFFFFF; font-size: 28px; font-weight: 700">{left}</span>{r}\n</div>\n')


def body(lines):
    return ('<div style="padding: 6px 14px 0; display: flex; flex-direction: column; gap: 2px">\n'
            + "\n".join(lines) + "\n</div>\n")


# Font stand-ins (2x): Gothic 24 bold = 48, Gothic 18 bold = 34, Gothic 14 bold = 26,
# Gothic 28 bold = 56, Leco 42 numbers = 84.
def g24(text, color=None, extra=""):
    c = f" color: {color};" if color else ""
    return f'<div style="font-size: 48px; font-weight: 700; line-height: 50px;{c}{extra}">{text}</div>'


def g18(text, color=None, extra=""):
    c = f" color: {color};" if color else ""
    return f'<div style="font-size: 34px; line-height: 38px; font-weight: 700;{c}{extra}">{text}</div>'


def g14(text, color=None, extra=""):
    c = f" color: {color};" if color else ""
    return f'<div style="font-size: 26px; line-height: 30px; font-weight: 700;{c}{extra}">{text}</div>'


def caps(text, t):
    return g14(text, t["muted"], " letter-spacing: 0.5px;")


def divider(t):
    return f'<div style="height: 2px; background: {t["divider"]}; margin: 8px 0"></div>'


def star_line(t, text, size=34):
    lh = 38 if size == 34 else 30
    s = 26 if size == 34 else 22
    return (f'<div style="display: flex; align-items: center; gap: 8px; font-size: {size}px; line-height: {lh}px; '
            f'font-weight: 700">{STAR.format(s=s, c=t["sea"])}{text}</div>')


def write(name, title, html):
    with open(os.path.join(OUT, name + ".dc.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(page(title, html))


def both(fn, name, title):
    for t, suffix in ((LIGHT, "Light"), (DARK, "Dark")):
        write(name + suffix, f"{title}, {t['name']}", fn(t))


# ---------------------------------------------------------------- 8.1 summary
def summary_port(t):
    return frame(t, top_bar(BAND_PORT, "St. Thomas", "9:12a", "docked") + body([
        caps("DAY 4 · PORT DAY", t),
        g24("St. Thomas"),
        g18("Docked 7:30a - 5:30p"),
        g14("Port time +1 h", t["muted"]),
        g18("All aboard 5:00p", t["port"]),
        divider(t),
        star_line(t, "4 starred today"),
        g14("First 10:00a Zumba Class", t["muted"]),
        g14("1 clash", t["port"]),
    ]))


def summary_sea(t):
    return frame(t, top_bar(BAND_SEA, "At Sea", "8:05a") + body([
        caps("DAY 2 · SEA DAY", t),
        g24("At sea"),
        divider(t),
        star_line(t, "5 starred today"),
        g18("10:00a Zumba Class", extra=" margin-top: 4px;"),
        g14("Solarium · 15 Fore", t["muted"]),
        g18("11:30a Adults Only Trivia", extra=" margin-top: 4px;"),
        g14("On Air · 4 Aft", t["muted"]),
    ]))


def summary_tomorrow(t):
    return frame(t, top_bar(BAND_PORT, "Tomorrow", "9:05p") + body([
        caps("DAY 5 · PORT DAY", t),
        g24("Cozumel"),
        g18("Docked 8:00a - 4:30p"),
        g18("All aboard 4:00p", t["port"]),
        divider(t),
        star_line(t, "3 starred tomorrow"),
        g14("First 8:30a Sunrise Pilates", t["muted"]),
        g14("Last chance: Broadway Nights", t["port"]),
    ]))


# ---------------------------------------------------------------- 8.2 countdown
def big_number(t, number, unit):
    return (f'<div style="display: flex; align-items: baseline; gap: 12px">'
            f'<span style="font-size: 84px; line-height: 84px; font-weight: 700">{number}</span>'
            f'<span style="font-size: 34px; line-height: 38px; font-weight: 700">{unit}</span></div>')


def countdown_far(t):
    return frame(t, top_bar(BAND_SEA, "Home", "9:12a") + body([
        caps("SAILS IN", t),
        big_number(t, "78", "days"),
        g18("Sat Mar 6 · Galveston", t["muted"]),
        g14("Harmony of the Seas", t["muted"]),
        divider(t),
        star_line(t, "3 starred so far", 26),
    ]))


def countdown_last(t):
    return frame(t, top_bar(BAND_SEA, "Home", "7:48p") + body([
        caps("SAILS", t),
        '<div style="font-size: 56px; line-height: 60px; font-weight: 700">Tomorrow</div>',
        g18("Sat Mar 6 · Galveston", t["muted"]),
        g14("Harmony of the Seas", t["muted"]),
        divider(t),
        g18("Sync before you leave", t["port"]),
        g14("Works offline after a full sync", t["muted"]),
        g14("Last sync Mar 4, 8:40p", t["muted"]),
        star_line(t, "3 starred so far", 26),
    ]))


# ---------------------------------------------------------------- Today list
def today_row(t, time, title, sub, starred=False, clash=False, cursor=False, sub_tag=None,
              time_color=None, sep=True):
    fg = t["cur_text"] if cursor else t["text"]
    muted = t["cur_text"] if cursor else t["muted"]
    bg = f" background: {t['cur_bg']};" if cursor else ""
    sep_html = (f'<div style="position: absolute; left: 0; right: 0; top: -2px; height: 2px; '
                f'background: {t["divider"]}"></div>') if sep else ""
    icons = ""
    if starred or clash:
        parts = []
        if starred:
            parts.append(STAR.format(s=24, c=fg if cursor else t["sea"]))
        if clash:
            parts.append(bang(fg if cursor else t["port"]))
        icons = (f'<div style="position: absolute; right: 16px; top: 8px; display: flex; align-items: center; '
                 f'gap: 6px">{"".join(parts)}</div>')
    title_right = 16 + (32 if starred else 0) + (14 if clash else 0)
    time_html = ""
    if time:
        tc = fg if cursor else (time_color or t["text"])
        time_html = (f'<span style="position: absolute; left: 14px; top: 2px; font-size: 34px; line-height: 44px; '
                     f'font-weight: 700; color: {tc}">{time}</span>')
    lead = ""
    if sub_tag:
        tc = fg if cursor else t["port"]
        lead = f'<span style="color: {tc}">{sub_tag}</span> · '
    return (f'<div style="position: relative; height: 88px; flex-shrink: 0; margin-top: {2 if sep else 0}px;{bg}">'
            f'{sep_html}{time_html}'
            f'<span style="position: absolute; left: 114px; right: {title_right}px; top: 2px; font-size: 34px; '
            f'line-height: 44px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; '
            f'color: {fg}">{title}</span>'
            f'<span style="position: absolute; left: 114px; right: 16px; top: 44px; font-size: 26px; line-height: 36px; '
            f'font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: {muted}">'
            f'{lead}{sub}</span>{icons}</div>')


def today_list(rows):
    return ('<div style="display: flex; flex-direction: column; flex-grow: 1; overflow: hidden">\n'
            + "\n".join(rows) + "\n</div>\n")


# ---------------------------------------------------------------- 8.3 clash
def clash_toast(t):
    rows = today_list([
        today_row(t, "NOW", "Pool Games", "ends 1:00p · Pool Deck", time_color=t["now"], sep=False),
        today_row(t, "1:00p", "Adults Only Trivia", "On Air", starred=True, clash=True),
        today_row(t, "1:30p", "Ice Show", "Studio B", starred=True, clash=True, cursor=True),
        today_row(t, "2:30p", "FlowRider Open", "FlowRider"),
        today_row(t, "3:00p", "Galley Tour", "Main Dining Room 3"),
    ])
    toast = (f'<div style="position: absolute; left: 0; right: 0; bottom: 0; background: {t["bg"]}; '
             f'border-top: 8px solid {t["port"]}; padding: 8px 14px 14px; display: flex; gap: 12px; '
             f'align-items: flex-start">\n'
             f'<div style="padding-top: 8px">{bang(t["port"], 48)}</div>\n'
             f'<div style="display: flex; flex-direction: column; min-width: 0">\n'
             f'{g14("Clashes with", t["port"])}\n'
             f'{g18("1:00p Adults Only Trivia")}\n</div>\n</div>\n')
    return frame(t, top_bar(BAND_SEA, "Today", "12:40p", "at sea") + rows + toast, "; position: relative")


def clash_details(t):
    return frame(t, top_bar(BAND_SEA, "Event", "12:40p", "at sea") + body([
        g24("Ice Show"),
        g18("Studio B", t["muted"], " margin-top: 4px;"),
        g18("Deck 4 · Mid"),
        f'<div style="font-size: 26px; line-height: 30px; font-weight: 700; color: {t["muted"]}">'
        f'{ARROW_DOWN}2 decks from cabin</div>',
        g18("1:30p - 2:30p · 1 h"),
        g14("Clashes with 1:00p Adults Only Trivia · +1 more", t["port"]),
        divider(t),
        f'<div style="display: flex; align-items: center; gap: 8px; font-size: 28px; font-weight: 700; '
        f'color: {t["sea"]}">{STAR.format(s=26, c=t["sea"])}Starred</div>',
    ]))


# ---------------------------------------------------------------- 8.4 last chance
def last_chance_today(t):
    rows = today_list([
        today_row(t, "7:00p", "AquaTheater Show", "AquaTheater", starred=True, cursor=True, sep=False),
        today_row(t, "8:00p", "Broadway Nights", "Royal Theater", starred=True, sub_tag="Last chance"),
        today_row(t, "", "Latin Night", "Royal Promenade", sep=False),
        today_row(t, "9:00p", "Comedy Show", "On Air"),
        today_row(t, "10:30p", "Late Night Dance Party", "Royal Promenade"),
    ])
    return frame(t, top_bar(BAND_SEA, "Today", "6:10p", "at sea") + rows)


def last_chance_details(t):
    return frame(t, top_bar(BAND_SEA, "Event", "6:10p", "at sea") + body([
        g24("Broadway Nights"),
        g18("Royal Theater", t["muted"], " margin-top: 4px;"),
        g18("Deck 5 · Fore"),
        f'<div style="font-size: 26px; line-height: 30px; font-weight: 700; color: {t["muted"]}">'
        f'{ARROW_DOWN}1 deck from cabin</div>',
        g18("8:00p - 9:00p · 1 h"),
        f'<div style="display: flex; align-items: center; gap: 6px; font-size: 34px; line-height: 40px; '
        f'font-weight: 700; color: {t["sea"]}">{CHECK.format(s=26, c=t["sea"])}Reserved</div>',
        g14("Last chance", t["port"]),
        divider(t),
        f'<div style="display: flex; align-items: center; gap: 8px; font-size: 28px; font-weight: 700; '
        f'color: {t["sea"]}">{STAR.format(s=26, c=t["sea"])}Starred</div>',
        g14("Select: not reserved", t["muted"]),
    ]))


both(summary_port, "WatchSummaryPort", "Watch – morning summary, port day")
both(summary_sea, "WatchSummarySea", "Watch – morning summary, sea day")
both(summary_tomorrow, "WatchSummaryTomorrow", "Watch – tomorrow card")
both(countdown_far, "WatchCountdownFar", "Watch – Home, days to sail")
both(countdown_last, "WatchCountdownLast", "Watch – Home, sails tomorrow")
both(clash_toast, "WatchClashToast", "Watch – Today, clash toast after starring")
both(clash_details, "WatchClashDetails", "Watch – event details, clash")
both(last_chance_today, "WatchLastChanceToday", "Watch – Today, last-chance row")
both(last_chance_details, "WatchLastChanceDetails", "Watch – event details, last chance")
print("ok", len(os.listdir(OUT)))
