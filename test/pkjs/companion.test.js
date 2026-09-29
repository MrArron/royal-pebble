// The phone companion (src/pkjs/index.js) run against a fake Pebble and phone
// storage: what it records in the usage log. Run: node test/pkjs/companion.test.js
// Made-up data only.
var assert = require('assert');
var path = require('path');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

// A fresh companion: {handlers, store, sent, opened, flushTimers()}.
function companion(initial) {
  var store = {};
  Object.keys(initial || {}).forEach(function(k) { store[k] = initial[k]; });
  var timers = [];
  var c = {store: store, sent: [], opened: [], handlers: {}};
  global.localStorage = {
    getItem: function(k) { return k in store ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
    removeItem: function(k) { delete store[k]; }
  };
  global.setTimeout = function(fn) { timers.push(fn); };
  global.Pebble = {
    addEventListener: function(n, f) { c.handlers[n] = f; },
    sendAppMessage: function(m, ok) { c.sent.push(m); ok(); },
    openURL: function(u) { c.opened.push(u); },
    getActiveWatchInfo: function() {
      return {model: 'pebble_time_2', platform: 'emery', firmware: {major: 4, minor: 9, patch: 0, suffix: ''}};
    }
  };
  var dir = path.join(__dirname, '../../src/pkjs/');
  Object.keys(require.cache).forEach(function(k) {
    if (k.indexOf(dir) === 0) {
      delete require.cache[k];
    }
  });
  require('../../src/pkjs/index');
  c.run = function() {
    while (timers.length) {
      timers.shift()();
    }
  };
  c.log = function() {
    c.run();
    var saved = JSON.parse(store.usageLog || '{"entries":[]}');
    return saved.entries.map(function(e) { return e[3] + '  ' + e[4]; });
  };
  return c;
}

function has(lines, re) {
  return lines.some(function(l) { return re.test(l); });
}

test('start-up and a watch sync are logged with the watch and the send', function() {
  var c = companion();
  c.handlers.ready();
  c.handlers.appmessage({payload: {msg_type: 10}});
  var lines = c.log();
  assert.ok(has(lines, /^phone  companion started .*watch pebble_time_2 firmware 4\.9\.0/), lines.join('\n'));
  assert.ok(has(lines, /^sync  watch asked for data$/));
  assert.ok(has(lines, /^slice  demo \d+, day -?\d+, \d+ events, \d+ alerts, \d+ messages, built in \d+ ms, sent in \d+ ms, about \d+ bytes$/),
            lines.join('\n'));
});

test('the watch storage report is logged only when it changes', function() {
  var c = companion();
  var report = {msg_type: 14, saved_cutoff: -1, saved_bytes: 193, saved_max: 1048576};
  c.handlers.appmessage({payload: report});
  c.handlers.appmessage({payload: report});
  report.saved_bytes = 4314;
  c.handlers.appmessage({payload: report});
  var lines = c.log().filter(function(l) { return /^watch  storage/.test(l); });
  assert.deepStrictEqual(lines, ['watch  storage: schedule uses 193 of 1048576 bytes',
                                 'watch  storage: schedule uses 4314 of 1048576 bytes']);
});

test('watch log entries are added at the watch time, and a full queue is reported', function() {
  var pack = require('../../src/pkjs/pack');
  var c = companion();
  var at = Math.floor(Date.now() / 1000) - 3600;
  var bytes = pack.encodeLogEntry({at: at, code: 4, x: 1, a: 1, b: -1, c: 5})
    .concat(pack.encodeLogEntry({at: at + 5, code: 11, x: 0, a: 0, b: 0, c: 0}));
  c.handlers.appmessage({payload: {msg_type: 18, log_entries: bytes, log_dropped: 3}});
  c.run();
  var saved = JSON.parse(c.store.usageLog).entries;
  var button = saved.filter(function(e) { return e[3] === 'button'; })[0];
  assert.strictEqual(button[0], at * 1000);
  assert.strictEqual(button[4], 'Up on Home (NEXT)');
  var lines = c.log();
  assert.ok(has(lines, /^connection  watch: phone connection lost$/), lines.join('\n'));
  assert.ok(has(lines, /^error  watch log queue was full: 3 oldest entries lost$/), lines.join('\n'));
});

test('settings page: opened, closed, setting changes and log settings', function() {
  var c = companion();
  c.handlers.showConfiguration();
  assert.strictEqual(c.opened.length, 1);
  var result = {action: 'save', theme: 'dark', reminderLead: 30, reserveAlertAt: 1200, units: 'ft',
                me: {stateroom: '1234', deck: '', stairs: '', muster: '', clockNote: ''},
                usage: {on: true, label: 'Test watch', clear: false}};
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify(result))});
  var lines = c.log();
  assert.ok(has(lines, /^settings  page opened: \d+ KB URL, built in \d+ ms, log \d+ of \d+ entries shown$/), lines.join('\n'));
  assert.ok(has(lines, /^settings  page closed: save, result 0 KB$/));
  assert.ok(has(lines, /^log  device label: "" -> "Test watch"$/));
  assert.ok(has(lines, /^setting  theme: \(none\) -> "dark"$/), lines.join('\n'));
  assert.ok(has(lines, /^setting  me\.stateroom: \(none\) -> "1234"$/));
  assert.ok(has(lines, /^setting  reminderLead: \(none\) -> 30$/));
  assert.strictEqual(JSON.parse(c.store.settingsPage).pending, false);

  // The next page carries the log and the header with the label.
  c.handlers.showConfiguration();
  var html = decodeURIComponent(c.opened[1].slice('data:text/html;charset=utf-8,'.length));
  assert.ok(html.indexOf('Royal Pebble usage log') !== -1);
  assert.ok(html.indexOf('Device: Test watch') !== -1);
  assert.ok(html.indexOf('setting  theme: (none) -> \\"dark\\"') !== -1);
});

