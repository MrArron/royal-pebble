#!/usr/bin/env node
// Builds the phone's voice lexicon (src/pkjs/data/voice-<SHIP>.js) from the
// editable venue mishearings table. Run from the repo root after changing
// tools/voice/venue-mishearings-HM.json:
//   node tools/voice/build_voice.js [--report]
// test/pkjs/voice.test.js checks the output is up to date.
//
// What goes in (tools/voice/README.md):
// - every venue name and alias from src/pkjs/venues.js, and every spoken form,
//   observed form and high or medium ASR form from the table;
// - a low-likelihood form only when the runtime fuzzy matcher doesn't already
//   find the right place without it (measured here, on every build).
// Output per target: its name, its phrases squashed ("windjammer|windjam|..."),
// and flags: L = not a location (several spots), A = ashore, N = no route yet,
// B = a bar (the candidates for "closest bar"), C = coffee ("closest coffee").
// A group target is its members joined by '|' ("Arcade|Video Arcade").
'use strict';
var fs = require('fs');
var path = require('path');

var SHIPS = ['HM'];
var ROOT = path.join(__dirname, '..', '..');
var DATA_DIR = path.join(ROOT, 'src', 'pkjs', 'data');

// Phrases that must never point at a place on their own (squashed), except the
// ones allowed for one target (owner decision D3).
var GENERIC = ('a an and at to from in on for my is i iam bar bars deck room cafe shop shops store lounge theater club ' +
  'desk court gallery kitchen center wine winebar park royal main perfect adventure kids teen suite sports port harmony ' +
  'vitality regalia ocean next sure local line track').split(' ');
var GENERIC_OK = {pool: 'Pool Deck', theater: 'Royal Theater', park: 'Central Park'};
var RANK = {group: 5, name: 4, alias: 4, spoken: 4, observed: 4, high: 3, medium: 2, low: 1};

function outFile(ship) {
  return path.join(DATA_DIR, 'voice-' + ship + '.js');
}

// voice.js loads the data file; give it an empty one on the first build.
function voiceLib(ship) {
  if (!fs.existsSync(outFile(ship))) {
    fs.writeFileSync(outFile(ship), 'module.exports = {"ship":"' + ship + '","t":[],"p":[],"f":{}};\n');
  }
  return require(path.join(ROOT, 'src', 'pkjs', 'voice'));
}

// All phrases from the sources: [{text, key, target, rank, likelihood}].
function phrases(ship, table, venues, squash) {
  var out = [];
  function add(text, target, rank, likelihood) {
    out.push({text: text, key: squash(text), target: target, rank: RANK[rank], likelihood: likelihood || rank});
  }
  Object.keys(venues.venues).forEach(function(n) { add(n, n, 'name'); });
  Object.keys(venues.aliases).forEach(function(a) { add(a, venues.aliases[a], 'alias'); });
  table.forEach(function(e) {
    var t = e.kind === 'group' ? e.members.join('|') : e.target;
    var own = e.kind === 'group' ? 'group' : 'spoken';
    if (e.kind !== 'group') {
      add(e.target, t, 'name');
    }
    e.spoken.forEach(function(s) { add(s, t, own); });
    e.asr.forEach(function(a) { add(a.text, t, e.kind === 'group' ? 'group' : a.observed ? 'observed' : a.likelihood, a.likelihood); });
  });
  return out;
}

function check(table, venues) {
  var errors = [];
  var seen = {};
  table.forEach(function(e) {
    if (seen[e.target]) {
      errors.push('duplicate target ' + e.target);
    }
    seen[e.target] = true;
    var names = e.kind === 'group' ? e.members : e.kind === 'category' ? [] : [e.target];
    names.forEach(function(n) {
      if (!venues.venues[n]) {
        errors.push(e.target + ': ' + n + ' is not in venues.js');
      }
    });
  });
  Object.keys(venues.venues).forEach(function(n) {
    if (!seen[n]) {
      errors.push('no table entry for venue ' + n);
    }
  });
  return errors;
}

// key -> target, the highest rank winning; a tie between two targets is an
// error to settle in the table (usually with a group).
function assign(list, errors) {
  var best = {};
  list.forEach(function(p) {
    if (!p.key) {
      return;
    }
    var allowed = GENERIC_OK[p.key] === p.target;
    if (!allowed && (GENERIC.indexOf(p.key) !== -1 || GENERIC_OK[p.key])) {
      if (p.rank >= RANK.spoken && !GENERIC_OK[p.key]) {
        errors.push('generic phrase "' + p.text + '" for ' + p.target);
      }
      return;
    }
    var b = best[p.key];
    if (!b || p.rank > b.rank) {
      best[p.key] = {target: p.target, rank: p.rank, other: null};
    } else if (p.rank === b.rank && p.target !== b.target && b.target.split('|').indexOf(p.target) === -1) {
      b.other = p.target;
    }
  });
  Object.keys(best).forEach(function(k) {
    if (best[k].other && best[k].rank >= RANK.medium) {
      errors.push('"' + k + '" fits ' + best[k].target + ' and ' + best[k].other + ': add a group or drop one');
    }
  });
  return best;
}

function lexicon(ship, targets, keys, flags) {
  var t = targets.slice();
  var p = t.map(function() { return []; });
  Object.keys(keys).sort().forEach(function(k) {
    p[t.indexOf(keys[k])].push(k);
  });
  var f = {};
  t.forEach(function(name, i) {
    if (flags[name]) {
      f[i] = flags[name];
    }
  });
  return {ship: ship, v: 1, t: t, p: p.map(function(l) { return l.join('|'); }), f: f};
}

