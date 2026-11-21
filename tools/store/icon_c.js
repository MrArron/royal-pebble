// Concept C icon variants for Royal Pebble: a Pebble Time 2 whose screen
// shows a ship (docs/STORE_READINESS.md D2). Drawn as SVG and rendered with
// Playwright's Chromium, so curves stay smooth at 80 px.
//
//   c1-original-icon: the Android app's launcher icon
//     (android/app/src/main/res/drawable/ic_launcher.xml), unchanged, on the
//     watch screen.
//   c2-smooth-waves:  the same ship riding filled, layered waves.
//   c3-bow-on:        the ship heading toward the viewer, bow first, on
//     those waves (the owner's pick of C2, 2026-11-21).
//   c4-bow-on-simple: C3 reshaped after a photo of a Royal Caribbean bow the
//     owner sent: a narrower hull, a taller rounded superstructure under
//     wide bridge wings, and fewer, bigger details so it reads at phone size.
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


// Bow-on: symmetric about x = 50. Funnel, wide bridge wings, two decks of
// windows, a flared hull narrowing to the stem, a bow wave at the waterline.
const C3 = watch(`
  <defs><linearGradient id="sky3" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0A2F70"/><stop offset="1" stop-color="#1257B8"/>
  </linearGradient>
  <linearGradient id="hull3" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#D9E3EF"/><stop offset="0.5" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D9E3EF"/>
  </linearGradient></defs>
  <rect x="28" y="20" width="44" height="60" fill="url(#sky3)"/>
  <circle cx="63" cy="29" r="3.6" fill="#F2B705" fill-opacity="0.9"/>
  <path fill="#F2B705" d="M45.5,33 h9 l-0.8,8 h-7.4 z"/>
  <rect x="45.5" y="35" width="9" height="1.4" fill="#0B3D91"/>
  <rect x="33" y="41" width="34" height="3.6" rx="0.8" fill="#FFFFFF"/>
  <rect x="35" y="42.1" width="30" height="1.3" fill="#0B3D91"/>
  <path fill="url(#hull3)" d="M37,44.6 h26 v8 h-26 z"/>
  ${[46.5, 49.8].map(y => [39.5, 43, 46.5, 50, 53.5, 57, 60.5].map(x =>
    `<rect x="${x - 0.8}" y="${y}" width="1.6" height="1.6" fill="#0B3D91"/>`).join('')).join('')}
  ${waveBand(64, 2.2, 11, -4, '#4FC3F7', 0.55)}
  <path fill="url(#hull3)" d="M31,52.6 H69 Q66,63 52.5,71.5 H47.5 Q34,63 31,52.6 Z"/>
  <path fill="none" stroke="#0B3D91" stroke-width="1.1" d="M31.6,54.2 H68.4"/>
  <path fill="none" stroke="#B8C6D8" stroke-width="0.5" d="M50,55 V71"/>
  ${waveBand(68.5, 2.4, 12, -9, '#4FC3F7', 0.9)}
  <path fill="#FFFFFF" fill-opacity="0.9" d="M40,70.5 q5,-3.5 10,-1 q5,-2.5 10,1 q-5,1.2 -10,0.4 q-5,0.8 -10,-0.4 z"/>
  ${waveBand(74, 2.2, 13, -2, '#1E88E5', 1)}`);

// Bow-on, simple: big shapes only. Symmetric about x = 50.
const C4 = watch(`
  <defs><linearGradient id="sky4" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0A2F70"/><stop offset="1" stop-color="#1A63C4"/>
  </linearGradient></defs>
  <rect x="28" y="20" width="44" height="60" fill="url(#sky4)"/>
  <rect x="49" y="24" width="2" height="6" fill="#FFFFFF"/>
  <path fill="#F2B705" d="M45.5,28 h9 l-0.6,5 h-7.8 z"/>
  <path fill="#FFFFFF" d="M38.5,57 V40 Q38.5,33.5 45,33.5 H55 Q61.5,33.5 61.5,40 V57 Z"/>
  <rect x="31.5" y="38" width="37" height="4.2" rx="1" fill="#FFFFFF"/>
  <rect x="33.5" y="39.4" width="33" height="1.6" rx="0.5" fill="#0B3D91"/>
  <circle cx="45" cy="47" r="1.5" fill="#0B3D91"/>
  <circle cx="50" cy="47" r="1.5" fill="#0B3D91"/>
  <circle cx="55" cy="47" r="1.5" fill="#0B3D91"/>
  <circle cx="47.5" cy="52" r="1.5" fill="#0B3D91"/>
  <circle cx="52.5" cy="52" r="1.5" fill="#0B3D91"/>
  ${waveBand(66, 2.4, 12, -6, '#4FC3F7', 0.6)}
  <path fill="#FFFFFF" d="M34,55 Q50,59 66,55 Q63,66 51.5,74 H48.5 Q37,66 34,55 Z"/>
  <path fill="none" stroke="#0B3D91" stroke-width="1.6" stroke-linecap="round" d="M35,57.3 Q50,61.3 65,57.3"/>
  <path fill="#FFFFFF" d="M41,72.5 q4.5,-3 9,-0.8 q4.5,-2.2 9,0.8 q-4.5,1.4 -9,0.6 q-4.5,0.8 -9,-0.6 z"/>
  ${waveBand(73.5, 2.4, 14, -3, '#1E88E5', 1)}`);

const VARIANTS = [['c1-original-icon', C1], ['c2-smooth-waves', C2], ['c3-bow-on', C3], ['c4-bow-on-simple', C4]];

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
  await page.setViewportSize({ width: 1180, height: 470 });
  await page.setContent(`<html><body style="margin:0;background:#f5f6f8">${VARIANTS.map(cell).join('')}</body></html>`);
  await page.screenshot({ path: path.join(OUT, 'c-variants-sheet.png') });
  await browser.close();
  console.log('Wrote', VARIANTS.length, 'variants to', path.normalize(OUT));
})();
