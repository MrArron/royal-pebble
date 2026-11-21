// Concept C icon variants for Royal Pebble: a Pebble Time 2 whose screen
// shows a ship (docs/STORE_READINESS.md D2). Drawn as SVG and rendered with
// Playwright's Chromium, so curves stay smooth at 80 px.
//
//   c1-original-icon: the Android app's launcher icon
//     (android/app/src/main/res/drawable/ic_launcher.xml), unchanged, on the
//     watch screen.
//   c2-smooth-waves:  the same ship riding filled, layered waves.
//
// Writes store/concepts/<name>-{144,80}.png and c-variants-sheet.png.
// Run: node tools/store/icon_c.js
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', '..', 'store', 'concepts');

// The watch around the screen (100-unit grid): one button left, three right.
function watch(screen) {
  return `
  <rect width="100" height="100" rx="22" fill="#0B3D91"/>
  <rect x="17.5" y="33" width="5" height="12" rx="1.2" fill="#969EAA"/>
  <rect x="77.5" y="27" width="5" height="10" rx="1.2" fill="#969EAA"/>
  <rect x="77.5" y="43" width="5" height="10" rx="1.2" fill="#969EAA"/>
  <rect x="77.5" y="59" width="5" height="10" rx="1.2" fill="#969EAA"/>
  <rect x="21" y="12" width="58" height="76" rx="9" fill="#282C34" stroke="#5F6673" stroke-width="1.5"/>
  <clipPath id="scr"><rect x="28" y="20" width="44" height="60" rx="2.5"/></clipPath>
  <g clip-path="url(#scr)">${screen}</g>`;
}

// The Android icon's own paths (108-unit grid), background left out.
const ANDROID_SHIP = `
  <path fill="#FFFFFF" d="M30,58h48l-7,14h-34z"/>
  <path fill="#FFFFFF" d="M40,46h26v10h-26z"/>
  <path fill="#F2B705" d="M48,36h8v8h-8z"/>
  <path fill="#4FC3F7" d="M24,78c6,-4 12,-4 18,0s12,4 18,0s12,-4 18,0s6,4 6,4v4c-6,-4 -12,-4 -18,0s-12,4 -18,0s-12,-4 -18,0s-6,0 -6,0z"/>`;

const C1 = watch(`
  <rect x="28" y="20" width="44" height="60" fill="#0B3D91"/>
  <svg x="28" y="27" width="44" height="46" viewBox="22 30 64 60">${ANDROID_SHIP}</svg>`);

// A wave band: smooth crests every `w` units, filled to the bottom.
function waveBand(y, amp, w, phase, color, opacity) {
  let d = `M${20 + phase},${y}`;
  for (let x = 20 + phase; x < 84; x += w) {
    d += ` q${w / 4},${-amp} ${w / 2},0 t${w / 2},0`;
  }
  d += ' V90 H20 Z';
  return `<path d="${d}" fill="${color}" fill-opacity="${opacity}"/>`;
}

const C2 = watch(`
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0A2F70"/><stop offset="1" stop-color="#1257B8"/>
  </linearGradient></defs>
  <rect x="28" y="20" width="44" height="60" fill="url(#sky)"/>
  <circle cx="61" cy="31" r="4" fill="#F2B705" fill-opacity="0.9"/>
  <path fill="#FFFFFF" d="M34,57 h32 l-5,9 h-22 z"/>
  <rect x="40" y="49" width="20" height="8" rx="0.8" fill="#FFFFFF"/>
  <rect x="43" y="51.5" width="2.4" height="2.4" fill="#0B3D91"/>
  <rect x="48" y="51.5" width="2.4" height="2.4" fill="#0B3D91"/>
  <rect x="53" y="51.5" width="2.4" height="2.4" fill="#0B3D91"/>
  <rect x="46.5" y="42" width="6.5" height="7" fill="#F2B705"/>
  ${waveBand(65, 2.2, 11, -4, '#4FC3F7', 0.55)}
  ${waveBand(69, 2.4, 12, -9, '#4FC3F7', 0.9)}
  ${waveBand(74, 2.2, 13, -2, '#1E88E5', 1)}`);

const VARIANTS = [['c1-original-icon', C1], ['c2-smooth-waves', C2]];

function svg(body, px) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 100 100">${body}</svg>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, body] of VARIANTS) {
    for (const px of [144, 80]) {
      await page.setViewportSize({ width: px, height: px });
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg(body, px)}</body></html>`);
      await page.locator('svg').first().screenshot({ path: path.join(OUT, `${name}-${px}.png`), omitBackground: true });
    }
  }
  // Review sheet: each variant large and at both store sizes.
  const cell = ([name, body]) => `<div style="display:inline-block;margin:16px;vertical-align:top;font:600 16px sans-serif;color:#1e232d">
      ${svg(body, 256)}<br>${svg(body, 144)} ${svg(body, 80)}<br>${name}</div>`;
  await page.setViewportSize({ width: 620, height: 520 });
  await page.setContent(`<html><body style="margin:0;background:#f5f6f8">${VARIANTS.map(cell).join('')}</body></html>`);
  await page.screenshot({ path: path.join(OUT, 'c-variants-sheet.png') });
  await browser.close();
  console.log('Wrote', VARIANTS.length, 'variants to', path.normalize(OUT));
})();
