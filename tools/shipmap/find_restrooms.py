"""Find restroom (person) symbols on deck-plan SVGs by the shape of their glyphs.
Prints candidates in ship metres: python tools/shipmap/find_restrooms.py decks/HM 362.1 [known.json]"""
import sys, os, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipframe import load_decks, Frame
from playwright.sync_api import sync_playwright
JS = r'''() => {
  const sym = document.getElementById('SYMBOLS_AND_VENUES');
  const out = [];
  const walk = el => { for (const c of el.children) {
     if (c.tagName === 'g') { walk(c); continue; }
     const b = c.getBBox(); const d = (c.getAttribute('d')||'') + (c.getAttribute('points')||'');
     out.push([b.x, b.y, b.width, b.height, c.tagName, d.length, c.getAttribute('fill')||getComputedStyle(c).fill]); } };
  if (sym) walk(sym);
  return out;
}'''
def main(svg_dir, length):
    decks = load_decks(svg_dir); F = Frame(decks, length)
    res = {}
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        for d in sorted(decks):
            svg = decks[d]
            pg.set_content('<html><body>' + svg[svg.find('<svg'):] + '</body></html>')
            res[d] = [[F.A(d, y + h / 2), F.X(d, x + w / 2), w * F.scale, h * F.scale, t, n, f]
                      for x, y, w, h, t, n, f in pg.evaluate(JS)]
        b.close()
    return res
if __name__ == '__main__':
    r = main(sys.argv[1], float(sys.argv[2]))
    json.dump(r, open(sys.argv[3], 'w'))
