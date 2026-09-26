"""Build the walkway graph (walkways-<SHIP>.js) from hand-drawn paths + places data.

    python tools/shipmap/build_walkways.py tools/shipmap/walkways-HM.paths.json <places-HM.js> \
        tools/shipmap/out/symbols-HM.json walkways-HM.js

Inputs
  paths.json   hand-drawn walkable polylines per deck (see its _about)
  places-HM.js elevator banks, stairwells, restrooms (from the ship-map tools)
  symbols.json optional: glyph boxes from tools/shipmap/find_restrooms.py, used to find every
               restroom symbol (and whether it is men's or women's); '-' to skip
Output
  a generated module: per deck nodes [id, a, x, kind] and edges [from, to(, '?')],
  plus stairs / lobbies / restrooms mapped onto node ids. Everything in metres, 0.1 m.

Rules
  * points of different paths closer than MERGE merge into one node; crossing segments
    and points lying on another path's segment become junctions;
  * every elevator lobby door (bank a, port/starboard x) on the bank's decks and every
    stairwell spot is attached: an existing node within MERGE, else a new node joined to
    the nearest point of the nearest segment (farther than ATTACH_SURE -> the link is '?');
  * kinds: lobby, stair, deadend (degree 1), junction (degree >= 3), else corridor / open.
"""
import json, math, re, sys
from collections import defaultdict

MERGE = 0.6
ATTACH_MAX = 12.0
ATTACH_SURE = 6.0
PAIR = 8.0         # men's + women's symbols closer than this are one restroom


def r1(v):
    return round(v * 10) / 10


def load_module(path):
    t = open(path, encoding='utf-8').read()
    return json.loads(t[t.index('module.exports') + len('module.exports'):].strip().lstrip('=').strip().rstrip(';'))


class Deck:
    def __init__(self, d):
        self.d = d
        self.pts = []           # [a, x]
        self.kind = []          # corridor/open/lobby/stair
        self.edges = {}         # (i, j) i<j -> q (bool)
        self.ek = {}            # (i, j) -> 'corridor' | 'open'
        self.log = []

    def node(self, a, x, kind):
        for i, (pa, px) in enumerate(self.pts):
            if math.hypot(pa - a, px - x) < MERGE:
                if kind in ('lobby', 'stair'):
                    self.kind[i] = kind
                elif self.kind[i] == 'open' and kind == 'corridor':
                    self.kind[i] = 'corridor'
                return i
        self.pts.append([a, x])
        self.kind.append(kind)
        return len(self.pts) - 1

    def edge(self, i, j, q, kind='open'):
        if i == j:
            return
        k = (min(i, j), max(i, j))
        existed = k in self.edges
        self.edges[k] = (self.edges[k] and q) if existed else q
        self.ek[k] = 'corridor' if kind == 'corridor' or (existed and self.ek[k] == 'corridor') else kind

    def split_all(self):
        """Split segments at nodes lying on them and at proper crossings."""
        changed = True
        while changed:
            changed = False
            for (i, j), q in list(self.edges.items()):
                a0, x0 = self.pts[i]; a1, x1 = self.pts[j]
                # a node on the segment interior
                for k, (pa, px) in enumerate(self.pts):
                    if k in (i, j):
                        continue
                    t, dist = proj(a0, x0, a1, x1, pa, px)
                    if 0 < t < 1 and dist < MERGE:
                        ek = self.ek[(i, j)]
                        del self.edges[(i, j)]
                        self.edge(i, k, q, ek); self.edge(k, j, q, ek)
                        changed = True
                        break
                if changed:
                    break
                # a proper crossing with another segment
                for (k, l), q2 in list(self.edges.items()):
                    if len({i, j, k, l}) < 4:
                        continue
                    p = cross(self.pts[i], self.pts[j], self.pts[k], self.pts[l])
                    if p:
                        m = self.node(p[0], p[1], self.kind[i] if self.kind[i] == self.kind[k] else 'open')
                        e1, e2 = self.ek[(i, j)], self.ek[(k, l)]
                        del self.edges[(i, j)]; del self.edges[(k, l)]
                        self.edge(i, m, q, e1); self.edge(m, j, q, e1); self.edge(k, m, q2, e2); self.edge(m, l, q2, e2)
                        changed = True
                        break
                if changed:
                    break

    def attach(self, a, x, kind, what, sure_q=False):
        """Return the node for a place; create/join it to the graph. Returns (node, dist)."""
        for i, (pa, px) in enumerate(self.pts):
            if math.hypot(pa - a, px - x) < MERGE:
                if kind:
                    self.kind[i] = kind
                return i, 0.0
        best = None
        for sure_only in (True, False):     # prefer a certain path when one is close
            for (i, j), q in self.edges.items():
                if sure_only and q:
                    continue
                t, dist = proj(*self.pts[i], *self.pts[j], a, x)
                t = min(1, max(0, t))
                if best is None or dist < best[0]:
                    best = (dist, i, j, t, q)
            if best is not None and best[0] <= ATTACH_SURE:
                break
        if best is None or best[0] > ATTACH_MAX:
            self.log.append('UNATTACHED %s at (%.1f, %.1f): nearest path %.1f m' % (what, a, x, best[0] if best else -1))
            return None, None
        dist, i, j, t, q = best
        (a0, x0), (a1, x1) = self.pts[i], self.pts[j]
        pa, px = a0 + (a1 - a0) * t, x0 + (x1 - x0) * t
        foot = self.node(pa, px, self.kind[i] if self.kind[i] == self.kind[j] else 'open')
        if foot not in (i, j) and (min(i, j), max(i, j)) in self.edges:
            ek = self.ek[(min(i, j), max(i, j))]
            del self.edges[(min(i, j), max(i, j))]
            self.edge(i, foot, q, ek); self.edge(foot, j, q, ek)
        if kind is None:          # restrooms: just the foot node
            return foot, math.hypot(pa - a, px - x)
        n = self.node(a, x, kind)
        uncertain = sure_q or math.hypot(pa - a, px - x) > ATTACH_SURE
        self.edge(n, foot, uncertain)
        if uncertain:
            self.log.append('uncertain link: %s at (%.1f, %.1f) is %.1f m from the nearest path' % (what, a, x, math.hypot(pa - a, px - x)))
        return n, math.hypot(pa - a, px - x)