// A saved cruise on Harmony (made-up), sailing yesterday.
function savedCruise() {
  var d = new Date(Date.now() - 24 * 3600 * 1000);
  var iso = d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' +
    (d.getDate() < 10 ? '0' : '') + d.getDate();
  return {format: 'cruise-watch', v: 1, generated: new Date().toISOString(), ship: {code: 'HM', name: 'Harmony of the Seas'},
          sailDate: iso, itinerary: [{day: 1, date: iso, port: 'Test Port', type: 'EMBARK', arrive: null, depart: '16:00'}],
          schedule: {published: false, cats: [], venues: [], fields: [], events: []}};
}

test('map check: a watch flag saves a note once; problems found are counted; the page edits them', function() {
  var directory = require('../../src/pkjs/directory');
  var c = companion({bundle: JSON.stringify(savedCruise()),
                     settings: JSON.stringify({me: {stateroom: '9254', deck: 'Deck 9'}})});
  var list = directory.places('HM');
  var ref = directory.REF_PLACE + list.indexOf(list.filter(function(v) { return v.name === 'Studio B'; })[0]);
  c.handlers.appmessage({payload: {msg_type: 15, dir_ref: directory.REF_FLAG + ref}});
  c.handlers.appmessage({payload: {msg_type: 15, dir_ref: directory.REF_FLAG + ref}});  // a retry
  var notes = JSON.parse(c.store.mapNotes);
  assert.strictEqual(notes.length, 1);
  assert.deepStrictEqual([notes[0].type, notes[0].place, notes[0].ship, notes[0].start],
                         ['flag', 'Studio B', 'HM', 'stateroom']);
  assert.ok(/^FROM YOUR CABIN /.test(notes[0].shown), notes[0].shown);
  // The watch got the page that says so.
  var sent = c.sent[c.sent.length - 1];
  assert.strictEqual(sent.dir_ref, directory.REF_FLAG + ref);
  // A route with no way there, twice: one note, counted.
  c.handlers.appmessage({payload: {msg_type: 16, route_start: 2000, route_venue: 'Nowhere Lounge'}});
  c.handlers.appmessage({payload: {msg_type: 16, route_start: 2000, route_venue: 'Nowhere Lounge'}});
  notes = JSON.parse(c.store.mapNotes);
  assert.deepStrictEqual(notes.map(function(n) { return [n.type, n.count]; }), [['flag', undefined], ['found', 2]]);
  var lines = c.log();
  assert.ok(has(lines, /^map  flagged on the watch: Studio B \(page showed FROM YOUR CABIN .*\), start: stateroom$/),
            lines.join('\n'));
  assert.strictEqual(lines.filter(function(l) { return /^map  found by the app: Nowhere Lounge/.test(l); }).length, 1);

  // The settings page shows them and saves the answers.
  c.handlers.showConfiguration();
  var html = decodeURIComponent(c.opened[0].slice('data:text/html;charset=utf-8,'.length));
  assert.ok(html.indexOf('"mapCheck":{"ship":"HM"') !== -1);
  assert.ok(html.indexOf('"id":"starbucks-deck"') !== -1);
  var edits = {};
  edits[notes[0].id] = {note: 'Test note'};
  edits['c:starbucks-deck'] = {answer: 'app right', deck: 5};
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify({action: 'save',
    mapCheck: {ship: 'HM', clear: false, notes: edits, added: [{place: 'Test Stairs', note: 'Closed'}]}}))});
  notes = JSON.parse(c.store.mapNotes);
  assert.deepStrictEqual(notes.map(function(n) { return n.type; }), ['flag', 'found', 'answer', 'added']);
  assert.strictEqual(notes[0].note, 'Test note');
  lines = c.log();
  assert.ok(has(lines, /^map  note c:starbucks-deck: answer "app right", deck 5$/), lines.join('\n'));
  assert.ok(has(lines, /^map  note added: place "Test Stairs", note "Closed"$/), lines.join('\n'));
});

