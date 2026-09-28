// Unit tests for the phone's schedule producer. Run: node test/pkjs/royal.test.js
// test/fixtures holds public products trimmed from a live Harmony pull
// (2026-10-01 sailing); tools/cruise-sync/test_cruise_sync.py checks the sync
// tool against the same expected schedule, so the two producers can't drift.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var royal = require('../../src/pkjs/royal');

var FIXTURES = path.join(__dirname, '..', 'fixtures');
var PRODUCTS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'products-HM-sample.json'), 'utf8'));
var EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected-schedule.json'), 'utf8'));

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

function schedule(products, pageSize) {
  var acc = royal.newScheduleAcc();
  for (var i = 0; i < products.length; i += pageSize || products.length) {
    royal.addProducts(acc, {payload: {products: products.slice(i, i + (pageSize || products.length))}});
  }
  return royal.finishSchedule(acc);
}

function product(extra) {
  var p = {productType: {productType: 'NON_REVENUE_SCHEDULABLE'}, productTitle: 'Trivia', productID: 'P1',
           productLocation: {locationCode: 'ONAIR', locationTitle: 'On Air'},
           offering: [{offeringDate: '20261002', offeringTime: '1400', offeringDurationInMinutes: '45'}]};
  Object.keys(extra || {}).forEach(function(k) { p[k] = extra[k]; });
  return p;
}

test('shared fixture gives the expected schedule, in pages too', function() {
  assert.deepStrictEqual(schedule(PRODUCTS), EXPECTED);
  assert.deepStrictEqual(schedule(PRODUCTS, 7), EXPECTED);
});

test('summary line', function() {
  assert.strictEqual(royal.scheduleSummary(EXPECTED),
    '51 events (9 shore excursion sessions): 18 with age limits, 23 arrive early, 25 with notes');
});

test('age restriction wordings', function() {
  assert.deepStrictEqual(royal.restrictionAge('Minimum 18 years old'), [18, null]);
  assert.deepStrictEqual(royal.restrictionAge('Maximum 17 years old'), [null, 17]);
  assert.deepStrictEqual(royal.restrictionAge('13 to 17 years old'), [13, 17]);
  assert.strictEqual(royal.restrictionAge('Guests 16 and under must be accompanied by a parent or guardian'), null);
  assert.strictEqual(royal.restrictionAge('Children 12 years old and under must be  supervised by parent'), null);
});

test('age patterns in titles and venues', function() {
  assert.deepStrictEqual(royal.textAge('After-Party With Resident DJ (18+)'), [18, null]);
  assert.deepStrictEqual(royal.textAge('Karaoke: Teens (13-17)'), [13, 17]);
  assert.deepStrictEqual(royal.textAge('Social100 (Ages 13-17)'), [13, 17]);
  assert.deepStrictEqual(royal.textAge('Junior Cruisers Curfew (17 & Under)'), [null, 17]);
  assert.deepStrictEqual(royal.textAge('Hideaway Beach (Adults-Only) — Day Pass'), [18, null]);
  assert.strictEqual(royal.textAge('Family Movie: "Shrek" (PG)'), null);
  assert.strictEqual(royal.textAge('Adventure Ocean Theater'), null);
  assert.strictEqual(royal.textAge(''), null);
});

test('the tightest age wins; fun for all ages and over-21 advisements set none', function() {
  assert.deepStrictEqual(royal.ageOf(product({
    restrictions: [{restrictionType: 'age', restrictionDisplayText: 'Minimum 13 years old'},
                   {restrictionType: 'age', restrictionDisplayText: 'Maximum 17 years old'}]
  }), 'Teen Open House (13-17)', 'Social100 (Ages 13-17)'), [13, 17]);
  assert.deepStrictEqual(royal.ageOf(product({experiences: [{experienceID: 'ages/age18'}]}), 'Quest', ''),
                         [18, null]);
  assert.deepStrictEqual(royal.ageOf(product({
    restrictions: [{restrictionType: 'age', restrictionDisplayText: 'Minimum 18 years old'}]
  }), 'Show (21+)', ''), [21, null]);
  assert.strictEqual(royal.ageOf(product({
    experiences: [{experienceID: 'ages/funforall'}],
    advisements: [{advisementID: 'kbyg/general/over21', advisementTitle: 'Guests purchasing alcohol must be of legal age'}]
  }), 'Family Bingo', 'Adventure Ocean Theater'), null);
});

