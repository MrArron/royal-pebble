"""Writes the Phase 4 mockups (docs/DESIGN_PHASE4.md) to docs/mockups/phase4/.

Same format as the Phase 2 and 3 mockups: Claude Design component files, 400x456
(2x) for the watch and 390x844 for the phone, inline styles, Roboto Condensed
standing in for Gothic. Also writes preview.html, a static page showing them all
side by side (it needs no canvas runtime). All data is placeholder.
"""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "mockups", "phase4")

LIGHT = dict(bg="#FFFFFF", fg="#000000", muted="#555555", port="#AA5500", sea="#0055AA", rule="#AAAAAA")
DARK = dict(bg="#000000", fg="#FFFFFF", muted="#AAAAAA", port="#FFAA00", sea="#00AAFF", rule="#555555")
BANDS = {"at sea": "#000055", "docked": "#005555"}

STAR = '<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6l-6.2 3.5 1.4-7L2 9.3l7-.8z" fill="{c}"></path>'
CHECK = ('<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="3.4" '
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink: 0">'
         '<path d="M4 12l5 5 11-11"></path></svg>')


def page(title, body, w, h, font):
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family={font}&amp;display=swap">
<style>
body{{margin:0}}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    return {{}};
  }}
}}
</script>
</body>
</html>
"""


# ------------------------------------------------------------------ watch

def line(t, text, size=34, color=None, extra=""):
    lh = {48: 50, 34: 38, 28: 34, 26: 30}[size]
    c = f" color: {t[color]};" if color else ""
    return f'<div style="font-size: {size}px; line-height: {lh}px; font-weight: 700;{c}{extra}">{text}</div>'


def rule(t):
    return f'<div style="height: 2px; background: {t["rule"]}; margin: 6px 0"></div>'


def checked(t, text, color="sea", size=34):
    return (f'<div style="display: flex; align-items: center; gap: 6px; font-size: {size}px; line-height: 40px; '
            f'font-weight: 700; color: {t[color]}">{CHECK.format(c=t[color])}{text}</div>')


def starred(t):
    return (f'<div style="display: flex; align-items: center; gap: 8px; font-size: 28px; font-weight: 700; '
            f'color: {t["sea"]}"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" '
            f'style="flex-shrink: 0">{STAR.format(c=t["sea"])}</svg>Starred</div>')


def watch(t, clock, label, day, rows):
    band = BANDS[day]
    tri = (f'<div style="position: absolute; right: 12px; bottom: 8px; width: 0; height: 0; border-left: 9px solid '
           f'transparent; border-right: 9px solid transparent; border-top: 12px solid {t["muted"]}"></div>')
    return (f'<div style="width: 400px; height: 456px; box-sizing: border-box; overflow: hidden; background: {t["bg"]}; '
            f'color: {t["fg"]}; font-family: \'Roboto Condensed\', \'Arial Narrow\', sans-serif; display: flex; '
            f'flex-direction: column; position: relative">\n'
            f'<div style="height: 44px; flex-shrink: 0; background: {band}; display: flex; align-items: center; '
            f'justify-content: space-between; padding: 0 14px; position: relative">\n'
            f'<span style="position: absolute; left: 50%; transform: translateX(-50%); color: #FFFFFF; font-size: 28px; '
            f'font-weight: 700">{clock}</span>\n'
            f'<span style="color: #FFFFFF; font-size: 28px; font-weight: 700">{label}</span>\n'
            f'<span style="color: #AAFFFF; font-size: 26px; font-weight: 700; font-variant: small-caps">{day}</span>\n'
            f'</div>\n<div style="padding: 6px 14px 0; display: flex; flex-direction: column; gap: 2px">\n'
            + "\n".join(rows) + f"\n</div>\n{tri}\n</div>")


def details(t):
    return watch(t, "9:12p", "Event", "at sea", [
        line(t, "Late Night Comedy", 48),
        line(t, "Comedy Live", 34, "muted", "; margin-top: 4px"),
        line(t, "Deck 4 · Fore"),
        line(t, "↓5 decks from cabin", 26, "muted"),
        line(t, "10:00p - 11:00p · 1 h"),
        line(t, "Arrive by 9:45p"),
        line(t, "Ages 18+", 34, "port"),
        line(t, "Bring SeaPass · Sign up at venue", 26, "muted"),
        rule(t),
        starred(t),
    ])


def details_tags(t):
    return watch(t, "1:20p", "Event", "at sea", [
        line(t, "Zip Line", 48),
        line(t, "Zip Line", 34, "muted", "; margin-top: 4px"),
        line(t, "Deck 16 · Mid"),
        line(t, "↑7 decks from cabin", 26, "muted"),
        line(t, "2:00p - 5:00p · 3 h"),
        line(t, "Ages 7+", 34, "port"),
        line(t, "Bring SeaPass · Waiver needed · Athletic shoes · Weather permitting", 26, "muted"),
        rule(t),
        line(t, "Hold Select to star", 26, "muted"),
    ])


def reminder(t):
    return watch(t, "9:30p", "Reminder", "at sea", [
        line(t, "ARRIVE IN 15 MIN", 34, "sea"),
        line(t, "Late Night Comedy", 48),
        line(t, "Comedy Live", 34, "muted"),
        line(t, "Deck 4 · Fore"),
        line(t, "↓5 decks from cabin", 26, "muted"),
        rule(t),
        line(t, "10:00p - 11:00p · 1 h"),
        line(t, "Arrive by 9:45p"),
        line(t, "Ages 18+", 34, "port"),
        line(t, "Bring SeaPass · Sign up at venue", 26, "muted"),
    ])


def excursion(t):
    return watch(t, "8:05a", "Event", "docked", [
        line(t, "Snorkel and Beach Break", 48),
        line(t, "Perfect Day at CocoCay", 34, "muted", "; margin-top: 4px; white-space: nowrap; overflow: hidden; "
             "text-overflow: ellipsis"),
        line(t, "Ashore", 34, "port"),
        line(t, "9:30a - 12:00p · 2 h 30"),
        line(t, "Meet 9:00a"),
        line(t, "Ages 6+", 34, "port"),
        line(t, "Swimwear or active wear · Weather permitting", 26, "muted"),
        checked(t, "Reserved"),
        rule(t),
        starred(t),
        line(t, "Select: not reserved", 26, "muted"),
    ])


# ------------------------------------------------------------------ phone

P = dict(bg="#F4FBFA", fg="#161D1D", muted="#3F4948", card="#EFF5F4", card2="#E9EFEE", primary="#006A6A",
         chip="#CCE8E7", chipfg="#051F1F", outline="#6F7979", port="#8B5000")


def phone(title, content, tab):
    tabs = "".join(
        f'<span style="color: #002020"><span style="display: inline-block; padding: 4px 16px; border-radius: 16px; '
        f'background: {P["chip"]}">{n}</span></span>' if n == tab else f"<span>{n}</span>"
        for n in ("Cruise", "Days", "Filters", "Events", "Me"))
    return (f'<div style="width: 390px; height: 844px; box-sizing: border-box; overflow: hidden; background: {P["bg"]}; '
            f'color: {P["fg"]}; font-family: \'Roboto Flex\', system-ui, sans-serif; display: flex; flex-direction: column">\n'
            f'<div style="height: 64px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; '
            f'padding: 0 16px">\n<span style="font-size: 24px; font-weight: 600">{title}</span>\n'
            f'<button type="button" style="height: 40px; padding: 0 20px; border: 0; border-radius: 20px; background: '
            f'{P["primary"]}; color: #FFFFFF; font: inherit; font-size: 15px; font-weight: 600">Save</button>\n</div>\n'
            f'{content}\n'
            f'<div style="height: 80px; flex-shrink: 0; background: {P["card2"]}; display: grid; grid-template-columns: '
            f'repeat(5, minmax(0, 1fr)); align-items: center; text-align: center; font-size: 12px; font-weight: 600; '
            f'color: {P["muted"]}">\n{tabs}\n</div>\n</div>')


def star_btn(name, on):
    fill = f'fill="#FFFFFF"' if on else f'fill="none" stroke="{P["muted"]}" stroke-width="1.8" stroke-linejoin="round"'
    bg = P["primary"] if on else "transparent"
    return (f'<button type="button" aria-label="{"Unstar" if on else "Star"} {name}" style="width: 48px; height: 48px; '
            f'flex-shrink: 0; border: 0; border-radius: 24px; background: {bg}; display: flex; align-items: center; '
            f'justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">'
            f'<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6l-6.2 3.5 1.4-7L2 9.3l7-.8z" {fill}></path></svg></button>')


def event_row(time, title, details, notes=None, open_=False, on=False):
    extra = ""
    if notes:
        arrow = "▴" if open_ else "▾"
        extra = (f'<div style="font-size: 14px; font-weight: 600; color: {P["primary"]}; margin-top: 4px">'
                 f'Notes · {len(notes)} {arrow}</div>')
        if open_:
            extra += ('<ul style="margin: 4px 0 0; padding-left: 18px; font-size: 14px; line-height: 19px; color: '
                      f'{P["muted"]}">' + "".join(f"<li>{n}</li>" for n in notes) + "</ul>")
    return (f'<div style="background: {P["card"]}; border-radius: 20px; padding: 12px 8px 12px 16px; display: flex; '
            f'align-items: flex-start; gap: 12px">\n<div style="width: 52px; flex-shrink: 0; font-size: 14px; '
            f'font-weight: 700; padding-top: 2px">{time}</div>\n<div style="flex-grow: 1; min-width: 0">'
            f'<div style="font-size: 16px; font-weight: 600">{title}</div><div style="font-size: 14px; color: '
            f'{P["muted"]}">{details}</div>{extra}</div>\n{star_btn(title, on)}\n</div>')


def chips(items, active):
    out = []
    for n in items:
        if n == active:
            out.append(f'<button type="button" style="height: 36px; padding: 0 14px; border: 0; border-radius: 10px; '
                       f'background: {P["chip"]}; color: {P["chipfg"]}; font: inherit; font-size: 14px; font-weight: 700; '
                       f'white-space: nowrap">{n}</button>')
        else:
            out.append(f'<button type="button" style="height: 36px; padding: 0 14px; border: 1px solid {P["outline"]}; '
                       f'border-radius: 10px; background: transparent; color: {P["muted"]}; font: inherit; '
                       f'font-size: 14px; font-weight: 600; white-space: nowrap">{n}</button>')
    return (f'<div style="display: flex; gap: 8px; padding: 0 16px 12px; overflow: hidden; flex-shrink: 0">'
            + "".join(out) + "</div>")


def phone_events():
    rows = [
        event_row("9:00a", "Sports Court Open Play", "Sports Court",
                  ["Weather permitting"]),
        event_row("1:00p", "Teen Dodgeball", "Sports Court · Ages 12-17"),
        event_row("2:00p", "Zip Line", "Zip Line · Ages 7+",
                  ["Bring your SeaPass card", "A signed waiver is required", "Closed-toe athletic shoes required",
                   "Weather permitting"]),
        event_row("10:00p", "Late Night Comedy", "Comedy Live · Ages 18+ · Arrive 15 min early",
                  ["Bring your SeaPass card", "Sign up at the venue 15 minutes before the show"], open_=True, on=True),
    ]
    content = (chips(["Day 3 · Sea", "Day 4 · Nassau", "Day 5 · Sea"], "Day 3 · Sea")
               + chips(["All", "★ Starred"], "All").replace("height: 36px", "height: 32px")
               + '<div style="flex-grow: 1; overflow: hidden; padding: 0 16px; display: flex; flex-direction: column; '
                 'gap: 12px">\n' + "\n".join(rows) + "\n</div>")
    return phone("Events", content, "Events")


def switch(label, on):
    if on:
        return (f'<button type="button" role="switch" aria-checked="true" aria-label="{label}" style="width: 52px; '
                f'height: 32px; flex-shrink: 0; border: 0; border-radius: 16px; background: {P["primary"]}; position: '
                f'relative"><span style="position: absolute; right: 4px; top: 4px; width: 24px; height: 24px; '
                f'border-radius: 12px; background: #FFFFFF"></span></button>')
    return (f'<button type="button" role="switch" aria-checked="false" aria-label="{label}" style="width: 52px; '
            f'height: 32px; flex-shrink: 0; border: 2px solid {P["outline"]}; box-sizing: border-box; border-radius: '
            f'16px; background: #E3E9E9; position: relative"><span style="position: absolute; left: 6px; top: 6px; '
            f'width: 16px; height: 16px; border-radius: 8px; background: {P["outline"]}"></span></button>')


def switch_row(title, sub, on):
    return (f'<div style="background: {P["card"]}; border-radius: 20px; padding: 12px 18px; display: flex; '
            f'align-items: center; gap: 12px"><div style="flex-grow: 1"><div style="font-size: 16px; font-weight: 600">'
            f'{title}</div><div style="font-size: 14px; color: {P["muted"]}">{sub}</div></div>{switch(title, on)}</div>')


def heading(text):
    return (f'<div style="font-size: 13px; font-weight: 700; letter-spacing: 0.4px; color: {P["muted"]}; '
            f'padding: 4px 4px 0">{text}</div>')


def phone_filters():
    rows = [
        heading("AGES"),
        switch_row("Hide Adult only events", "18+ and 21+ · 31 events", False),
        switch_row("Hide Teen and Kid only events", "17 and under · 14 events", True),
        f'<div style="font-size: 13px; line-height: 19px; color: {P["muted"]}; padding: 0 4px">Events you star always '
        'show. Events with no age listed never hide. Casino games are in the Casino category below.</div>',
        heading("CATEGORIES"),
        switch_row("Entertainment", "112 events", True),
        switch_row("Activities", "86 events", True),
        switch_row("Casino", "Casino Royale and casino games · 18 events", True),
        switch_row("Shop", "Hidden · 40 events", False),
    ]
    content = ('<div style="flex-grow: 1; overflow: hidden; padding: 0 16px; display: flex; flex-direction: column; '
               'gap: 10px">\n' + "\n".join(rows) + "\n</div>")
    return phone("Filters", content, "Filters")


def session(time, title, sub, picked=False):
    if picked:
        btn = (f'<span style="display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 12px; '
               f'border-radius: 8px; background: {P["primary"]}; color: #FFFFFF; font-size: 13px; font-weight: 700; '
               f'flex-shrink: 0">✓ Picked</span>')
    else:
        btn = (f'<button type="button" style="height: 32px; padding: 0 12px; border: 1px solid {P["outline"]}; '
               f'border-radius: 8px; background: transparent; color: {P["primary"]}; font: inherit; font-size: 13px; '
               f'font-weight: 700; flex-shrink: 0">Pick</button>')
    return (f'<div style="display: flex; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid #DDE4E3">'
            f'<div style="width: 52px; flex-shrink: 0; font-size: 14px; font-weight: 700">{time}</div>'
            f'<div style="flex-grow: 1; min-width: 0"><div style="font-size: 15px; font-weight: 600">{title}</div>'
            f'<div style="font-size: 13px; color: {P["muted"]}">{sub}</div></div>{btn}</div>')


def group(head, sessions):
    return (f'<div style="background: {P["card"]}; border-radius: 20px; padding: 12px 16px 4px">'
            f'<div style="font-size: 13px; font-weight: 700; letter-spacing: 0.4px; color: {P["muted"]}; '
            f'padding-bottom: 6px">{head}</div>' + "".join(sessions) + "</div>")


def phone_excursions():
    back = (f'<div style="display: flex; align-items: center; gap: 8px; padding: 0 16px 8px; font-size: 18px; '
            f'font-weight: 600">‹ Booked activities and excursions</div>')
    intro = (f'<div style="font-size: 14px; line-height: 20px; color: {P["muted"]}; padding: 0 16px 12px">Pick the '
             'sessions you booked in the Royal app. Picked ones are starred and go to your watch; the rest stay off '
             'it.</div>')
    groups = [
        group("DAY 4 · NASSAU · SHORE EXCURSIONS", [
            session("8:30a", "Blue Lagoon Dolphin Encounter", "Meet 8:00a · 4 h · Ages 6+"),
            session("9:30a", "Snorkel and Beach Break", "Meet 9:00a · 2 h 30 · Ages 6+", picked=True),
            session("1:00p", "Nassau Walking Food Tour", "Meet 12:45p · 3 h"),
        ]),
        group("DAY 6 · PERFECT DAY AT COCOCAY · SHORE EXCURSIONS", [
            session("9:00a", "Beach Cabana", "All day from 9:00a"),
            session("10:00a", "Up, Up and Away Balloon", "Meet 9:45a · 15 min"),
        ]),
        group("DAY 3 · SEA · ACTIVITIES", [
            session("2:00p", "Escape Room: The Observatory", "Escape Room · 1 h · from $45"),
        ]),
    ]
    content = (back + intro + '<div style="flex-grow: 1; overflow: hidden; padding: 0 16px; display: flex; '
               'flex-direction: column; gap: 12px">\n' + "\n".join(groups) + "\n</div>")
    return phone("Cruise", content, "Cruise")


SCREENS = [
    ("Watch4DetailsLight", "Watch - event details with arrive-by, age and tags, light", lambda: details(LIGHT)),
    ("Watch4DetailsDark", "Watch - event details with arrive-by, age and tags, dark", lambda: details(DARK)),
    ("Watch4TagsLight", "Watch - event details with four tags, unstarred, light", lambda: details_tags(LIGHT)),
    ("Watch4TagsDark", "Watch - event details with four tags, unstarred, dark", lambda: details_tags(DARK)),
    ("Watch4ReminderLight", "Watch - arrive-early reminder, light", lambda: reminder(LIGHT)),
    ("Watch4ExcursionLight", "Watch - picked shore excursion details, light", lambda: excursion(LIGHT)),
    ("Watch4ExcursionDark", "Watch - picked shore excursion details, dark", lambda: excursion(DARK)),
    ("Phone4Events", "Settings page - Events rows with ages, arrive-early and notes", phone_events),
    ("Phone4Filters", "Settings page - Filters with the two age switches", phone_filters),
    ("Phone4Excursions", "Settings page - Booked activities and excursions", phone_excursions),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    cards = []
    for name, title, make in SCREENS:
        body = make()
        watch_ = name.startswith("Watch")
        w, h = (400, 456) if watch_ else (390, 844)
        font = ("Roboto+Condensed:wght@400;700" if watch_ else
                "Roboto+Flex:opsz,wght@8..144,400;8..144,600;8..144,700")
        with open(os.path.join(OUT, name + ".dc.html"), "w", encoding="utf-8", newline="\n") as f:
            f.write(page(title, body, w, h, font))
        scale = "zoom: 0.5" if watch_ else "zoom: 0.62"
        cards.append(f'<figure><div style="{scale}; border: 1px solid #999">{body}</div>'
                     f'<figcaption>{name}</figcaption></figure>')
    preview = ("<!doctype html><html><head><meta charset='utf-8'><title>Phase 4 mockups</title>"
               "<meta name='viewport' content='width=device-width,initial-scale=1'>"
               "<link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&"
               "family=Roboto+Flex:opsz,wght@8..144,400;8..144,600;8..144,700&display=swap'>"
               "<style>body{margin:16px;background:#ddd;font:14px sans-serif}"
               "main{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}"
               "figure{margin:0}figcaption{margin-top:6px;font-weight:600}</style></head><body>"
               "<h1>Royal Pebble Phase 4 mockups</h1><p>Watch screens at 1x (200x228), phone at 0.62x. "
               "The watch pages scroll; the triangle marks more below. Placeholder data.</p><main>"
               + "".join(cards) + "</main></body></html>")
    with open(os.path.join(OUT, "preview.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(preview)
    print(f"wrote {len(SCREENS)} mockups and preview.html to {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
