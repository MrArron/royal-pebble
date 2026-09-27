// Share my plan (docs/DESIGN_PHASE3.md §28): the text one phone's settings
// page copies for a travel companion, and the comparison and merge the other
// phone's page runs on import. The format is in docs/DATA_FORMAT.md ("Shared
// plan"). shareLib is a self-contained factory so the settings page gets it as
// text (config.js buildPage); Node tests use it directly.

function shareLib() {
  var VERSION = 1;
  var START = 'RPPLAN';
  var END = ':END';
  var DAY_FIELDS = ['allAboard', 'shift', 'buffer', 'warn', 'offset', 'edit'];
  var CABIN_FIELDS = ['stateroom', 'deck', 'stairs', 'muster'];
  var RES = 'R|';

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  // Star keys worth sharing: every star, and a reserved mark only while its
  // event is starred (an unstarred event's mark is kept but not shown).
  function starList(stars) {
    var on = {};
    Object.keys(stars || {}).forEach(function(k) {
      if (stars[k]) {
        on[k] = true;
      }
    });
    return Object.keys(on).filter(function(k) {
      return k.slice(0, RES.length) !== RES || on[k.slice(RES.length)];
    }).sort();
  }

  function personalId(p) {
    return [p.title, p.date, p.time || '', p.venue || '', p.minutes || 0].join('|');
  }

  // mine: {ship, sailDate, stars: {key: true}, personal: [..], days: {date: {..}},
  // venues: {name: override}, cabin: {stateroom, deck, stairs, muster}}.
  // Cabin details go in only with `withCabin`, and only the ones that are set.
  function build(mine, withCabin) {
    var plan = {v: VERSION, ship: mine.ship, sail: mine.sailDate, stars: starList(mine.stars)};
    if ((mine.personal || []).length) {
      plan.personal = mine.personal.map(function(p) {
        return {title: p.title, venue: p.venue || '', date: p.date, time: p.time || null, minutes: p.minutes || 0};
      });
    }
    var days = {};
    Object.keys(mine.days || {}).sort().forEach(function(date) {
      var d = {};
      DAY_FIELDS.forEach(function(f) {
        if (has(mine.days[date], f) && mine.days[date][f] !== '' && mine.days[date][f] !== undefined) {
          d[f] = mine.days[date][f];
        }
      });
      if (Object.keys(d).length) {
        days[date] = d;
      }
    });
    if (Object.keys(days).length) {
      plan.days = days;
    }
    if (Object.keys(mine.venues || {}).length) {
      plan.venues = mine.venues;
    }
    if (withCabin) {
      var cabin = {};
      CABIN_FIELDS.forEach(function(f) {
        var v = String((mine.cabin || {})[f] || '').trim();
        if (v) {
          cabin[f] = v;
        }
      });
      if (Object.keys(cabin).length) {
        plan.cabin = cabin;
      }
    }
    return plan;
  }

  // What the Share card lists.
  function counts(plan) {
    var days = plan.days || {};
    var dayDates = Object.keys(days);
    return {
      stars: plan.stars.filter(function(k) { return k.slice(0, RES.length) !== RES; }).length,
      personal: (plan.personal || []).length,
      daySettings: dayDates.filter(function(d) {
        return DAY_FIELDS.some(function(f) { return f !== 'edit' && has(days[d], f); });
      }).length,
      itinerary: dayDates.filter(function(d) { return has(days[d], 'edit'); }).length,
      venues: Object.keys(plan.venues || {}).length,
      cabin: Object.keys(plan.cabin || {}).length
    };
  }

  function toBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function fromBase64(code) {
    return decodeURIComponent(escape(atob(code)));
  }

  // The message: a readable first line, how to import it, then the code.
  // `title` is the first line's middle, e.g. "Harmony · sails 3 Oct 2026".
  function encode(plan, title) {
    var n = counts(plan).stars;
    return 'Royal Pebble plan · ' + title + ' · ' + n + (n === 1 ? ' star' : ' stars') + '\n' +
      'To import it, open Royal Pebble\'s settings, tap Import plan under Share my plan and paste this whole ' +
      'message.\n' + START + VERSION + ':' + toBase64(JSON.stringify(plan)) + END;
  }

  // Finds the code in a pasted message (chat apps may wrap it or add spaces).
  // Returns {plan} or {error}, with the error as the page shows it.
  function decode(text) {
    var at = String(text || '').indexOf(START);
    if (at === -1) {
      return {error: 'No Royal Pebble plan found. Paste the whole message.'};
    }
    var rest = text.slice(at + START.length);
    var m = /^(\d+):([A-Za-z0-9+\/=\s]*)/.exec(rest);
    if (!m) {
      return {error: 'The plan is damaged. Ask for it again.'};
    }
    if (+m[1] > VERSION) {
      return {error: 'This plan comes from a newer Royal Pebble. Update the app, then paste it again.'};
    }
    if (rest.slice(m[0].length, m[0].length + END.length) !== END) {
      return {error: 'The plan is cut short. Copy the whole message and paste it again.'};
    }
    var plan;
    try {
      plan = JSON.parse(fromBase64(m[2].replace(/\s+/g, '')));
    } catch (e) {
      return {error: 'The plan is damaged. Ask for it again.'};
    }
    if (!plan || typeof plan !== 'object' || typeof plan.ship !== 'string' || typeof plan.sail !== 'string' ||
        !Array.isArray(plan.stars)) {
      return {error: 'The plan is damaged. Ask for it again.'};
    }
    plan.stars = plan.stars.filter(function(k) { return typeof k === 'string' && k.length <= 300; });
    plan.personal = Array.isArray(plan.personal) ? plan.personal : [];
    ['days', 'venues', 'cabin'].forEach(function(k) {
      if (!plan[k] || typeof plan[k] !== 'object' || Array.isArray(plan[k])) {
        plan[k] = {};
      }
    });
    return {plan: plan};
  }

  // Every difference between the receiver's plan (`mine`, as from build(mine,
  // true)) and `theirs`, in review order. Each item has a group, `def` (what
  // Accept all does: 'theirs' or 'mine') and the values. Only stars go both
  // ways: an event only the receiver starred can be unstarred. Anything else
  // only the receiver has is theirs to keep and isn't listed.
  function diff(mine, theirs) {
    var out = [];
    var myStars = {};
    mine.stars.forEach(function(k) { myStars[k] = true; });
    var theirStars = {};
    theirs.stars.forEach(function(k) { theirStars[k] = true; });
    var keys = Object.keys(myStars).concat(theirs.stars.filter(function(k) { return !myStars[k]; }));
    keys.sort(function(a, b) {
      var ea = a.slice(0, RES.length) === RES ? a.slice(RES.length) : a;
      var eb = b.slice(0, RES.length) === RES ? b.slice(RES.length) : b;
      var pa = ea.split('|');
      var pb = eb.split('|');
      var ka = pa[1] + '|' + pa[2] + '|' + ea;
      var kb = pb[1] + '|' + pb[2] + '|' + eb;
      return ka < kb ? -1 : ka > kb ? 1 : (a < b ? -1 : 1);
    });
    keys.forEach(function(k) {
      if (myStars[k] && theirStars[k]) {
        return;
      }
      var reserved = k.slice(0, RES.length) === RES;
      out.push({group: 'stars', key: k, reserved: reserved, event: reserved ? k.slice(RES.length) : k,
                theirsOnly: !myStars[k], def: myStars[k] ? 'mine' : 'theirs'});
    });
    var myPersonal = {};
    (mine.personal || []).forEach(function(p) { myPersonal[personalId(p)] = true; });
    (theirs.personal || []).forEach(function(p) {
      if (p && typeof p.title === 'string' && !myPersonal[personalId(p)]) {
        myPersonal[personalId(p)] = true;  // a duplicate in theirs is listed once
        out.push({group: 'personal', entry: p, def: 'theirs'});
      }
    });
    Object.keys(theirs.days || {}).sort().forEach(function(date) {
      var t = theirs.days[date] || {};
      var m = (mine.days || {})[date] || {};
      DAY_FIELDS.forEach(function(f) {
        if (has(t, f) && !same(t[f], m[f])) {
          out.push({group: 'days', date: date, field: f, theirs: t[f], mine: has(m, f) ? m[f] : null, def: 'theirs'});
        }
      });
    });
    Object.keys(theirs.venues || {}).sort().forEach(function(name) {
      var m = (mine.venues || {})[name];
      if (!same(theirs.venues[name], m)) {
        out.push({group: 'venues', name: name, theirs: theirs.venues[name], mine: m || null, def: 'theirs'});
      }
    });
    CABIN_FIELDS.forEach(function(f) {
      var t = String((theirs.cabin || {})[f] || '').trim();
      var m = String((mine.cabin || {})[f] || '').trim();
      if (t && t !== m) {
        out.push({group: 'cabin', field: f, theirs: t, mine: m, def: 'theirs'});
      }
    });
    return out;
  }

  // The changes to make from diff() items and the choices ('theirs' or
  // 'mine', one per item; a missing one is the item's `def`): {stars: {key:
  // bool}, personal: [entries to add], days: {date: {field: value}}, venues:
  // {name: override}, cabin: {field: value}}.
  function changes(items, choices) {
    var out = {stars: {}, personal: [], days: {}, venues: {}, cabin: {}};
    items.forEach(function(it, i) {
      var c = (choices && choices[i]) || it.def;
      if (c !== 'theirs') {
        return;
      }
      if (it.group === 'stars') {
        out.stars[it.key] = it.theirsOnly;
      } else if (it.group === 'personal') {
        out.personal.push(it.entry);
      } else if (it.group === 'days') {
        out.days[it.date] = out.days[it.date] || {};
        out.days[it.date][it.field] = it.theirs;
      } else if (it.group === 'venues') {
        out.venues[it.name] = it.theirs;
      } else if (it.group === 'cabin') {
        out.cabin[it.field] = it.theirs;
      }
    });
    return out;
  }

  return {VERSION: VERSION, DAY_FIELDS: DAY_FIELDS, CABIN_FIELDS: CABIN_FIELDS, build: build, counts: counts,
          encode: encode, decode: decode, diff: diff, changes: changes};
}

module.exports = {shareLib: shareLib, lib: shareLib()};
