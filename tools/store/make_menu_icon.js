// The watchapp's launcher (menu) icon: 25x25 PNG (Pebble docs: larger is rejected by the SDK),
// the C3b ship bow-on with the coral sun, from the geometry in icon_c.js. The launcher turns
// colour into luminance grays, so the ship is white on a dark sky for contrast.
// Run: node tools/store/make_menu_icon.js  ->  resources/images/menu-icon.png
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const body = `
  <rect x="25" y="24" width="50" height="50" fill="#0A2F70"/>
  <circle cx="63" cy="31" r="4.6" fill="#FA4A36"/>
  <path fill="#F2B705" d="M45,33 h10 l-1,8 h-8 z"/>
  <rect x="32" y="41" width="36" height="4" fill="#FFFFFF"/>
  <rect x="36" y="45" width="28" height="8" fill="#FFFFFF"/>
  <path fill="#FFFFFF" d="M35,52.6 H65 Q62.5,61 52,67.5 H48 Q37.5,61 35,52.6 Z"/>
  <path fill="#4FC3F7" d="M25,63 q6,-4 12,0 t12,0 t12,0 t12,0 V74 H25 Z"/>
  <path fill="#1E88E5" d="M25,68 q6.5,-3.5 13,0 t13,0 t13,0 V74 H25 Z"/>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 25, height: 25 }, deviceScaleFactor: 1 });
  await p.setContent(`<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="25 24 50 50" shape-rendering="crispEdges">${body}</svg></body></html>`);
  await p.locator('svg').screenshot({ path: path.join(__dirname, '..', '..', 'resources', 'images', 'menu-icon.png') });
  await b.close();
})();
