"""Generate the phone Events tab clash mockup (EventsClash.dc.html), interactive like EventsReserve."""
BANG = '<svg width="6" height="14" viewBox="0 0 8 24" aria-hidden="true"><rect x="1" y="0" width="6" height="15" rx="2" fill="currentColor"></rect><rect x="1" y="18" width="6" height="6" rx="2" fill="currentColor"></rect></svg>'
CHECK16 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>'
CHECK14 = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>'
STARP = 'M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.8L12 17.6 6 21l1.3-6.8-5-4.7 6.8-.8z'
import os, re
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "docs", "mockups", "phase2-draft")
# The bottom nav is copied from the v1.1 Events mockup so the two stay identical.
_src = open(os.path.join(REPO, "docs", "mockups", "v1.1", "EventsReserve.dc.html"), encoding="utf-8").read()
NAV = re.search(r"<nav[\s\S]*?</nav>\r?\n", _src).group(0).replace("\r\n", "\n")
html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Events – clash warning</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,400..700&amp;display=swap">
<style>
body{{margin:0;background:#F4FBFA}}
a{{color:#006A6A}}a:hover{{color:#004F4F}}
</style>
</helmet>
<div style="width: 360px; height: 800px; box-sizing: border-box; display: flex; flex-direction: column; background: #F4FBFA; color: #161D1D; font-family: 'Roboto Flex', Roboto, system-ui, sans-serif">
<header style="height: 64px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 16px 0 20px">
<h1 style="margin: 0; font-size: 24px; font-weight: 500">Events</h1>
<button style="height: 40px; padding: 0 24px; border: 0; border-radius: 20px; background: #006A6A; color: #FFFFFF; font-family: inherit; font-size: 14px; font-weight: 600">Save</button>
</header>
<div style="padding: 0 16px 8px; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0">
<label style="height: 48px; border-radius: 24px; background: #E3E9E9; display: flex; align-items: center; gap: 10px; padding: 0 16px; color: #3F4948">
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
<input type="search" aria-label="Search events or venues" placeholder="Search events or venues" style="border: 0; background: transparent; outline: none; flex-grow: 1; font-family: inherit; font-size: 16px; color: #161D1D; min-width: 0">
</label>
<div style="display: flex; gap: 8px; overflow-x: auto">
<button style="height: 36px; padding: 0 14px; border-radius: 10px; border: 1px solid #6F7979; background: transparent; color: #3F4948; font-family: inherit; font-size: 14px; font-weight: 600; flex-shrink: 0">Sat 12</button>
<button aria-pressed="true" style="height: 36px; padding: 0 14px; border-radius: 10px; border: 1px solid #CCE8E7; background: #CCE8E7; color: #051F1F; font-family: inherit; font-size: 14px; font-weight: 600; flex-shrink: 0">Sun 13</button>
<button style="height: 36px; padding: 0 14px; border-radius: 10px; border: 1px solid #6F7979; background: transparent; color: #3F4948; font-family: inherit; font-size: 14px; font-weight: 600; flex-shrink: 0">Mon 14</button>
<button style="height: 36px; padding: 0 14px; border-radius: 10px; border: 1px solid #6F7979; background: transparent; color: #3F4948; font-family: inherit; font-size: 14px; font-weight: 600; flex-shrink: 0">Tue 15</button>
</div>
<div style="display: flex; flex-wrap: wrap; gap: 8px">
<sc-for list="{{{{chips}}}}" as="c" hint-placeholder-count="4">
<button onClick="{{{{c.pick}}}}" aria-pressed="{{{{c.pressed}}}}" style="{{{{c.style}}}}">{{{{c.label}}}}</button>
</sc-for>
</div>
</div>
<main style="flex-grow: 1; overflow-y: auto; padding: 4px 12px 16px; display: flex; flex-direction: column; gap: 8px">
<sc-if value="{{{{empty}}}}" hint-placeholder-val="{{{{ false }}}}">
<div style="padding: 32px 16px; text-align: center; color: #3F4948; font-size: 14px">{{{{emptyText}}}}</div>
</sc-if>
<sc-for list="{{{{events}}}}" as="e" hint-placeholder-count="6">
<article style="background: #EFF5F4; border-radius: 20px; padding: 12px 4px 12px 16px; display: flex; gap: 12px; align-items: flex-start; flex-shrink: 0">
<div style="width: 52px; flex-shrink: 0; font-size: 14px; font-weight: 700; padding-top: 2px">{{{{e.time}}}}</div>
<div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px">
<span style="font-size: 16px; font-weight: 500">{{{{e.title}}}}</span>
<span style="font-size: 13px; color: #3F4948">{{{{e.venue}}}}</span>
<sc-if value="{{{{e.hasTags}}}}" hint-placeholder-val="{{{{ false }}}}">
<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px">
<sc-if value="{{{{e.clash}}}}" hint-placeholder-val="{{{{ false }}}}">
<span style="min-height: 28px; box-sizing: border-box; padding: 5px 10px; border-radius: 14px; background: #FFDDB5; color: #2A1700; font-size: 12px; line-height: 16px; font-weight: 600; display: flex; align-items: center; gap: 6px">{BANG}<span>{{{{e.clash}}}}</span></span>
</sc-if>
<sc-if value="{{{{e.last}}}}" hint-placeholder-val="{{{{ false }}}}">
<span style="height: 28px; box-sizing: border-box; padding: 0 10px; border-radius: 14px; border: 1px solid #6F7979; color: #3F4948; font-size: 12px; font-weight: 600; display: flex; align-items: center">{{{{e.last}}}}</span>
</sc-if>
<sc-if value="{{{{e.showNeeded}}}}" hint-placeholder-val="{{{{ false }}}}">
<span style="height: 28px; padding: 0 10px; border-radius: 14px; background: #FFDDB5; color: #2A1700; font-size: 12px; font-weight: 600; display: flex; align-items: center">Reservation needed</span>
<button onClick="{{{{e.toggleRes}}}}" style="height: 40px; padding: 0 16px; border: 0; border-radius: 20px; background: #CCE8E7; color: #051F1F; font-family: inherit; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 6px">{CHECK16}Mark reserved</button>
</sc-if>
<sc-if value="{{{{e.showReserved}}}}" hint-placeholder-val="{{{{ false }}}}">
<span style="height: 28px; padding: 0 10px; border-radius: 14px; background: #9CF1F0; color: #002020; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px">{CHECK14}Reserved</span>
<button onClick="{{{{e.toggleRes}}}}" style="height: 40px; padding: 0 12px; border: 0; background: transparent; color: #006A6A; font-family: inherit; font-size: 14px; font-weight: 600">Not reserved</button>
</sc-if>
</div>
</sc-if>
<sc-if value="{{{{e.showPlainRes}}}}" hint-placeholder-val="{{{{ false }}}}">
<span style="font-size: 12px; color: #3F4948">Reservation needed · star it to track</span>
</sc-if>
</div>
<button onClick="{{{{e.toggleStar}}}}" aria-label="{{{{e.starLabel}}}}" aria-pressed="{{{{e.starPressed}}}}" style="width: 48px; height: 48px; flex-shrink: 0; border: 0; background: transparent; border-radius: 24px; display: flex; align-items: center; justify-content: center; color: #006A6A">
<sc-if value="{{{{e.starred}}}}" hint-placeholder-val="{{{{ false }}}}">
<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="{STARP}" fill="#006A6A"></path></svg>
</sc-if>
<sc-if value="{{{{e.unstarred}}}}" hint-placeholder-val="{{{{ true }}}}">
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3F4948" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="{STARP}"></path></svg>
</sc-if>
</button>
</article>
</sc-for>
</main>
{NAV}</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":360,"height":800}}}}'>
class Component extends DCLogic {{
  constructor(props) {{
    super(props);
    this.state = {{
      filter: 'all',
      starred: {{ e2: true, e4: true, e6: true, e7: true }},
      reserved: {{ e6: true }}
    }};
  }}
  renderVals() {{
    const s = this.state;
    // start in minutes; len null = no length (counts as 30 min, the Today drop-off rule)
    const E = [
      {{ id: 'e1', start: 600, len: 60, time: '10:00a', title: 'Adults Only Trivia: Movies', venue: 'Studio B' }},
      {{ id: 'e2', start: 780, len: 60, time: '1:00p', title: 'Name That Tune', venue: 'On Air' }},
      {{ id: 'e3', start: 780, len: 60, time: '1:00p', title: 'Pool Games', venue: 'Pool Deck' }},
      {{ id: 'e4', start: 810, len: 60, time: '1:30p', title: 'Ice Show', venue: 'Studio B', res: true }},
      {{ id: 'e5', start: 900, len: 90, time: '3:00p', title: 'FlowRider Open', venue: 'FlowRider' }},
      {{ id: 'e6', start: 1140, len: 60, time: '7:00p', title: 'AquaTheater Show', venue: 'AquaTheater', res: true }},
      {{ id: 'e7', start: 1200, len: 75, time: '8:00p', title: 'Broadway Nights', venue: 'Royal Theater', last: 'Last chance' }},
      {{ id: 'e8', start: 1260, len: null, time: '9:00p', title: 'Comedy Show', venue: 'On Air', res: true }},
      {{ id: 'e9', start: 1275, len: 60, time: '9:15p', title: 'Late Night Karaoke', venue: 'Studio B' }}
    ];
    const end = (e) => e.start + (e.len == null ? 30 : e.len);
    const st = (e) => !!s.starred[e.id];
    // Clash: two starred items whose times overlap. Back-to-back is not a clash.
    const clashesOf = (e) => st(e) ? E.filter((o) => o !== e && st(o) && o.start < end(e) && e.start < end(o)) : [];
    const needs = (e) => e.res && st(e) && !s.reserved[e.id];
    const nNeeds = E.filter(needs).length;
    const nClash = E.filter((e) => clashesOf(e).length > 0).length;
    const filter = (s.filter === 'clashes' && nClash === 0) ? 'all' : s.filter;
    const shown = E.filter((e) => filter === 'all' || (filter === 'starred' && st(e)) ||
      (filter === 'needs' && needs(e)) || (filter === 'clashes' && clashesOf(e).length > 0));
    const flip = (key, id) => this.setState({{ [key]: Object.assign({{}}, s[key], {{ [id]: !s[key][id] }}) }});

    const events = shown.map((e) => {{
      const on = st(e);
      const rv = !!s.reserved[e.id];
      const cl = clashesOf(e);
      const clash = cl.length ? 'Clashes with ' + cl[0].title + ' ' + cl[0].time + (cl.length > 1 ? ' +' + (cl.length - 1) + ' more' : '') : '';
      return {{
        time: e.time, title: e.title, venue: e.venue,
        starred: on, unstarred: !on,
        starPressed: String(on), starLabel: (on ? 'Unstar ' : 'Star ') + e.title,
        clash: clash, last: e.last || '',
        showNeeded: !!(e.res && on && !rv),
        showReserved: !!(e.res && on && rv),
        showPlainRes: !!(e.res && !on),
        hasTags: !!(clash || e.last || (e.res && on)),
        toggleStar: () => flip('starred', e.id),
        toggleRes: () => flip('reserved', e.id)
      }};
    }});

    const chipStyle = (on) => 'height: 36px; padding: 0 14px; border-radius: 10px; font-family: inherit; font-size: 14px; font-weight: 600; flex-shrink: 0; ' +
      (on ? 'background: #CCE8E7; color: #051F1F; border: 1px solid #CCE8E7;' : 'background: transparent; color: #3F4948; border: 1px solid #6F7979;');
    const defs = [
      {{ id: 'all', label: 'All' }},
      {{ id: 'starred', label: 'Starred' }},
      {{ id: 'needs', label: 'To reserve · ' + nNeeds }}
    ];
    if (nClash > 0) defs.push({{ id: 'clashes', label: 'Clashes · ' + nClash }});
    const chips = defs.map((c) => ({{ label: c.label, pressed: String(filter === c.id), style: chipStyle(filter === c.id), pick: () => this.setState({{ filter: c.id }}) }}));

    const emptyText = filter === 'needs' ? 'Every starred event that needs a reservation is marked reserved.' : 'No events match.';
    return {{ chips, events, empty: events.length === 0, emptyText }};
  }}
}}
</script>
</body>
</html>
'''
open(os.path.join(OUT, 'EventsClash.dc.html'), 'w', encoding='utf-8', newline='\n').write(html)
