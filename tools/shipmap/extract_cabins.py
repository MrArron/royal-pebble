#!/usr/bin/env python3
"""Build a compact cabin-location table from Royal's deck-plan SVGs.

Usage: python extract_cabins.py <svg_dir> <ship_code> <ship_length_m> <out.js>
  svg_dir holds deck-<n>.svg files named by deck number (deck-8.svg, deck-14.svg).

Every deck SVG is drawn in its own frame, so decks are lined up on the forward
elevator bank (elevators stack straight up the ship). Distances come out in
metres: `a` = metres aft of the bow, `x` = metres from the centreline
(negative = port, positive = starboard; the plans are top views, bow up).
"""
import json, math, os, re, sys
from collections import defaultdict

ELEV_E = re.compile(r'<path d="M([\d.]+),([\d.]+)h-2\.\d+v-1\.\d+h0\.4')
STAIR_FILL = '#E5CC93'
BANK_GAP = (230.0, 244.0)   # SVG units between the two elevator banks (Oasis class)


def attrs(tag):
    return dict(re.findall(r'([\w:-]+)="([^"]*)"', tag))


def cabins_of(svg):
    out = defaultdict(list)
    for m in re.finditer(r'<(rect|polygon)\b([^>]*)/?>', svg):
        a = attrs(m.group(2))
        cid = re.fullmatch(r'R(\d+)', a.get('id', ''))
        if not cid or 'cabinShape' not in a.get('class', ''):
            continue
        if m.group(1) == 'rect':
            x, y = float(a['x']), float(a['y'])
            w, h = float(a['width']), float(a['height'])
            out[int(cid.group(1))].append((x, y, x + w, y + h))
        else:
            pts = [tuple(map(float, p.split(','))) for p in a['points'].split()]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            out[int(cid.group(1))].append((min(xs), min(ys), max(xs), max(ys)))
    # Cabins drawn as <path> (curved corner suites): use the number label instead.
    for m in re.finditer(r'<text\b([^>]*)>\s*(\d+)\s*</text>', svg):
        a = attrs(m.group(1))
        n = int(m.group(2))
        t = re.search(r'matrix\(1 0 0 1 ([-\d.]+) ([-\d.]+)\)', a.get('transform', ''))
        if t and 'cabinNumber' in a.get('class', '') and n not in out:
            x, y = float(t.group(1)), float(t.group(2))
            out[n].append((x, y - 2, x + 6, y + 1))
    cab = {}
    for n, boxes in out.items():   # a cabin can be drawn as several shapes
        x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
        x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
        cab[n] = ((x0 + x1) / 2, (y0 + y1) / 2)
    return cab


def clusters(values, gap):
    values = sorted(values)
    groups = []
    for v in values:
        if groups and v - groups[-1][-1] <= gap:
            groups[-1].append(v)
        else:
            groups.append([v])
    return groups


def elevator_banks(svg):
    """(forward_y, aft_y) of the elevator lobbies, either may be None."""
    es = [(float(x), float(y)) for x, y in ELEV_E.findall(svg)]
    # An ELEV label pair (one per side of the lobby) sits ~4 units apart.
    ys = [sum(g) / len(g) for g in clusters([e[1] for e in es], 6) if len(g) >= 2]
    for i, a in enumerate(ys):
        for b in ys[i + 1:]:
            if BANK_GAP[0] <= b - a <= BANK_GAP[1]:
                return a, b
    return (None, ys[0]) if len(ys) == 1 else (None, None)


def stairwells(svg):
    boxes = []
    for m in re.finditer(r'<rect\b([^>]*)/?>', svg):
        a = attrs(m.group(1))
        if a.get('fill', '').upper() == STAIR_FILL:
            boxes.append((float(a['x']) + float(a['width']) / 2, float(a['y']) + float(a['height']) / 2))
    wells = []
    for p in boxes:
        for w in wells:
            if abs(w['x'] - p[0]) < 8 and abs(w['y'] - p[1]) < 8:
                w['pts'].append(p)
                w['x'] = sum(q[0] for q in w['pts']) / len(w['pts'])
                w['y'] = sum(q[1] for q in w['pts']) / len(w['pts'])
                break
        else:
            wells.append({'x': p[0], 'y': p[1], 'pts': [p]})
    return [(w['x'], w['y']) for w in wells if len(w['pts']) >= 4]