function build(ship, opts) {
  opts = opts || {};
  var voice = voiceLib(ship);
  var venues = require(path.join(ROOT, 'src', 'pkjs', 'venues')).builtIn(ship);
  var table = JSON.parse(fs.readFileSync(path.join(__dirname, 'venue-mishearings-' + ship + '.json'), 'utf8'));
  var errors = check(table, venues);
  var all = phrases(ship, table, venues, voice.squash);
  var best = assign(all, errors);
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
  var targets = [];
  var flags = {};
  table.forEach(function(e) {
    var t = e.kind === 'group' ? e.members.join('|') : e.target;
    targets.push(t);
    var v = venues.venues[e.target];
    flags[t] = (e.location === false ? 'L' : '') + (v && v.neighborhood === 'Ashore' ? 'A' : '') + (e.route === false ? 'N' : '') +
      (e.bar ? 'B' : '') + (e.coffee ? 'C' : '');
  });
  // Pass 1: everything but low-likelihood forms. The target's own name is
  // added by the runtime, so it isn't stored.
  var keep = {};
  Object.keys(best).forEach(function(k) {
    if (best[k].rank >= RANK.medium && k !== voice.squash(best[k].target)) {
      keep[k] = best[k].target;
    }
  });
  var lows = Object.keys(best).filter(function(k) { return best[k].rank === RANK.low; });
  var m1 = voice.makeMatcher(lexicon(ship, targets, keep, flags));
  var stats = {low: lows.length, recovered: 0, wrong: 0, missed: 0, byHow: {exact: 0, part: 0, fuzzy: 0}, keptLow: []};
  lows.forEach(function(k) {
    var text = all.filter(function(p) { return p.key === k; })[0].text;
    var r = m1(text);
    if (r && r.t === best[k].target) {
      stats.recovered++;
      stats.byHow[r.how]++;
    } else {
      stats[r ? 'wrong' : 'missed']++;
      stats.keptLow.push(text + (r ? ' (fuzzy said ' + r.t + ')' : ''));
      keep[k] = best[k].target;
    }
  });
  // A kept low form can pull a dropped one the wrong way: repeat until stable.
  var lex = lexicon(ship, targets, keep, flags);
  for (var round = 0; round < 5; round++) {
    var mr = voice.makeMatcher(lex);
    var more = lows.filter(function(k) {
      var r = !keep[k] && mr(all.filter(function(p) { return p.key === k; })[0].text);
      return !keep[k] && !(r && r.t === best[k].target);
    });
    if (!more.length) {
      break;
    }
    more.forEach(function(k) {
      keep[k] = best[k].target;
      stats.recovered--;
      stats.keptLow.push(k + ' (second round)');
    });
    lex = lexicon(ship, targets, keep, flags);
  }
  var mf = voice.makeMatcher(lex);
  stats.recovered = 0;
  stats.byHow = {exact: 0, part: 0, fuzzy: 0};
  lows.forEach(function(k) {
    if (!keep[k]) {
      stats.recovered++;
      stats.byHow[mf(all.filter(function(p) { return p.key === k; })[0].text).how]++;
    }
  });
  // Every source phrase must resolve to its target with the final lexicon.
  var m2 = voice.makeMatcher(lex);
  var bad = [];
  all.forEach(function(p) {
    var want = best[p.key] ? best[p.key].target : null;
    if (!want || want !== p.target) {
      return;  // generic, or lost to a stronger phrase (reported by assign)
    }
    var r = m2(p.text);
    if (!r || r.t !== want) {
      bad.push(p.text + ' -> ' + (r ? r.t : 'nothing') + ' (want ' + want + ')');
    }
  });
  var src = '// Generated by tools/voice/build_voice.js from tools/voice/venue-mishearings-' + ship +
    '.json and src/pkjs/venues.js. Do not edit by hand.\n' +
    '// t: targets, p: squashed phrases per target (the name itself is implied), f: flags (L not a location, A ashore, N no route, B a bar for "closest bar", C coffee for "closest coffee").\n' +
    'module.exports = ' + JSON.stringify(lex) + ';\n';
  return {src: src, lex: lex, stats: stats, bad: bad, phrases: all.length, keys: Object.keys(keep).length};
}

if (require.main === module) {
  SHIPS.forEach(function(ship) {
    var r = build(ship);
    fs.writeFileSync(outFile(ship), r.src, 'utf8');
    console.log('Wrote ' + path.relative(ROOT, outFile(ship)) + ': ' + r.src.length + ' bytes, ' + r.lex.t.length +
      ' targets, ' + r.keys + ' stored phrases (' + r.phrases + ' in the sources)');
    console.log('Low-likelihood forms: ' + r.stats.low + ', found without storing them ' + r.stats.recovered +
      ' (exact ' + r.stats.byHow.exact + ', part ' + r.stats.byHow.part + ', fuzzy ' + r.stats.byHow.fuzzy + '), kept ' +
      r.stats.keptLow.length + ' (missed ' + r.stats.missed + ', wrong place ' + r.stats.wrong + ')');
    if (process.argv.indexOf('--report') !== -1) {
      console.log('Kept low forms:\n  ' + r.stats.keptLow.join('\n  '));
    }
    if (r.bad.length) {
      console.log('NOT RESOLVING (' + r.bad.length + '):\n  ' + r.bad.join('\n  '));
      process.exitCode = 1;
    }
  });
}

module.exports = {build: build};
