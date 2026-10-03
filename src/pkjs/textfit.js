// Text budgets per watch (docs/WATCH_PROTOCOL.md, Text budgets). The phone
// words what the watch draws, so the wording lives here and not in the watch's
// C code: the Pebble Time 2 (emery) keeps today's text, the Pebble Round 2
// (gabbro) gets shorter text that fits its 168 px column inside the circle
// (docs/mockups/round/NOTES.md). Widths are estimates in characters per line
// from Gothic Bold's average glyph (about 5.8 px at 14, 7 at 18, 8 at 24),
// checked on the emulator; the watch still wraps and ends a line with an
// ellipsis if an estimate is off.

var ELLIPSIS = '…';

// Characters per line, by font size, in the text column (the screen's width
// less the side padding). The Round 2's column is 168 px; the Time 2's 184 px.
var PLATFORMS = {
  emery: {round: false, col: {14: 32, 18: 26, 24: 22}, hintLines: 0},
  gabbro: {round: true, col: {14: 28, 18: 23, 24: 20}, hintLines: 2}
};

// The platform a watch info object names. A missing or unknown watch (the
// phone can't tell, or it's an emulator without info) is the Time 2.
function platformOf(info) {
  var p = info && info.platform;
  return p === 'gabbro' || p === 'chalk' ? 'gabbro' : 'emery';
}

function budgetOf(platform) {
  return PLATFORMS[platform] || PLATFORMS.emery;
}

// `text` broken into lines of at most `per` characters at spaces (a word
// longer than a line is cut). The watch breaks lines the same way.
function wrap(text, per) {
  var lines = [];
  var cur = '';
  String(text || '').split(/\s+/).forEach(function(word) {
    if (!word) {
      return;
    }
    while (word.length > per) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(word.slice(0, per));
      word = word.slice(per);
    }
    if (!cur) {
      cur = word;
    } else if (cur.length + 1 + word.length <= per) {
      cur += ' ' + word;
    } else {
      lines.push(cur);
      cur = word;
    }
  });
  if (cur) {
    lines.push(cur);
  }
  return lines;
}

// How many lines `text` takes at `per` characters a line.
function lineCount(text, per) {
  return wrap(text, per).length;
}

// Shorter wordings tried, in order, on a line that doesn't fit before it is cut.
var RULES = [
  [/^Same deck as /, 'Same deck: '],
  [/^Closest restroom/, 'Restroom']
];

// `text` as is when it fits in `maxLines` lines of `per` characters, else
// shortened by RULES, else cut at a word with an ellipsis so that it fits.
function fit(text, per, maxLines) {
  text = text || '';
  if (!(per > 0) || !(maxLines > 0) || lineCount(text, per) <= maxLines) {
    return text;
  }
  for (var i = 0; i < RULES.length && lineCount(text, per) > maxLines; i++) {
    text = text.replace(RULES[i][0], RULES[i][1]);
  }
  if (lineCount(text, per) <= maxLines) {
    return text;
  }
  var lines = wrap(text, per);
  var keep = lines.slice(0, maxLines);
  var last = keep[maxLines - 1];
  while (last.length + 1 > per && last.indexOf(' ') > 0) {
    last = last.slice(0, last.lastIndexOf(' '));
  }
  if (last.length + 1 > per) {
    last = last.slice(0, per - 1);
  }
  keep[maxLines - 1] = last.replace(/[ ,.;:·-]+$/, '') + ELLIPSIS;
  return keep.join(' ');
}

// What a line of `font` (14, 18 or 24) in a box `maxH` px tall holds on this
// platform: {per, lines}. `indent` is characters taken by a glyph.
function lineBudget(platform, font, maxH, lineH, indent) {
  var per = budgetOf(platform).col[font] - (indent || 0);
  return {per: per, lines: Math.max(1, Math.floor(maxH / lineH))};
}

// The voice card's hint: "Select: route to the Royal Theater" and the like
// are long for the Round 2's two short lines, so each has a short form there.
// Where a hint has two parts they go on two lines (the watch splits at " · ").
var DOT = ' · ';
var SHORT_HINTS = {};
function shorten(long, short) {
  SHORT_HINTS[long] = short;
}
var FORGET = 'Undo: “Forget where I am”';
shorten('Nothing to change. Hold Select to ask again', 'Nothing to change' + DOT + 'Hold: ask again');
shorten('On board only counts on port days', 'Counts on port days only');
shorten('Select: all-aboard alerts off for today', 'Select: alerts off today');
shorten('Select: all-aboard alerts back on', 'Select: alerts back on');
shorten('Select: route' + DOT + 'Undo: say Forget where I am', 'Select: route' + DOT + FORGET);
shorten('Saved' + DOT + 'Undo: say “Forget where I am”', 'Saved' + DOT + FORGET);
shorten('Add it on the phone: Me, Safety', 'Add it on the phone');
shorten('Select to ask again', 'Select: ask again');
shorten('Add your stateroom on the phone for walking directions', 'Add your stateroom on the phone');

// The hint for `platform`: unchanged on the Time 2; on the Round 2 a short
// form, never more than two lines of the card's small text.
function hintFor(platform, hint) {
  var b = budgetOf(platform);
  hint = hint || '';
  if (!b.round) {
    return hint;
  }
  var m = /^Select: route to /.exec(hint);
  if (m) {
    hint = 'Select: route';
  } else if (SHORT_HINTS[hint]) {
    hint = SHORT_HINTS[hint];
  }
  var per = b.col[14];
  var parts = hint.split(DOT);
  if (parts.length === 2 && parts[0].length <= per && parts[1].length <= per) {
    return hint;
  }
  return fit(hint.split(DOT).join('. '), per, b.hintLines);
}

// A card row's value on the Round 2: three lines of its bold 18 text.
function valueFor(platform, value) {
  var b = budgetOf(platform);
  return b.round ? fit(value, b.col[18], 3) : value;
}

// A voice card worded for `platform`: the hint and the row values (the Time 2's
// card is returned as it is).
function cardFor(platform, card) {
  if (!budgetOf(platform).round) {
    return card;
  }
  var out = {};
  Object.keys(card).forEach(function(k) { out[k] = card[k]; });
  out.hint = hintFor(platform, card.hint);
  out.rows = (card.rows || []).map(function(r) {
    return {label: r.label, value: valueFor(platform, r.value)};
  });
  return out;
}

module.exports = {
  ELLIPSIS: ELLIPSIS, PLATFORMS: PLATFORMS, DOT: DOT, platformOf: platformOf, budgetOf: budgetOf, wrap: wrap,
  lineCount: lineCount, fit: fit, lineBudget: lineBudget, hintFor: hintFor, valueFor: valueFor, cardFor: cardFor
};