test('arrive early: lead time, then advisement text, capped', function() {
  var o = {offeringTime: '2000'};
  var a15 = [{advisementTitle: 'Arrive 15 minutes early'}];
  assert.strictEqual(royal.earlyOf(product({productDuration: {leadTimeInMinutes: 10}, advisements: a15}), o), 10);
  assert.strictEqual(royal.earlyOf(product({productDuration: {leadTimeInMinutes: 0}, advisements: a15}), o), 15);
  assert.strictEqual(royal.earlyOf(product({productDuration: {leadTimeInMinutes: 200}}), o), 120);
  assert.strictEqual(royal.earlyOf(product({advisements: [{advisementTitle: 'Sign up at the venue 15 minutes ' +
    'before the activity starts'}]}), o), 15);
  assert.strictEqual(royal.earlyOf(product({advisements: [{advisementTitle: 'Doors are open for guests with ' +
    'reservations 45 minutes prior to show time.'}, {advisementTitle: 'Early arrival is recommended'}]}), o), null);
  assert.strictEqual(royal.earlyOf(product({productDuration: {leadTimeInMinutes: 10}}), {offeringTime: '0000'}), null);
});

test('arrive early: a shore excursion meets before its start', function() {
  var p = product({productType: {productType: 'SHOREX'}, productDuration: {leadTimeInMinutes: 30}});
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '0900', meetingTime: '0845'}), 15);
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '1400', meetingTime: '0700'}), 240);
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '0900', meetingTime: '0900'}), null);
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '0900', meetingTime: null}), null);
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '0000', meetingTime: '2345'}), null);
});

test('notes: boilerplate, long and repeated text left out; waiver added once', function() {
  var long = new Array(122).join('x');
  var notes = royal.notesOf(product({
    productShortDescription: 'Trivia',
    restrictions: [{restrictionType: 'age', restrictionID: 'age/min', restrictionDisplayText: 'Minimum 18 years old'},
                   {restrictionType: 'age', restrictionID: 'age/13guardian',
                    restrictionDisplayText: 'Children 12 years old and under must be  supervised'}],
    advisements: [{advisementID: 'kbyg/general/IMAGEILLUS', advisementTitle: 'Images are illustrative only'},
                  {advisementID: 'kbyg/general/FEE', advisementTitle: 'This activity has a fee'},
                  {advisementID: 'kbyg/fee-applies', advisementTitle: 'Fee applies'},
                  {advisementID: 'legal', advisementTitle: long},
                  {advisementID: 'kbyg/Children12', advisementTitle: 'Children 12 years old and under must be supervised'},
                  {advisementID: 'kbyg/seapass', advisementTitle: 'Please bring your SeaPass®'}],
    isWaiverRequired: true
  }), 'Trivia');
  assert.deepStrictEqual(notes, [
    ['age/13guardian', 'Children 12 years old and under must be supervised'],
    ['kbyg/seapass', 'Please bring your SeaPass'],
    ['waiver', 'Signed waiver required']]);
  assert.deepStrictEqual(royal.notesOf(product({
    advisements: [{advisementID: 'kbyg/flowrdr/WARNDISCLAIM', advisementTitle: 'Signed warning disclaimer required'}],
    isWaiverRequired: true
  }), 'Trivia'), [['kbyg/flowrdr/WARNDISCLAIM', 'Signed warning disclaimer required']]);
});