test('map check: flags while the watch shows the demo are marked; problems found are not saved', function() {
  var directory = require('../../src/pkjs/directory');
  var c = companion();
  c.handlers.appmessage({payload: {msg_type: 15, dir_ref: directory.REF_FLAG + directory.REF_BANK}});
  c.handlers.appmessage({payload: {msg_type: 16, route_start: 2000, route_venue: 'Nowhere Lounge'}});
  var notes = JSON.parse(c.store.mapNotes);
  assert.deepStrictEqual(notes.map(function(n) { return [n.type, n.place, n.demo]; }),
                         [['flag', 'Fore elevators', true]]);
});

test('backing out saves nothing and is logged; turning the log off stops it', function() {
  var c = companion();
  c.handlers.showConfiguration();
  c.handlers.webviewclosed({response: ''});
  assert.ok(has(c.log(), /^settings  page closed without saving$/));
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify({action: 'save', usage: {on: false}}))});
  var n = c.log().length;
  c.handlers.appmessage({payload: {msg_type: 10}});
  var lines = c.log();
  assert.strictEqual(lines.length, n, 'nothing added while off');
  assert.strictEqual(lines[lines.length - 1], 'log  turned off');
});

test('a big page that never came back makes the next one smaller', function() {
  // A full log, and a last page of 1.5 MB that returned nothing.
  var entries = [];
  var t = Date.now() - 86400000;
  for (var i = 0; i < 4000; i++) {
    entries.push([t + i * 1000, null, null, 'pad', 'entry ' + i + ' ' + new Array(150).join('y')]);
  }
  var c = companion({
    usageLog: JSON.stringify({on: true, label: '', entries: entries, dropped: 0}),
    settingsPage: JSON.stringify({pending: true, urlKB: 1500, shrink: 0})
  });
  c.handlers.showConfiguration();
  var url = c.opened[0];
  assert.ok(url.length <= 900 * 1024, 'kept under half the limit: ' + Math.round(url.length / 1024) + ' KB');
  var lines = c.log();
  assert.ok(has(lines, /^error  last settings page \(1500 KB\) returned nothing; this one is kept under 900 KB$/));
  var opened = lines.filter(function(l) { return /^settings  page opened/.test(l); })[0];
  var m = /log (\d+) of (\d+) entries shown/.exec(opened);
  assert.ok(+m[1] > 0 && +m[1] < +m[2], opened);
  var html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
  assert.ok(html.indexOf('entry 3999 ') !== -1, 'newest kept');
  assert.strictEqual(html.indexOf('entry 0 '), -1, 'oldest left out');
  assert.strictEqual(JSON.parse(c.store.settingsPage).shrink, 1);
});

// savedCruise() with the schedule fields a pasted bundle needs.
function usableCruise() {
  var b = savedCruise();
  b.schedule.fields = ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'];
  return b;
}

function paste(c, bundle) {
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify({action: 'save', bundle: bundle}))});
  return JSON.parse(c.store.bundle);
}

