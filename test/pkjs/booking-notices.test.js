// Booking notices (price drop, check-in, final payment): node test/pkjs/booking-notices.test.js
var assert = require('assert');
var pack = require('../../src/pkjs/pack');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

// Reads a notice back the way the watch does (src/c/comm.c decode_notices).
function decode(bytes) {
  var out = [];
  var i = 0;
  function int32() {
    var v = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) | 0;
    i += 4;
    return v;
  }
  function str() {
    var n = bytes[i++];
    var s = Buffer.from(bytes.slice(i, i + n)).toString('utf8');
    i += n;
    return s;
  }
  while (i + 9 <= bytes.length) {
    var kind = bytes[i++];
    out.push({kind: kind, from: int32(), to: int32(), title: str(), venue: str(), oldVenue: str()});
  }
  return out;
}

test('money', function() {
  assert.strictEqual(pack.money(89.5), '$89.50');
  assert.strictEqual(pack.money(20), '$20.00');
  assert.strictEqual(pack.money(99.999), '$100');
  assert.strictEqual(pack.money(1234.56), '$1,235');
  assert.strictEqual(pack.money(12355), '$12,355');
  assert.strictEqual(pack.money(0.1 + 0.2), '$0.30');
  assert.strictEqual(pack.money(-5), '-$5.00');
  assert.strictEqual(pack.money(45, '£'), '£45.00');
});

test('price drop', function() {
  var n = pack.priceDropNotice({item: 'The Key', paid: 109, now: 89});
  assert.deepStrictEqual(n, {kind: pack.NOTICE_PRICE, from: -1, to: -1, title: 'The Key',
                             venue: 'Save $20.00', oldVenue: 'Was $109 now $89.00'});
  // A big cabin drop still fits the 23-byte line.
  var cabin = pack.priceDropNotice({item: 'Balcony cabin', paid: 12355.4, now: 11235.4});
  assert.strictEqual(cabin.oldVenue, 'Was $12,355 now $11,235');
  assert.strictEqual(cabin.venue, 'Save $1,120');
  assert.ok(pack.utf8(cabin.oldVenue, 255).length <= 23);
});

test('check-in open and done', function() {
  var open = pack.checkinOpenNotice({sailing: 'Harmony of the Seas', guests: 3, done: 1});
  assert.strictEqual(open.kind, pack.NOTICE_CHECKIN_OPEN);
  assert.strictEqual(open.venue, '2 of 3 guests to go');
  assert.strictEqual(open.oldVenue, 'Check in on Royal app');
  var one = pack.checkinOpenNotice({sailing: 'Harmony of the Seas', guests: 1, done: 0, closes: '2026-12-09'});
  assert.deepStrictEqual([one.venue, one.oldVenue], ['Not checked in yet', 'Closes Dec 9']);

  var done = pack.checkinDoneNotice({sailing: 'Harmony of the Seas', boarding: '11:30 AM - 12:00 PM'});
  assert.strictEqual(done.kind, pack.NOTICE_CHECKIN_DONE);
  assert.deepStrictEqual([done.venue, done.oldVenue], ['All guests checked in', 'Boarding 11:30a-12:00p']);
  assert.strictEqual(pack.checkinDoneNotice({}).title, 'Your cruise');
  assert.strictEqual(pack.checkinDoneNotice({}).oldVenue, '');
});

test('final payment', function() {
  var d = {sailing: 'Harmony of the Seas', due: '2026-09-13', balance: 1234.56};
  function at(today) { d.today = today; return pack.paymentNotice(d); }
  assert.strictEqual(at('2026-09-08').kind, pack.NOTICE_PAYMENT);
  assert.strictEqual(at('2026-09-08').venue, '$1,235 due Sep 13');
  assert.strictEqual(at('2026-09-08').oldVenue, 'In 5 days');
  assert.strictEqual(at('2026-09-12').oldVenue, 'Due tomorrow');
  assert.strictEqual(at('2026-09-13').oldVenue, 'Due today');
  assert.strictEqual(at('2026-09-14').oldVenue, 'Overdue');
  assert.strictEqual(pack.paymentNotice({due: '2026-09-13', balance: 80}).venue, '$80.00 due Sep 13');
});

test('packed like schedule notices, read back as the watch reads them', function() {
  var notices = [
    pack.priceDropNotice({item: 'Deluxe Beverage Package (per day)', paid: 109, now: 89}),
    pack.checkinOpenNotice({sailing: 'Harmony of the Seas', guests: 2, done: 0}),
    pack.checkinDoneNotice({sailing: 'Harmony of the Seas', boarding: '11:30 AM - 12:00 PM'}),
    pack.paymentNotice({sailing: 'Harmony of the Seas', due: '2026-09-13', balance: 500, today: '2026-09-01'})
  ];
  var bytes = pack.packNotices(notices);
  assert.deepStrictEqual(bytes.slice(0, 9), [4, 255, 255, 255, 255, 255, 255, 255, 255]);
  var back = decode(bytes);
  assert.deepStrictEqual(back.map(function(n) { return n.kind; }), [4, 5, 6, 7]);
  // Titles cut to 39 bytes, lines to 23, as for schedule notices.
  assert.strictEqual(back[0].title, 'Deluxe Beverage Package (per day)');
  assert.strictEqual(back[3].venue, '$500 due Sep 13');
  assert.strictEqual(back[3].oldVenue, 'In 12 days');
  var long = pack.encodeNotice(pack.checkinOpenNotice({sailing: new Array(60).join('x'), guests: 1}));
  assert.strictEqual(long[9], 39);
  // Fits one NOTICE message (the watch's inbox is 2048 bytes) with 8 at the limits.
  var eight = [];
  for (var i = 0; i < 8; i++) {
    eight.push({kind: 4, from: -1, to: -1, title: new Array(80).join('t'), venue: new Array(40).join('v'),
                oldVenue: new Array(40).join('o')});
  }
  assert.ok(pack.packNotices(eight).length < 2048 - 64);
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