test('short descriptions kept only when they say more than the title', function() {
  function short(title, text) {
    return royal.notesOf(product({productShortDescription: text}), title).length === 1;
  }
  assert.ok(short('Dance Fitness', "Dance Fitness with your Cruise Director's Staff (Meet by the Car)"));
  assert.ok(short('Effective Fat Burning', 'Seminar: Burn Fat Fast'));
  assert.ok(short('World’s Sexiest Man Competition: Adults (18+)', "World's Sexiest Man Competition:Sign Ups"));
  assert.ok(!short('Celebrity Heads', 'Game: Celebrity Heads'));
  assert.ok(!short('Game Show: The Crazy Quest- Adults (18+)', 'Adult Game Show: The Quest'));
  assert.ok(!short('Guess the Weight of the Sculpture', 'Guess the Weight of the Sculpture Competition'));
  assert.ok(!short('Knockout Basketball Competition', 'Basketball Knockout Competition'));
  assert.ok(!short('Pure-Form Pilates', 'Pure Form Pilates'));
});

test('a product without the new data gets no info, and null codes and ids', function() {
  var s = schedule([product({productID: null, productLocation: {locationTitle: 'On Air'}})]);
  assert.deepStrictEqual(s.venues, ['On Air']);
  assert.deepStrictEqual(s.venueCodes, [null]);
  assert.deepStrictEqual(s.notes, []);
  assert.deepStrictEqual(s.infos, []);
  assert.deepStrictEqual(s.events[0].slice(10), [null, null]);
});

test('venues are told apart by code; excursions get their own category and are paid', function() {
  var s = schedule([
    product({productLocation: {locationCode: 'VINT', locationTitle: null}}),
    product({productTitle: 'Bingo', productLocation: {locationCode: null, locationTitle: ''}}),
    product({productTitle: 'Kayak', productType: {productType: 'SHOREX'},
             productCategory: [{categoryName: 'shorex', childCategory: [{items: {categoryName: 'PCC'}}]}],
             productLocation: {locationCode: 'PCC', locationTitle: 'Perfect Day CocoCay'},
             offering: [{offeringDate: '20261002', offeringTime: '0900', meetingTime: '0845'}]})]);
  assert.deepStrictEqual(s.venues, ['', '', 'Perfect Day CocoCay']);
  assert.deepStrictEqual(s.venueCodes, ['VINT', null, 'PCC']);
  assert.deepStrictEqual(s.cats[s.events[0][2]], ['Shore excursions', '']);
  assert.deepStrictEqual(s.events[0].slice(8, 11), [1, null, 0]);
  assert.deepStrictEqual(s.infos[0], [null, 15, []]);
});

// ---- Download with login: a fake XMLHttpRequest answering from the shared
// made-up login fixture (the same replies test_cruise_sync.py uses).
var LOGIN = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'login-HM-sample.json'), 'utf8'));
var EXPECTED_MINE = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected-mine.json'), 'utf8'));
var AUTH = {'Access-Token': 't', 'account-id': 'ACC1', 'vds-id': 'ACC1'};
var SAIL = '2027-03-06';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    .replace(/=+$/, '');
}
var TOKEN = b64url({alg: 'none'}) + '.' + b64url({sub: 'ACC1', name: 'x'}) + '.sig';

// Installs a fake XHR. opts: {fail: [paths], login: {status, body}}. Returns
// the calls: [{method, path, query, headers, body}].
function fakeRoyal(opts) {
  opts = opts || {};
  var calls = [];
  var extra = {};
  extra['/v3/ships/HM/sailDate/20270306'] = {payload: {sailingInfo: [{itinerary: {events: [
    {day: 1, port: {portName: 'Port Canaveral', portCode: 'PCN', portType: 'EMBARK',
                    arrivalDateTime: '20270306T000000', departureDateTime: '20270306T163000'}}]}}]}};
  extra['/v3/products'] = {payload: {products: [product({productTitle: 'Beach Day', productID: 'X1',
    productType: {productType: 'SHOREX'}, productLocation: {}, offering: [
      {offeringDate: '20270309', offeringTime: '0900', meetingTime: '0845', offeringDurationInMinutes: '150'}]})]}};
  global.XMLHttpRequest = function() {
    var x = this;
    var call = {headers: {}};
    x.open = function(method, url) {
      var q = url.indexOf('?');
      call.method = method;
      call.query = q === -1 ? '' : url.slice(q + 1);
      call.path = (q === -1 ? url : url.slice(0, q)).replace(royal.API + '/en/royal/web/commerce-api', '')
        .replace(royal.API + '/en/royal/web', '').replace(royal.API, '');
    };
    x.setRequestHeader = function(k, v) { call.headers[k] = v; };
    x.send = function(body) {
      call.body = body;
      calls.push(call);
      var reply;
      if (/oauth2\/access_token$/.test(call.path)) {
        reply = opts.login || {status: 200, body: {access_token: TOKEN}};
      } else if ((opts.fail || []).indexOf(call.path) !== -1) {
        reply = {status: 404, body: {}};
      } else if (call.path in extra) {
        reply = {status: 200, body: extra[call.path]};
      } else if (call.path in LOGIN.replies) {
        reply = {status: 200, body: LOGIN.replies[call.path]};
      } else {
        reply = {status: 404, body: {}};
      }
      x.status = reply.status;
      x.responseText = JSON.stringify(reply.body);
      x.onload();
    };
  };
  return calls;
}