test('login data (mine) is kept when the same sailing comes again without it', function() {
  var old = usableCruise();
  old.mine = {stateroom: '1234', arrival: '11:30',
              orders: [{title: 'Beach Day', category: 'pt_shoreX', date: old.sailDate, time: '09:00', day: 1}]};
  var c = companion({bundle: JSON.stringify(old)});
  var saved = paste(c, usableCruise());
  assert.deepStrictEqual(saved.mine, old.mine);
  assert.ok(has(c.log(), /^bundle  pasted: ship HM, same sailing, .*, login data kept$/), c.log().join('\n'));

  // A bundle with its own mine replaces it.
  var fresh = usableCruise();
  fresh.mine = {stateroom: '5678', arrival: null};
  assert.deepStrictEqual(paste(c, fresh).mine, fresh.mine);

  // Another sailing doesn't take it.
  var other = usableCruise();
  other.sailDate = '2030-01-05';
  other.itinerary[0].date = other.sailDate;
  assert.strictEqual(paste(c, other).mine, undefined);
  assert.ok(!has(c.log(), /new sailing.*login data kept/));
});

test('a result the Pebble app already decoded is read as it is', function() {
  // Android hands the result over decoded: a note holding "%41" must stay.
  var b = usableCruise();
  b.schedule.notes = [['kbyg/x', 'Save 50%41 today']];
  var c = companion();
  c.handlers.webviewclosed({response: JSON.stringify({action: 'save', bundle: b})});
  assert.deepStrictEqual(JSON.parse(c.store.bundle).schedule.notes, b.schedule.notes);
  // An encoded result (the emulator) still works.
  b.schedule.notes = [['kbyg/x', 'Plain']];
  assert.deepStrictEqual(paste(c, b).schedule.notes, b.schedule.notes);
});

test('script errors in a handler are logged, then thrown', function() {
  var c = companion();
  global.Pebble.openURL = function() { throw new Error('boom'); };
  assert.throws(function() { c.handlers.showConfiguration(); }, /boom/);
  assert.ok(has(c.log(), /^error  showConfiguration: boom$/));
});

// A fake Royal for downloads: the shared made-up login fixture plus a one-day
// sailing. opts: {login: status, fail: [paths]}. Returns the requests' paths.
function fakeRoyal(token, opts) {
  opts = opts || {};
  var fs = require('fs');
  var fixtures = path.join(__dirname, '..', 'fixtures');
  var replies = JSON.parse(fs.readFileSync(path.join(fixtures, 'login-HM-sample.json'), 'utf8')).replies;
  replies['/v3/ships/HM/sailDate/20270306'] = {payload: {sailingInfo: [{itinerary: {events: [
    {day: 1, port: {portName: 'Port Canaveral', portCode: 'PCN', portType: 'EMBARK',
                    arrivalDateTime: '20270306T000000', departureDateTime: '20270306T163000'}}]}}]}};
  replies['/v3/products'] = {payload: {products: [{productType: {productType: 'NON_REVENUE_SCHEDULABLE'},
    productTitle: 'Trivia', productID: 'P1', productLocation: {locationCode: 'ONAIR', locationTitle: 'On Air'},
    offering: [{offeringDate: '20270306', offeringTime: '2000', offeringDurationInMinutes: '45'}]}]}};
  var paths = [];
  global.XMLHttpRequest = function() {
    var x = this;
    var p;
    x.open = function(method, url) {
      p = url.split('?')[0].replace(/^https:\/\/[^/]+/, '').replace('/en/royal/web/commerce-api', '')
        .replace('/en/royal/web', '');
    };
    x.setRequestHeader = function() {};
    x.send = function() {
      paths.push(p);
      if (/access_token$/.test(p)) {
        x.status = opts.login || 200;
        x.responseText = JSON.stringify(x.status === 200 ? {access_token: token} : {error: 'invalid_grant'});
      } else if (p in replies && (opts.fail || []).indexOf(p) === -1) {
        x.status = 200;
        x.responseText = JSON.stringify(replies[p]);
      } else {
        x.status = 404;
        x.responseText = '{}';
      }
      x.onload();
    };
  };
  return paths;
}

