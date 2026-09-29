#!/usr/bin/env node
// Measures the voice lexicon: sizes, how well the fallback copes with forms the
// table doesn't list, and false matches on phrases that aren't places.
//   node tools/voice/measure_voice.js
// Minified sizes need terser (TERSER=<path to terser module>); skipped without it.
'use strict';
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.join(__dirname, '..', '..');
var voice = require(path.join(ROOT, 'src', 'pkjs', 'voice'));
var lex = require(path.join(ROOT, 'src', 'pkjs', 'data', 'voice-HM'));
var table = JSON.parse(fs.readFileSync(path.join(__dirname, 'venue-mishearings-HM.json'), 'utf8'));

function sizes(file) {
  var src = fs.readFileSync(file, 'utf8');
  var out = {raw: src.length, gzip: zlib.gzipSync(src).length};
  if (process.env.TERSER) {
    var min = require(process.env.TERSER).minify_sync(src, {compress: true, mangle: true}).code;
    out.min = min.length;
    out.minGzip = zlib.gzipSync(min).length;
  }
  return out;
}

console.log('Sizes (bytes):');
['src/pkjs/data/voice-HM.js', 'src/pkjs/voice.js'].forEach(function(f) {
  console.log('  ' + f + ' ' + JSON.stringify(sizes(path.join(ROOT, f))));
});
var stored = lex.p.reduce(function(n, p) { return n + (p ? p.split('|').length : 0); }, 0);
console.log('  lexicon: ' + lex.t.length + ' targets, ' + stored + ' stored phrases + ' +
  lex.t.filter(function(t) { return t.indexOf('|') === -1; }).length + ' implied names');

// Leave one out: drop each stored high/medium ASR form in turn and see if the
// fallback still finds its place. Estimates how an unpredicted mishearing fares.
var forms = [];
table.forEach(function(e) {
  var t = e.kind === 'group' ? e.members.join('|') : e.target;
  e.asr.forEach(function(a) {
    if (a.likelihood !== 'low') {
      forms.push({text: a.text, key: voice.squash(a.text), target: t, observed: !!a.observed});
    }
  });
});
var loo = {n: 0, right: 0, wrong: 0, none: 0, same: 0, wrongList: []};
forms.forEach(function(f) {
  var i = lex.t.indexOf(f.target);
  var own = lex.p[i] ? lex.p[i].split('|') : [];
  if (own.indexOf(f.key) === -1) {
    loo.same++;  // not stored: squashes to another stored phrase or the name
    return;
  }
  var p = lex.p.slice();
  p[i] = own.filter(function(k) { return k !== f.key; }).join('|');
  var r = voice.makeMatcher({t: lex.t, p: p, f: lex.f})(f.text);
  loo.n++;
  if (!r) {
    loo.none++;
  } else if (r.t === f.target) {
    loo.right++;
  } else {
    loo.wrong++;
    loo.wrongList.push(f.text + ' -> ' + r.t);
  }
});
console.log('Leave one out, stored high/medium ASR forms: ' + loo.n + ' tried, fallback found ' + loo.right +
  ', wrong place ' + loo.wrong + ', nothing ' + loo.none + ' (' + loo.same + ' more need no entry of their own)');
loo.wrongList.forEach(function(w) { console.log('    wrong: ' + w); });

// Destination-shaped phrases that are not Harmony places. A match here would be
// a false match (the confirm screen still shows it before routing).
var NOT_PLACES = ['the moon', 'the titanic', 'the lobby', 'the library', 'the chapel', 'the bridge', 'the laundry',
  'the pharmacy', 'the hospital', 'the airport', 'the parking lot', 'the beach', 'the gift shop', 'the bank', 'the atm',
  'the gangway', 'the tender', 'the muster station', 'the lifeboats', 'the captain', 'the engine room', 'the kitchen',
  'the galley', 'the nightclub', 'the disco', 'the comedy club', 'the jazz club', 'the karaoke bar', 'the wine cellar',
  'the cigar lounge', 'the champagne bar', 'the bionic bar', 'sabor', 'wonderland', 'the diamond lounge', 'sugar beach',
  'the cupcake shop', 'the ice cream', 'the pizza oven', 'the burger bar', 'the steak place', 'the sushi bar',
  'the tattoo parlor', 'the salon', 'the barber', 'the sauna', 'the thermal suite', 'the yoga room', 'the tennis court',
  'the bowling alley', 'the cinema', 'the movie theater', 'the planetarium', 'the aquarium', 'the zoo', 'the mall',
  'the car', 'my car', 'the hotel', 'the train', 'the bus', 'the restaurant', 'the cafe', 'the lounge', 'the deck',
  'the pier', 'the port', 'the terminal', 'the exit', 'the entrance', 'the front', 'the back', 'the top deck',
  'the helipad', 'the bow', 'the stern', 'the crew area', 'the photo booth', 'the art auction', 'the conference room',
  'the business center', 'the internet cafe', 'the chapel of love', 'the wedding chapel', 'the pool table',
  'the dart board', 'the slot machines', 'the poker room', 'the bingo hall', 'the lost and found', 'the concierge',
  'the purser', 'my sister', 'my friends', 'mom', 'dad', 'the kids', 'somewhere quiet', 'something to eat', 'coffee',
  'a drink', 'food', 'ice cream', 'the shops', 'the bars', 'the theater district', 'the gym bag', 'the snack bar',
  'the tiki bar', 'the rum bar', 'the beer garden', 'the pub crawl', 'the water park', 'the lazy river',
  'the wave pool', 'the kiddie pool', 'the adult pool bar', 'the sports bar downstairs'];
var m = voice.matcher('HM');
var hits = NOT_PLACES.map(function(s) { var r = m(s); return r ? s + ' -> ' + r.t + ' (' + r.how + ')' : null; })
  .filter(function(x) { return x; });
console.log('Not-a-place probe: ' + NOT_PLACES.length + ' phrases, ' + hits.length + ' matched something:');
hits.forEach(function(h) { console.log('    ' + h); });