function mineOf(sched, opts) {
  var calls = fakeRoyal(opts);
  var got = null;
  royal.fetchMine(AUTH, LOGIN.ship, LOGIN.date8, sched, function(err, mine) { got = {err: err, mine: mine}; });
  got.calls = calls;
  return got;
}

test('login data: the shared fixture gives the expected mine, gently', function() {
  var r = mineOf(null);
  assert.strictEqual(r.err, null);
  assert.deepStrictEqual(r.mine, EXPECTED_MINE);
  var paths = r.calls.map(function(c) { return c.path; });
  assert.strictEqual(paths.indexOf('/calendar/v1/HM/orderHistory/O9'), -1);  // cancelled: never fetched
  var catalog = r.calls.filter(function(c) { return /\/catalog\//.test(c.path); });
  assert.strictEqual(catalog.length, 1);
  assert.ok(/(^|&)startDate=2027-03-06(&|$)/.test(catalog[0].query), catalog[0].query);
  assert.strictEqual(r.calls.length, 7);
  r.calls.forEach(function(c) {
    assert.strictEqual(c.method, 'GET');
    assert.strictEqual(c.headers['Access-Token'], 't');
    assert.strictEqual(c.headers['account-id'], 'ACC1');
  });
});

test('login data: public meeting times save the catalog call; parts fail softly', function() {
  var sched = schedule([product({productType: {productType: 'SHOREX'}, productTitle: 'Beach Day', productID: 'X1',
    productLocation: {}, offering: [
      {offeringDate: '20270309', offeringTime: '0900', meetingTime: '0845', offeringDurationInMinutes: '150'},
      {offeringDate: '20270309', offeringTime: '1300', meetingTime: '1230', offeringDurationInMinutes: '150'}]})]);
  var r = mineOf(sched);
  assert.strictEqual(r.calls.length, 6);
  assert.deepStrictEqual(r.mine.orders[0], {title: 'Beach Day', category: 'pt_shoreX', guests: 3,
    date: '2027-03-09', time: '09:00', day: 4, port: 'PCC', meet: '08:45', minutes: 150});
  r = mineOf(null, {fail: ['/v3/ships/voyages/HM20270306/enriched',
                           '/catalog/v2/HM/categories/pt_shoreX/products/O2P']});
  assert.ok(r.mine.voyageError);
  assert.strictEqual(r.mine.ports, undefined);
  assert.strictEqual(r.mine.orders[0].time, '09:00');
  assert.strictEqual(r.mine.orders[0].meet, undefined);
  r = mineOf(null, {fail: ['/calendar/v1/HM/orderHistory']});
  assert.ok(r.mine.ordersError);
  assert.deepStrictEqual(r.mine.orders, []);
  assert.strictEqual(royal.mineSummary(r.mine), 'booking found: 0 purchases (0 timed), 2 port days, purchases skipped');
});

test('login data: no booking for the sailing is an error', function() {
  var calls = fakeRoyal();
  var err = null;
  royal.fetchMine(AUTH, 'HM', '20270307', null, function(e) { err = e; });
  assert.ok(/no booking/.test(err));
  assert.strictEqual(calls.length, 1);
});

test('login data: time spellings like the sync tool', function() {
  [['2027-03-09T07:05:00', '07:05'], ['20270309T173000', '17:30'], ['7:00 AM', '07:00'], ['12:15 pm', '12:15'],
   ['12:15 AM', '00:15'], ['17:30', '17:30'], ['1730', '17:30'], ['5:30 p.m.', '17:30'], ['', null], [null, null],
   ['see planner', null], ['2575', null]].forEach(function(c) {
    assert.strictEqual(royal.hhmm(c[0]), c[1], c[0]);
  });
  assert.strictEqual(royal.accountOf(TOKEN), 'ACC1');
  assert.strictEqual(royal.accountOf('nope'), null);
});

test('sign-in: the password is sent once, encoded; refusals read plainly', function() {
  var tricky = 'a#b&c%d+e=f?g/h i:' + String.fromCharCode(233);
  var calls = fakeRoyal();
  var got = null;
  royal.login('me@example.com', tricky, function(err, auth) { got = {err: err, auth: auth}; });
  assert.deepStrictEqual(got.auth, {'Access-Token': TOKEN, 'account-id': 'ACC1', 'vds-id': 'ACC1'});
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.ok(/^Basic /.test(calls[0].headers.Authorization));
  assert.strictEqual(calls[0].body, 'grant_type=password&username=me%40example.com&password=' +
    encodeURIComponent(tricky) + '&scope=openid+profile+email+vdsid');
  [[{status: 400, body: {error: 'invalid_grant'}}, /didn't accept that email and password/],
   [{status: 403, body: {}}, /refused the sign-in \(403\)/],
   [{status: 500, body: {}}, /^Sign-in failed \(error 500\)\.$/],
   [{status: 200, body: {access_token: 'garbled'}}, /couldn't read the login token/]].forEach(function(c) {
    fakeRoyal({login: c[0]});
    var e = null;
    royal.login('me@example.com', 'pw', function(err) { e = err; });
    assert.ok(c[1].test(e), e);
  });
});

test('download with login: signs in first, then the sailing, then mine', function() {
  var calls = fakeRoyal();
  var got = null;
  royal.downloadWithLogin({code: 'HM', name: 'Harmony of the Seas'}, SAIL, 'me@example.com', 'pw',
                          function(err, bundle, mineErr) { got = {err: err, bundle: bundle, mineErr: mineErr}; });
  assert.strictEqual(got.err, null);
  assert.strictEqual(got.mineErr, null);
  assert.ok(/oauth2/.test(calls[0].path));
  assert.strictEqual(calls[1].path, '/v3/ships/HM/sailDate/20270306');
  assert.strictEqual(got.bundle.schedule.events.length, 1);
  // The public listing had the excursion's meeting time and length: no catalog call.
  assert.strictEqual(calls.filter(function(c) { return /catalog/.test(c.path); }).length, 0);
  assert.strictEqual(got.bundle.mine.orders[0].meet, '08:45');
  assert.strictEqual(got.bundle.mine.stateroom, EXPECTED_MINE.stateroom);
  assert.strictEqual(royal.mineSummary(got.bundle.mine), 'booking found: 2 purchases (1 timed), 2 port days');

  // A refused sign-in downloads nothing.
  calls = fakeRoyal({login: {status: 401, body: {}}});
  royal.downloadWithLogin({code: 'HM', name: 'Harmony'}, SAIL, 'me@example.com', 'bad',
                          function(err, bundle) { got = {err: err, bundle: bundle}; });
  assert.ok(got.err && !got.bundle);
  assert.strictEqual(calls.length, 1);

  // No booking: the sailing still downloads, without mine.
  fakeRoyal({fail: ['/v1/profileBookings/enriched/ACC1']});
  royal.downloadWithLogin({code: 'HM', name: 'Harmony'}, SAIL, 'me@example.com', 'pw',
                          function(err, bundle, mineErr) { got = {err: err, bundle: bundle, mineErr: mineErr}; });
  assert.strictEqual(got.err, null);
  assert.ok(got.mineErr);
  assert.strictEqual(got.bundle.mine, undefined);
});

var failed = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('ok   ' + t.name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + t.name + '\n     ' + e.message);
  }
});
console.log(failed ? failed + ' failed' : 'all ' + tests.length + ' passed');
process.exitCode = failed ? 1 : 0;