def build_runs(cabs, tol):
    """Group cabins into runs: same side and column, numbers stepping evenly,
    positions on a straight line within `tol` metres."""
    cols = defaultdict(list)
    for n, (a, x) in cabs.items():
        cols[(x < 0, round(x / 2.5))].append((a, n, x))
    runs = []
    for key in sorted(cols):
        items = sorted(cols[key])
        cur = []
        def fits(seq):
            if len(seq) < 2:
                return True
            step = seq[1][1] - seq[0][1]
            if step == 0 or abs(step) > 4:
                return False
            for i in range(1, len(seq)):
                if seq[i][1] - seq[i - 1][1] != step:
                    return False
            a0, a1 = seq[0][0], seq[-1][0]
            k = len(seq) - 1
            for i, s in enumerate(seq):
                if abs(a0 + (a1 - a0) * i / k - s[0]) > tol:
                    return False
            return max(s[2] for s in seq) - min(s[2] for s in seq) <= 2 * tol
        for it in items:
            if fits(cur + [it]):
                cur.append(it)
            else:
                runs.append(cur)
                cur = [it]
        if cur:
            runs.append(cur)
    out = []
    for r in runs:
        x = sum(s[2] for s in r) / len(r)
        step = r[1][1] - r[0][1] if len(r) > 1 else 0
        out.append([r[0][1], len(r), step, round(r[0][0], 1), round(r[-1][0], 1), round(x, 1)])
    return sorted(out)


def main():
    svg_dir, ship, length_m, out_path = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
    decks = {}
    for f in os.listdir(svg_dir):
        m = re.fullmatch(r'deck-(\d+)\.svg', f)
        if m:
            decks[int(m.group(1))] = open(os.path.join(svg_dir, f), encoding='utf-8').read()

    info = {}
    for d, svg in decks.items():
        vb = list(map(float, re.search(r'viewBox="([^"]*)"', svg).group(1).split()))
        info[d] = {'vb': vb, 'banks': elevator_banks(svg)}
    # Lining decks up: forward bank if the deck has both, else infer from the aft bank.
    gap = next(b[1] - b[0] for b in (i['banks'] for i in info.values()) if b[0] is not None)
    for d, i in sorted(info.items()):
        f, a = i['banks']
        if f is None and a is not None:
            f = a - gap
        if f is None:   # no lobby drawn (top deck): borrow the deck below's frame
            below = max(k for k in info if k < d and info[k].get('fwd') is not None)
            f = info[below]['fwd'] + (i['vb'][1] - info[below]['vb'][1])
        i['fwd'] = f
    # Scale: the longest deck outline is the ship's length overall.
    ref = max(info, key=lambda d: info[d]['vb'][3])
    vb = info[ref]['vb']
    scale = length_m / (vb[3] - 4.0)          # viewBox carries ~2 units of margin each end
    bow_to_fwd = (info[ref]['fwd'] - (vb[1] + 2.0)) * scale

    def A(d, y):
        return (y - info[d]['fwd']) * scale + bow_to_fwd

    def X(d, x):
        v = info[d]['vb']
        return (x - (v[0] + v[2] / 2)) * scale

    table = {'ship': ship, 'unit': 'm', 'banks': {'fwd': round(bow_to_fwd, 1),
             'aft': round(bow_to_fwd + gap * scale, 1)}, 'decks': {}}
    all_cabs, worst = {}, 0.0
    for d in sorted(decks):
        cab = {n: (A(d, y), X(d, x)) for n, (x, y) in cabins_of(decks[d]).items()}
        if not cab:
            continue
        for n, (a, x) in list(cab.items()):
            if n in all_cabs:          # drawn on two decks (loft suites): keep the entry deck
                del cab[n]
                continue
            all_cabs[n] = (d, a, x)
        if not cab:
            continue
        runs = build_runs(cab, tol=1.0)
        stairs = sorted((round(A(d, y), 1), round(X(d, x), 1)) for x, y in stairwells(decks[d]))
        table['decks'][str(d)] = {'runs': runs, 'stairs': stairs}
        # check the runs reproduce every cabin
        for first, count, step, a0, a1, x in runs:
            for i in range(count):
                n = first + i * step
                ai = a0 + (a1 - a0) * i / (count - 1) if count > 1 else a0
                worst = max(worst, abs(ai - cab[n][0]), abs(x - cab[n][1]))
    js = ('// Generated by tools/shipmap/extract_cabins.py from Royal\'s deck-plan SVGs. Do not edit by hand.\n'
          'module.exports = ' + json.dumps(table, separators=(',', ':')) + ';\n')
    open(out_path, 'w').write(js)
    nruns = sum(len(v['runs']) for v in table['decks'].values())
    print('decks %d, cabins %d, runs %d, worst error %.2f m, file %d bytes, scale %.4f m/unit'
          % (len(table['decks']), len(all_cabs), nruns, worst, len(js), scale))
    json.dump({str(n): [d, round(a, 1), round(x, 1)] for n, (d, a, x) in all_cabs.items()},
              open(out_path + '.check.json', 'w'))


if __name__ == '__main__':
    main()