test('download with login: saves mine; the login never reaches storage, the log or the page', function() {
  var EMAIL = 'made.up.guest@example.com';
  var PASSWORD = 'Secret#Pass&1%41';
  var b64 = function(o) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, ''); };
  var TOKEN = b64({alg: 'none'}) + '.' + b64({sub: 'ACC1'}) + '.tokensignature';
  var c = companion();
  c.handlers.ready();
  var paths = fakeRoyal(TOKEN);
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify({action: 'download-login',
    download: {ship: {code: 'HM', name: 'Harmony of the Seas'}, sailDate: '2027-03-06'},
    login: {email: EMAIL, password: PASSWORD}}))});
  var lines = c.log();
  assert.ok(/access_token$/.test(paths[0]), paths.join(' '));
  assert.ok(has(lines, /^settings  page closed: download-login, result 0 KB$/), lines.join('\n'));
  assert.ok(has(lines, /^download  asked for HM 2027-03-06 with login$/));
  assert.ok(has(lines, /^download  login download: ok, booking found: 2 purchases \(1 timed\), 2 port days$/),
            lines.join('\n'));
  assert.ok(has(lines, /^bundle  downloaded with login: ship HM, new sailing/));
  var bundle = JSON.parse(c.store.bundle);
  assert.strictEqual(bundle.mine.muster, 'Z9');
  assert.strictEqual(bundle.mine.orders.length, 2);
  c.handlers.showConfiguration();
  var everything = JSON.stringify(c.store) + c.opened.join('') + decodeURIComponent(c.opened.join(''));
  [EMAIL, PASSWORD, encodeURIComponent(PASSWORD), 'tokensignature', TOKEN].forEach(function(secret) {
    assert.strictEqual(everything.indexOf(secret), -1, 'leaked: ' + secret);
  });
});

test('download with login: a refused sign-in saves nothing; no booking keeps the sailing', function() {
  var c = companion();
  fakeRoyal('x', {login: 401});
  var result = {action: 'download-login', download: {ship: {code: 'HM', name: 'Harmony'}, sailDate: '2027-03-06'},
                login: {email: 'made.up.guest@example.com', password: 'wrong'}};
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify(result))});
  assert.strictEqual(c.store.bundle, undefined);
  assert.ok(/didn't accept that email and password/.test(JSON.parse(c.store.status).error));
  assert.ok(has(c.log(), /^download  FAILED after \d+ ms: Royal Caribbean didn't accept/));

  var b64 = function(o) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, ''); };
  fakeRoyal(b64({}) + '.' + b64({sub: 'ACC1'}) + '.s', {fail: ['/v1/profileBookings/enriched/ACC1']});
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify(result))});
  assert.strictEqual(JSON.parse(c.store.bundle).mine, undefined);
  var status = JSON.parse(c.store.status);
  assert.strictEqual(status.title, 'Booking details not downloaded');
  assert.ok(/^Your sailing downloaded, but your booking details didn't: /.test(status.error), status.error);
  assert.ok(has(c.log(), /^download  login download: failed: /));

  // Without the login action, the login fields are ignored: a plain download.
  var paths = fakeRoyal('x');
  result.action = 'download';
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify(result))});
  assert.ok(paths.every(function(p) { return !/access_token/.test(p); }), paths.join(' '));
});