def simplify(D, keep):
    changed = True
    while changed:
        changed = False
        adj = defaultdict(list)
        for (i, j), q in D.edges.items():
            adj[i].append((j, (q, D.ek[(i, j)]))); adj[j].append((i, (q, D.ek[(i, j)])))
        for n, nb in adj.items():
            if n in keep or D.kind[n] in ('lobby', 'stair') or len(nb) != 2 or nb[0][1] != nb[1][1]:
                continue
            (i, (q, ek)), (j, _) = nb
            t, dist = proj(*D.pts[i], *D.pts[j], *D.pts[n])
            if 0 < t < 1 and dist < 0.3:
                del D.edges[(min(i, n), max(i, n))]; del D.edges[(min(j, n), max(j, n))]
                D.edge(i, j, q, ek)
                changed = True
                break


def proj(a0, x0, a1, x1, pa, px):
    da, dx = a1 - a0, x1 - x0
    L = da * da + dx * dx
    t = ((pa - a0) * da + (px - x0) * dx) / L if L else 0
    tc = min(1, max(0, t))
    return t, math.hypot(a0 + da * tc - pa, x0 + dx * tc - px)


def cross(p, q, r, s):
    (a1, x1), (a2, x2), (a3, x3), (a4, x4) = p, q, r, s
    den = (a2 - a1) * (x4 - x3) - (x2 - x1) * (a4 - a3)
    if abs(den) < 1e-9:
        return None
    t = ((a3 - a1) * (x4 - x3) - (x3 - x1) * (a4 - a3)) / den
    u = ((a3 - a1) * (x2 - x1) - (x3 - x1) * (a2 - a1)) / den
    eps = 0.02
    if eps < t < 1 - eps and eps < u < 1 - eps:
        return a1 + t * (a2 - a1), x1 + t * (x2 - x1)
    return None


def restroom_symbols(places, symbols_path):
    """[(deck, a, x, g)] with g = 'm' / 'w' / '' (unknown)."""
    out = []
    if symbols_path and symbols_path != '-':
        sym = json.load(open(symbols_path))
        for d, lst in sym.items():
            for a, x, w, h, tag, n, fill in lst:
                big, sm = max(w, h), min(w, h)
                if tag == 'path' and 1.8 < big < 4.6 and sm > 0 and 2.2 < big / sm < 3.4 and 200 < n < 450:
                    out.append((int(d), r1(a), r1(x), 'm' if n > 320 else 'w'))
    known = [(int(d), r[0], r[1]) for d, rs in places['restrooms'].items() for r in rs]
    for d, a, x in known:
        if not any(s[0] == d and math.hypot(s[1] - a, s[2] - x) < 1 for s in out):
            out.append((d, a, x, ''))
    return out, known


