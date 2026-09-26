"""Ship frame shared with extract_cabins.py / extract_places.py (same rules, same numbers).

frame(decks, length_m) -> (A, X, info, scale)
  A(d, y) = metres aft of the bow, X(d, x) = metres from the centreline (negative = port)
and the inverse helpers svgY(d, a), svgX(d, x) for drawing over rendered plans.
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_cabins import elevator_banks  # noqa: E402


def load_decks(svg_dir):
    decks = {}
    for f in os.listdir(svg_dir):
        m = re.fullmatch(r'deck-(\d+)\.svg', f)
        if m:
            decks[int(m.group(1))] = open(os.path.join(svg_dir, f), encoding='utf-8').read()
    return decks


class Frame:
    def __init__(self, decks, length_m):
        info = {}
        for d, svg in decks.items():
            vb = list(map(float, re.search(r'viewBox="([^"]*)"', svg).group(1).split()))
            info[d] = {'vb': vb, 'banks': elevator_banks(svg)}
        gap = next(i['banks'][1] - i['banks'][0] for i in info.values() if i['banks'][0] is not None)
        for d in sorted(info):
            f, a = info[d]['banks']
            if f is None and a is not None:
                f = a - gap
            if f is None:
                below = max(k for k in info if k < d and info[k].get('fwd') is not None)
                f = info[below]['fwd'] + (info[d]['vb'][1] - info[below]['vb'][1])
            info[d]['fwd'] = f
        ref = max(info, key=lambda d: info[d]['vb'][3])
        self.scale = length_m / (info[ref]['vb'][3] - 4.0)
        self.bow_to_fwd = (info[ref]['fwd'] - (info[ref]['vb'][1] + 2.0)) * self.scale
        self.gap_m = gap * self.scale
        self.info = info

    def A(self, d, y):
        return (y - self.info[d]['fwd']) * self.scale + self.bow_to_fwd

    def X(self, d, x):
        v = self.info[d]['vb']
        return (x - (v[0] + v[2] / 2)) * self.scale

    def svgY(self, d, a):
        return (a - self.bow_to_fwd) / self.scale + self.info[d]['fwd']

    def svgX(self, d, x):
        v = self.info[d]['vb']
        return x / self.scale + v[0] + v[2] / 2
