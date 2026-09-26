"""Draw the walkway graph over each rendered deck plan, bow to the right.

    python tools/shipmap/review_walkways.py decks/HM 362.1 walkways-HM.js review/

Legend: blue = cabin corridor, green = public / open deck, dashed orange = uncertain ('?'),
thick magenta = where the sides meet (transverse segment on the centreline),
red squares = elevator lobby doors, brown diamonds = stairs, black X = dead end,
purple WC = restroom (M / W / MW). Grid every 10 m (a) and 5 m (x).
Needs playwright (Chromium) and opencv-python.
"""
import json, os, re, subprocess, sys
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipframe import load_decks, Frame  # noqa: E402

K = 8          # px per SVG unit when rendering
OUT_SCALE = 0.75


def render(decks, F, out_dir):
    from playwright.sync_api import sync_playwright
    paths = {}
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        for d in sorted(decks):
            svg = decks[d]; vb = F.info[d]['vb']; w, h = int(vb[2] * K), int(vb[3] * K)
            body = svg[svg.find('<svg'):]
            body = re.sub(r'<svg\b[^>]*?>', lambda m: re.sub(r'\s(width|height)="[^"]*"', '', m.group(0)).replace(
                '<svg', '<svg width="%d" height="%d"' % (w, h), 1), body, count=1)
            pg.set_viewport_size({'width': w, 'height': min(h, 16000)})
            pg.set_content('<html><body style="margin:0;background:#fff">' + body + '</body></html>')
            fn = os.path.join(out_dir, '_plan-%d.png' % d)
            pg.screenshot(path=fn, full_page=True)
            paths[d] = fn
        b.close()
    return paths


def main(svg_dir, length, walk_js, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    decks = load_decks(svg_dir); F = Frame(decks, float(length))
    W = json.loads(subprocess.check_output(['node', '-e', 'process.stdout.write(JSON.stringify(require(process.argv[1])))',
                                            os.path.abspath(walk_js)]))
    plans = render(decks, F, out_dir)
    for d in sorted(decks):
        if str(d) not in W['decks']:
            continue
        im = cv2.imread(plans[d]); os.remove(plans[d])
        H = im.shape[0]
        vb = F.info[d]['vb']

        def P(a, x):   # rotated image coords (bow right): col = H-1-py, row = px
            px = (F.svgX(d, x) - vb[0]) * K; py = (F.svgY(d, a) - vb[1]) * K
            return int(H - 1 - py), int(px)
        im = cv2.rotate(im, cv2.ROTATE_90_CLOCKWISE)
        im = cv2.addWeighted(im, 0.55, np.full_like(im, 255), 0.45, 0)
        # grid
        for a in range(0, 370, 10):
            c, _ = P(a, 0)
            if 0 <= c < im.shape[1]:
                cv2.line(im, (c, 0), (c, im.shape[0]), (200, 200, 200) if a % 50 else (150, 150, 230), 1)
                cv2.putText(im, str(a), (c + 2, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (90, 90, 200), 1)
        for x in range(-25, 30, 5):
            _, r = P(0, x)
            cv2.line(im, (0, r), (im.shape[1], r), (220, 200, 220) if x else (120, 120, 120), 1)
        dk = W['decks'][str(d)]
        N = {n[0]: n for n in dk['nodes']}
        for ei, e in enumerate(dk['edges']):
            n1, n2 = N[e[0]], N[e[1]]
            p1, p2 = P(n1[1], n1[2]), P(n2[1], n2[2])
            q = len(e) > 2
            corridor = ei < dk['nc']
            da, dx = abs(n1[1] - n2[1]), abs(n1[2] - n2[2])
            crossing = dx > da and min(n1[2], n2[2]) <= 0.3 and max(n1[2], n2[2]) >= -0.3
            col = (0, 140, 255) if q else (230, 0, 230) if crossing else (200, 90, 0) if corridor else (40, 160, 40)
            th = 7 if crossing and not q else 4
            if q:
                L = max(1, int(np.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 14))
                for k in range(0, L, 2):
                    a0 = (p1[0] + (p2[0] - p1[0]) * k // L, p1[1] + (p2[1] - p1[1]) * k // L)
                    a1 = (p1[0] + (p2[0] - p1[0]) * (k + 1) // L, p1[1] + (p2[1] - p1[1]) * (k + 1) // L)
                    cv2.line(im, a0, a1, col, 4)
            else:
                cv2.line(im, p1, p2, col, th)
        for n in dk['nodes']:
            c = P(n[1], n[2])
            k = n[3]
            if k == 'l':
                cv2.rectangle(im, (c[0] - 7, c[1] - 7), (c[0] + 7, c[1] + 7), (0, 0, 220), -1)
            elif k == 's':
                cv2.drawMarker(im, c, (30, 80, 140), cv2.MARKER_DIAMOND, 18, 4)
            elif k == 'd':
                cv2.drawMarker(im, c, (0, 0, 0), cv2.MARKER_TILTED_CROSS, 16, 3)
            else:
                cv2.circle(im, c, 4, (60, 60, 60), -1)
        for r in W['restrooms'].get(str(d), []):
            c = P(r[0], r[1])
            cv2.circle(im, c, 16, (160, 0, 120), 3)
            cv2.putText(im, 'WC ' + r[3].upper().replace('?', ''), (c[0] - 22, c[1] - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (160, 0, 120), 2)
        cv2.putText(im, 'Deck %d  (bow ->)  blue corridor, green public, magenta = sides meet, dashed orange = uncertain, '
                    'red = lobby, diamond = stairs, X = dead end, WC = restroom' % d,
                    (10, im.shape[0] - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
        im = cv2.resize(im, None, fx=OUT_SCALE, fy=OUT_SCALE, interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(out_dir, 'deck-%d.png' % d), im)
        print('deck', d, im.shape)


if __name__ == '__main__':
    main(*sys.argv[1:5])