def dedupe(symbols):
    """Group symbols a few metres apart into one restroom: [(deck, a, x, g, members)]."""
    groups = []
    for s in sorted(symbols):
        for g in groups:
            if g[0][0] == s[0] and any(math.hypot(m[1] - s[1], m[2] - s[2]) < PAIR for m in g):
                g.append(s); break
        else:
            groups.append([s])
    out = []
    for g in groups:
        gs = ''.join(sorted(set(m[3] for m in g)))
        out.append((g[0][0], r1(sum(m[1] for m in g) / len(g)), r1(sum(m[2] for m in g) / len(g)), gs, g))
    return out


def main(paths_file, places_file, symbols_file, out_file):
    src = json.load(open(paths_file))
    places = load_module(places_file)
    banks = places['banks']
    stairs = [list(s[:3]) + [s[3], False, ''] for s in places['stairs']]
    stairs += [[e['a'], e['x'], e['decks'], 'stair', bool(e.get('q')), e.get('why', '')] for e in src.get('extraStairs', [])]
    report = []
    decks = {}
    for d, spec in src['decks'].items():
        D = Deck(int(d))
        for p in spec['paths']:
            ids = [D.node(a, x, p['k']) for a, x in p['p']]
            for i, j in zip(ids, ids[1:]):
                D.edge(i, j, bool(p.get('q')), p['k'])
        D.split_all()
        decks[int(d)] = D

    lobbies = {}
    for bk, b in banks.items():
        lobbies[bk] = {}
        for d in b['decks']:
            D = decks.get(d)
            if not D:
                report.append('deck %d has no paths but bank %s serves it' % (d, bk)); continue
            pn, _ = D.attach(b['a'], b['port'], 'lobby', '%s lobby port d%d' % (bk, d))
            sn, _ = D.attach(b['a'], b['starboard'], 'lobby', '%s lobby starboard d%d' % (bk, d))
            lobbies[bk][str(d)] = [pn, sn]
    stair_out = []
    for s in stairs:
        a, x, dl, kind, q, why = s
        nodes = []
        for d in dl:
            D = decks.get(d)
            n = D.attach(a, x, 'stair', 'stair (%.1f, %.1f) %s d%d' % (a, x, dl, d))[0] if D else None
            nodes.append(n)
        row = [a, x, dl, nodes, kind]
        if q:
            row.append('?')
            report.append('uncertain stair (%.1f, %.1f) decks %s: %s' % (a, x, dl, why))
        stair_out.append(row)

    syms, known = restroom_symbols(places, symbols_file)
    rooms = dedupe(syms)
    for d, a, x, g in [(e['deck'], e['a'], e['x'], e.get('g', '')) for e in src.get('extraRestrooms', [])]:
        rooms.append((d, a, x, g, [(d, a, x, g)]))
    rest_out = defaultdict(list)
    for d, a, x, g, members in rooms:
        n, dist = decks[d].attach(a, x, None, 'restroom d%d (%.1f, %.1f)' % (d, a, x))
        row = [a, x, n, g or 'mw?']
        if str(d) in src.get('restroomNotes', {}):
            row.append('kids')
        rest_out[str(d)].append(row)
        new = [m for m in members if not any(k[0] == m[0] and math.hypot(k[1] - m[1], k[2] - m[2]) < 1 for k in known)]
        if new:
            report.append('restroom symbol(s) not in places-HM.js: ' + ', '.join('d%d (%.1f, %.1f) %s' % m for m in new))

    # Drop straight-through nodes (degree 2, collinear, same certainty) that nothing refers to.
    keep = defaultdict(set)
    for bk in lobbies:
        for d, ns in lobbies[bk].items():
            keep[int(d)].update(n for n in ns if n is not None)
    for s in stair_out:
        for d, n in zip(s[2], s[3]):
            if n is not None:
                keep[d].add(n)
    for d in rest_out:
        keep[int(d)].update(r[2] for r in rest_out[d] if r[2] is not None)
    for d, D in decks.items():
        simplify(D, keep[d])

    # Kinds, ids, output
    out_decks = {}
    for d in sorted(decks):
        D = decks[d]
        deg = defaultdict(int)
        for i, j in D.edges:
            deg[i] += 1; deg[j] += 1
        used = sorted(set(i for e in D.edges for i in e) | set(i for i in range(len(D.pts)) if D.kind[i] in ('lobby', 'stair')))
        kinds = []
        for i in range(len(D.pts)):
            k = D.kind[i]
            if k not in ('lobby', 'stair'):
                k = 'deadend' if deg[i] == 1 else 'junction' if deg[i] >= 3 else k
            kinds.append(k)
        # lobby centre on each bank line counts as lobby
        for i, (a, x) in enumerate(D.pts):
            if abs(x) < 0.6 and any(abs(a - banks[b]['a']) < 0.6 and d in banks[b]['decks'] for b in banks):
                kinds[i] = 'lobby'
        remap = {o: n for n, o in enumerate(used)}
        nodes = [[remap[i], r1(D.pts[i][0]), r1(D.pts[i][1]), kinds[i][0]] for i in used]
        cor = sorted([remap[i], remap[j]] + (['?'] if q else []) for (i, j), q in D.edges.items() if D.ek[(i, j)] == 'corridor')
        opn = sorted([remap[i], remap[j]] + (['?'] if q else []) for (i, j), q in D.edges.items() if D.ek[(i, j)] != 'corridor')
        edges = cor + opn
        out_decks[str(d)] = {'nodes': nodes, 'edges': edges, 'nc': len(cor)}
        D.remap = remap
        # connectivity per deck (certain edges only, then with '?')
        for label, allow in (('certain', False), ('all', True)):
            parent = list(range(len(used)))
            def f(i):
                while parent[i] != i:
                    parent[i] = parent[parent[i]]; i = parent[i]
                return i
            for e in edges:
                if allow or len(e) == 2:
                    parent[f(e[0])] = f(e[1])
            comps = defaultdict(list)
            for n in nodes:
                comps[f(n[0])].append(n)
            for c in comps.values():
                if not any(n[3] in ('l', 's') for n in c):
                    report.append('deck %d (%s edges): component with no lobby or stair: %s' % (d, label, [(n[1], n[2]) for n in c][:4]))
        for line in D.log:
            report.append('deck %d: %s' % (d, line))
    rm = lambda d, n: decks[int(d)].remap.get(n) if n is not None else None
    for bk in lobbies:
        for d in lobbies[bk]:
            lobbies[bk][d] = [rm(d, n) for n in lobbies[bk][d]]
    for s in stair_out:
        s[3] = [rm(d, n) for d, n in zip(s[2], s[3])]
    for d in rest_out:
        for r in rest_out[d]:
            r[2] = rm(d, r[2])

    data = {'ship': src['ship'], 'unit': 'm',
            'kinds': {'c': 'corridor', 'j': 'junction', 'l': 'lobby', 's': 'stair', 'd': 'deadend', 'o': 'open'},
            'lobbies': lobbies, 'stairs': stair_out, 'restrooms': dict(rest_out), 'decks': out_decks}
    body = json.dumps(data, separators=(',', ':'))
    with open(out_file, 'w', encoding='utf-8') as fh:
        fh.write('// Generated by tools/shipmap/build_walkways.py from tools/shipmap/%s and places-%s.js. Do not edit by hand.\n'
                 '// Per deck: nodes [id, a, x, kind] (metres; kind is the first letter of corridor, junction, lobby,\n'
                 '// stair, deadend, open: see `kinds`)\n'
                 '// and edges [from, to] (walkable straight segment; third field \'?\' = uncertain); the first `nc`\n'
                 '// edges are cabin corridors, the rest public rooms / open deck / lobbies.\n'
                 '// stairs [a, x, decks, node per deck, kind(, \'?\')]; lobbies {bank: {deck: [port node, starboard node]}};\n'
                 '// restrooms {deck: [[a, x, node, m|w|mw(, \'kids\')]]} (men\'s + women\'s symbols a few metres apart = one).\n'
                 % (paths_file.split('/')[-1], src['ship']))
        fh.write('module.exports = ' + body + ';\n')
    nn = sum(len(v['nodes']) for v in out_decks.values()); ne = sum(len(v['edges']) for v in out_decks.values())
    nq = sum(1 for v in out_decks.values() for e in v['edges'] if len(e) > 2)
    print('%s: %d decks, %d nodes, %d edges (%d uncertain), %d restrooms from %d symbols, %d bytes' % (
        out_file, len(out_decks), nn, ne, nq, len(rooms), len(syms), len(body) + 400))
    for line in report:
        print('  ' + line)


if __name__ == '__main__':
    main(*sys.argv[1:5])
