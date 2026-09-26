#!/usr/bin/env python3
"""Find venues, elevator lobbies, stairwells and restrooms on Royal's deck-plan SVGs.

Usage: python extract_places.py <svg_dir> <ship_code> <ship_length_m> <out_dir>
Needs: playwright (Chromium), opencv-python, pytesseract + tesseract.

Venue labels on the plans are drawn as letter outlines, not text. So this
script measures every letter in the browser, groups letters into labels, reads
each label with OCR, and places it in the same ship frame as the cabins
(tools/shipmap/extract_cabins.py): a = metres aft of the bow, x = metres from the
centreline (negative = port).

Writes to out_dir:
  labels.json      every label found: deck, OCR text, confidence, a, x, size
  review/deck-N.png  each deck with numbered label boxes, to check the OCR by eye
The names are then matched to the venue table by tools/shipmap/build_places.js.
"""
import json, os, re, sys

import cv2
import numpy as np
import pytesseract
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_cabins import elevator_banks  # noqa: E402

K = 14            # pixels per SVG unit when rendering for OCR
GAP = float(os.environ.get("GAP", "0.9"))  # letters closer than 2*GAP units belong to one label
STAIR_FILL = '#E5CC93'

MEASURE = r'''() => {
  const bb = el => { const b = el.getBBox(); return [b.x, b.y, b.width, b.height]; };
  const sym = document.getElementById('SYMBOLS_AND_VENUES');
  const icons = document.getElementById('ICONS');
  const glyphs = sym ? [...sym.children].map(bb) : [];
  const iconBoxes = icons ? [...icons.children].map(bb) : [];
  const stairs = [...document.querySelectorAll('[fill="#E5CC93"],[fill="#e5cc93"]')].map(bb);
  return {glyphs, iconBoxes, stairs};
}'''


def union_boxes(boxes, gap):
    n = len(boxes)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(n):
        xi, yi, wi, hi = boxes[i]
        for j in range(i + 1, n):
            xj, yj, wj, hj = boxes[j]
            if xi - gap <= xj + wj + gap and xj - gap <= xi + wi + gap and \
               yi - gap <= yj + hj + gap and yj - gap <= yi + hi + gap:
                parent[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(boxes[i])
    out = []
    for g in groups.values():
        x0 = min(b[0] for b in g); y0 = min(b[1] for b in g)
        x1 = max(b[0] + b[2] for b in g); y1 = max(b[1] + b[3] for b in g)
        out.append({'box': [x0, y0, x1 - x0, y1 - y0], 'parts': len(g)})
    return out


def ocr(crop):
    """Best reading over the four orientations: (text, confidence)."""
    best = ('', -1.0)
    for rot in (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE, None, cv2.ROTATE_180):
        img = crop if rot is None else cv2.rotate(crop, rot)
        img = cv2.copyMakeBorder(img, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
        d = pytesseract.image_to_data(img, config='--psm 6', output_type=pytesseract.Output.DICT)
        words = [(w, float(c)) for w, c in zip(d['text'], d['conf']) if w.strip() and float(c) >= 0]
        if not words:
            continue
        text = ' '.join(w for w, _ in words)
        letters = sum(ch.isalpha() for ch in text)
        conf = sum(c for _, c in words) / len(words) * min(1.0, letters / max(1, len(text.replace(' ', ''))))
        if conf > best[1]:
            best = (text, conf)
    return best


def main():
    svg_dir, ship, length_m, out_dir = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
    os.makedirs(os.path.join(out_dir, 'review'), exist_ok=True)
    decks = {}
    for f in os.listdir(svg_dir):
        m = re.fullmatch(r'deck-(\d+)\.svg', f)
        if m:
            decks[int(m.group(1))] = open(os.path.join(svg_dir, f), encoding='utf-8').read()

    # Ship frame, same rules as extract_cabins.py.
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
    scale = length_m / (info[ref]['vb'][3] - 4.0)
    bow_to_fwd = (info[ref]['fwd'] - (info[ref]['vb'][1] + 2.0)) * scale

    def A(d, y):
        return round((y - info[d]['fwd']) * scale + bow_to_fwd, 1)

    def X(d, x):
        v = info[d]['vb']
        return round((x - (v[0] + v[2] / 2)) * scale, 1)

    labels, stairs = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        for d in sorted(decks):
            svg = decks[d]
            vb = info[d]['vb']
            w, h = int(vb[2] * K), int(vb[3] * K)
            body = svg[svg.find('<svg'):]
            body = re.sub(r'<svg\b[^>]*?>', lambda m: re.sub(r'\s(width|height)="[^"]*"', '', m.group(0))
                          .replace('<svg', '<svg width="%d" height="%d"' % (w, h), 1), body, count=1)
            page.set_viewport_size({'width': w, 'height': min(h, 16000)})
            page.set_content('<html><body style="margin:0;background:#fff">' + body + '</body></html>')
            meas = page.evaluate(MEASURE)
            # Letters only: hide everything but the label layer, then screenshot for OCR.
            page.add_style_tag(content='#DECKS,#DECK_ELEMENTS,#TEXT,#ROOM_ATTRIBUTES,#ICONS{display:none}')
            png = page.screenshot(full_page=True)
            img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_GRAYSCALE)
            review = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)

            for g in union_boxes(meas['glyphs'], GAP):
                x, y, bw, bh = g['box']
                px0, py0 = int((x - vb[0]) * K) - 6, int((y - vb[1]) * K) - 6
                px1, py1 = int((x + bw - vb[0]) * K) + 6, int((y + bh - vb[1]) * K) + 6
                crop = img[max(0, py0):py1, max(0, px0):px1]
                text, conf = ocr(crop) if crop.size else ('', -1)
                lab = {'id': len(labels), 'deck': d, 'text': text, 'conf': round(conf),
                       'a': A(d, y + bh / 2), 'x': X(d, x + bw / 2),
                       'len_m': round(bh * scale, 1), 'wide_m': round(bw * scale, 1), 'parts': g['parts']}
                labels.append(lab)
                cv2.rectangle(review, (px0, py0), (px1, py1), (0, 0, 255), 2)
                cv2.putText(review, str(lab['id']), (px0, max(12, py0 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
            for s in meas['stairs']:
                stairs.append({'deck': d, 'a': A(d, s[1] + s[3] / 2), 'x': X(d, s[0] + s[2] / 2),
                               'len_m': round(s[3] * scale, 1), 'wide_m': round(s[2] * scale, 1)})
            for ib in meas['iconBoxes']:
                if 8 <= ib[2] <= 10 and 8 <= ib[3] <= 10:   # the round venue-type badges
                    labels.append({'id': len(labels), 'deck': d, 'text': '(icon)', 'conf': 100,
                                   'a': A(d, ib[1] + ib[3] / 2), 'x': X(d, ib[0] + ib[2] / 2),
                                   'len_m': round(ib[3] * scale, 1), 'wide_m': round(ib[2] * scale, 1), 'parts': 1})
            cv2.imwrite(os.path.join(out_dir, 'review', 'deck-%d.png' % d), cv2.rotate(review, cv2.ROTATE_90_CLOCKWISE))
            print('deck %d: %d labels' % (d, sum(1 for l in labels if l['deck'] == d and l['text'] != '(icon)')))
        browser.close()

    json.dump({'ship': ship, 'scale': scale, 'banks': {'fwd': round(bow_to_fwd, 1), 'aft': round(bow_to_fwd + gap * scale, 1)},
               'labels': labels, 'stairSteps': stairs}, open(os.path.join(out_dir, 'labels.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
