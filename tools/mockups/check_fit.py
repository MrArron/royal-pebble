"""Render .dc.html mockups (static or with a tiny DCLogic shim), screenshot, and check text fit."""
import re, sys, json, os, glob
from playwright.sync_api import sync_playwright

SHIM = r"""
<script>
class DCLogic { constructor(p){ this.props=p||{}; this.state={}; } setState(p){ Object.assign(this.state,p); window.__rerender(); } }
function __ev(expr, ctx){ return new Function('ctx', 'with(ctx){ return (' + expr + '); }')(ctx); }
function __interp(str, ctx){ return str.replace(/\{\{([\s\S]+?)\}\}/g, (m,e)=>{ const v=__ev(e,ctx); return v==null?'':v; }); }
function __render(node, ctx, out, ns){
  if (node.nodeType===3){ out.appendChild(document.createTextNode(__interp(node.nodeValue, ctx))); return; }
  if (node.nodeType!==1) return;
  const tag=node.tagName.toLowerCase();
  if (tag==='sc-if'){ const m=node.getAttribute('value').match(/^\{\{([\s\S]+)\}\}$/); if (__ev(m[1],ctx)) for (const c of node.childNodes) __render(c,ctx,out,ns); return; }
  if (tag==='sc-for'){ const m=node.getAttribute('list').match(/^\{\{([\s\S]+)\}\}$/); const as=node.getAttribute('as');
    for (const item of __ev(m[1],ctx)) { const c2=Object.assign({},ctx,{[as]:item}); for (const c of node.childNodes) __render(c,c2,out,ns); } return; }
  const nns = (tag==='svg') ? 'http://www.w3.org/2000/svg' : ns; const el = nns ? document.createElementNS(nns, tag) : document.createElement(tag);
  for (const a of node.attributes){
    const m=a.value.match(/^\{\{([\s\S]+)\}\}$/);
    if (/^on/i.test(a.name) && m){ const f=__ev(m[1],ctx); el.addEventListener(a.name.slice(2).toLowerCase(), f); }
    else el.setAttribute(a.name, __interp(a.value, ctx));
  }
  for (const c of node.childNodes) __render(c,ctx,el,nns);
  out.appendChild(el);
}
window.__boot = function(){
  const tpl=document.getElementById('tpl'); const root=document.getElementById('root');
  const code=document.getElementById('logic').textContent;
  const Cls=new Function('DCLogic', code + '; return Component;')(DCLogic);
  const comp=new Cls({});
  window.__comp=comp;
  window.__rerender=function(){ root.innerHTML=''; const vals=comp.renderVals(); for (const c of tpl.content.childNodes) __render(c, vals, root); };
  window.__rerender();
};
</script>
"""

MEASURE = r"""
() => {
  const out=[];
  const frame=document.querySelector('#root > div');
  const fr=frame.getBoundingClientRect();
  for (const el of document.querySelectorAll('#root *')){
    const texts=[...el.childNodes].filter(n=>n.nodeType===3 && n.nodeValue.trim());
    if (!texts.length) continue;
    const r=document.createRange(); r.selectNodeContents(el);
    const rects=[...r.getClientRects()].filter(x=>x.width>0);
    if (!rects.length) continue;
    const tops=[]; for (const x of rects){ if (!tops.some(t=>Math.abs(t-x.top)<8)) tops.push(x.top); }
    const left=Math.min(...rects.map(x=>x.left)), right=Math.max(...rects.map(x=>x.right));
    const cs=getComputedStyle(el);
    out.push({text: el.textContent.trim().replace(/\s+/g,' '), size: cs.fontSize, weight: cs.fontWeight,
      lines: tops.length, left: Math.round(left-fr.left), right: Math.round(right-fr.left),
      bottom: Math.round(Math.max(...rects.map(x=>x.bottom))-fr.top),
      truncated: el.scrollWidth > el.clientWidth + 1 && cs.textOverflow==='ellipsis'});
  }
  return out;
}
"""


def build(path):
    src = open(path, encoding="utf-8").read()
    helmet = re.search(r"<helmet>([\s\S]*?)</helmet>", src).group(1)
    inner = re.search(r"</helmet>([\s\S]*?)</x-dc>", src).group(1)
    logic = re.search(r'data-dc-script[^>]*>([\s\S]*?)</script>', src).group(1)
    return (f"<!doctype html><html><head><meta charset='utf-8'>{helmet}{SHIM}</head><body>"
            f"<template id='tpl'>{inner}</template><div id='root'></div>"
            f"<script type='text/plain' id='logic'>{logic}</script></body></html>")


def main(files, shots):
    os.makedirs(shots, exist_ok=True)
    report = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 400, "height": 800})
        for f in files:
            name = os.path.basename(f).replace(".dc.html", "")
            pg.set_content(build(f), wait_until="networkidle")
            pg.evaluate("window.__boot()")
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(300)
            el = pg.query_selector("#root > div")
            el.screenshot(path=os.path.join(shots, name + ".png"))
            report[name] = pg.evaluate(MEASURE)
        b.close()
    return report


if __name__ == "__main__":
    files = sorted(glob.glob(sys.argv[1]))
    rep = main(files, sys.argv[2])
    json.dump(rep, open(os.path.join(sys.argv[2], "fit.json"), "w"), indent=1)
    for name, items in rep.items():
        print("==", name)
        for it in items:
            flag = ""
            if it["right"] > 384: flag += " OVER"
            if it["lines"] > 1: flag += f" {it['lines']}LINES"
            if it["truncated"]: flag += " TRUNC"
            if it["bottom"] > 456: flag += " BELOW"
            print(f"  {it['size']:>5} w{(it['right']-it['left'])/2:6.1f} r{it['right']/2:6.1f}{flag}  {it['text'][:60]}")