// Voice (1.5.9): "I'm at" is set by Select, kept in phone storage, used by later
// routes, logged, and cleared by Forget where I am. Cabin 8200 is made up.
test('voice: the spoken start is set on Select, survives a restart and is forgotten', function() {
  var c = companion({bundle: JSON.stringify(savedCruise()), settings: JSON.stringify({me: {stateroom: '8200'}})});
  c.handlers.ready();
  function ask(seq, text) {
    c.sent.length = 0;
    c.handlers.appmessage({payload: {msg_type: 19, voice_seq: seq, voice_text: text, voice_state: 0}});
    c.run();
    var m = c.sent.filter(function(x) { return x.msg_type === 20; })[0];
    var b = m.voice_card;
    return {action: b[0], ref: b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24)};
  }
  function route(ref) {
    c.handlers.appmessage({payload: {msg_type: 16, dir_ref: ref, route_rest: 0}});
    c.run();
  }
  var card = ask(1, "I'm at the solarium");
  assert.strictEqual(card.action, 2, 'confirm');
  assert.strictEqual(c.store.spokenStart, undefined, 'nothing set before Select');
  c.handlers.appmessage({payload: {msg_type: 19, voice_seq: 1}});
  var sp = JSON.parse(c.store.spokenStart);
  assert.strictEqual(sp.venue, 'Solarium');
  var lines = c.log();
  assert.ok(has(lines, /^voice  turn 1 heard "I'm at the solarium" -> SET_LOCATION A=Solarium \(exact\): confirm setting start Solarium/),
            lines.join('\n'));
  assert.ok(has(lines, /^voice  turn 1 confirmed on the watch: start set to Solarium for 90 min$/), lines.join('\n'));
  // A later route starts there, also after the phone script restarts.
  var to = ask(2, 'how do I get to the windjammer');
  route(to.ref);
  assert.ok(has(c.log(), /^route  to place \d+: "Windjammer Marketplace", FROM SOLARIUM, .*start: said "I'm at" Solarium at/),
            c.log().join('\n'));
  var store = JSON.parse(JSON.stringify(c.store));
  c = companion(store);
  c.handlers.ready();
  route(to.ref);
  assert.ok(has(c.log(), /FROM SOLARIUM/), 'kept in phone storage');
  // "From X to Y" routes from X for that route only; "I'm at X, ..." sets X when the route opens (D4).
  var from = ask(3, 'from the boardwalk to the windjammer');
  route(from.ref);
  assert.ok(has(c.log(), /"Windjammer Marketplace", FROM BOARDWALK, .*start: said in the question: Boardwalk/), c.log().join('\n'));
  assert.strictEqual(JSON.parse(c.store.spokenStart).venue, 'Solarium', 'not set by "from"');
  var both = ask(4, "I'm at the boardwalk. How do I get to the solarium");
  route(both.ref);
  assert.strictEqual(JSON.parse(c.store.spokenStart).venue, 'Boardwalk');
  assert.ok(has(c.log(), /^voice  turn 4 route opened: start set to Boardwalk for 90 min$/), c.log().join('\n'));
  // Forget where I am.
  assert.strictEqual(ask(5, 'forget where I am').action, 2);
  c.handlers.appmessage({payload: {msg_type: 19, voice_seq: 5}});
  assert.strictEqual(c.store.spokenStart, undefined);
  assert.ok(has(c.log(), /^voice  turn 5 confirmed on the watch: start Boardwalk cleared \(Forget where I am\)$/));
  // A start that has ended is removed and logged when next read.
  c.store.spokenStart = JSON.stringify({sail: sp.sail, at: sp.at - 91, name: 'Solarium', venue: 'Solarium'});
  ask(6, 'how do I get to the windjammer');
  assert.strictEqual(c.store.spokenStart, undefined);
  assert.ok(has(c.log(), /^voice  start Solarium ended \(90 min\)$/), c.log().join('\n'));
});

test('settings: Help > Try a voice phrase answers on the phone and shows next time', function() {
  var c = companion({bundle: JSON.stringify(savedCruise()), settings: JSON.stringify({me: {stateroom: '8200'}})});
  c.handlers.showConfiguration();
  var result = {action: 'save', me: {stateroom: '8200'}, usage: {on: true, label: '', clear: false},
                voiceTest: "I'm at the solarium"};
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify(result))});
  var saved = JSON.parse(c.store.voiceTest);
  assert.strictEqual(saved.lines[1], 'YOU\'RE AT  Solarium');
  assert.strictEqual(c.store.spokenStart, undefined, 'a test sets nothing');
  assert.ok(has(c.log(), /^voice  test on the phone: heard "I'm at the solarium" -> SET_LOCATION A=Solarium \(exact\) \(YOU'RE AT Solarium/),
            c.log().join('\n'));
  c.handlers.showConfiguration();
  var html = decodeURIComponent(c.opened[1].slice('data:text/html;charset=utf-8,'.length));
  assert.ok(html.indexOf('Try a voice phrase') !== -1);
  assert.ok(html.indexOf('Routes start here for 90 min') !== -1, 'the last card is on the page');
});

var failed = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('ok   ' + t.name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + t.name + '\n     ' + (e.stack || e));
  }
});
console.log(tests.length - failed + '/' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
