// A whole watch session on a Pebble Round 2 (gabbro) against the same session
// on a Pebble Time 2 (android/watch/src/test/js/session.js, the scenarios the
// Android app's WatchServerSessionTest replays in QuickJS): with the watch
// info the Android app passes, the place pages, routes and voice cards are the
// round ones and everything else is the same. Run: node test/pkjs/round-session.test.js
var assert = require('assert');
var path = require('path');
var execFileSync = require('child_process').execFileSync;
var textfit = require('../../src/pkjs/textfit');

var SESSION = path.join(__dirname, '../../android/watch/src/test/js/session.js');
var MSG_DIR_PAGE = 8;
var MSG_ROUTE_PAGE = 17;
var MSG_VOICE_CARD = 20;

function run(name) {
  return JSON.parse(execFileSync(process.execPath, [SESSION, name], {maxBuffer: 64 * 1024 * 1024}).toString());
}

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var round = run('round');
var time2 = run('sailing');

test('the Android app\'s watch info names the Round 2', function() {
  assert.strictEqual(textfit.platformOf(round.spec.watch), 'gabbro');
  assert.strictEqual(textfit.platformOf({platform: 'GABBRO', model: 'My watch'}), 'gabbro');
  assert.strictEqual(textfit.platformOf({platform: 'emery', model: 'Pebble Time 2'}), 'emery');
  assert.strictEqual(textfit.platformOf(null), 'emery');
});

test('the same messages go out, in the same order', function() {
  assert.strictEqual(round.node.sent.length, time2.node.sent.length);
  round.node.sent.forEach(function(m, i) {
    assert.strictEqual(m.msg_type, time2.node.sent[i].msg_type, 'message ' + (i + 1));
  });
});

test('only pages, routes and voice cards are laid out for the round screen', function() {
  var kinds = {};
  round.node.sent.forEach(function(m, i) {
    if (JSON.stringify(m) !== JSON.stringify(time2.node.sent[i])) {
      kinds[m.msg_type] = (kinds[m.msg_type] || 0) + 1;
    }
  });
  Object.keys(kinds).forEach(function(k) {
    assert.ok([MSG_DIR_PAGE, MSG_ROUTE_PAGE, MSG_VOICE_CARD].indexOf(+k) >= 0, 'message type ' + k + ' differs');
  });
  assert.ok(kinds[MSG_DIR_PAGE] >= 1, 'a place page differs');
  assert.ok(kinds[MSG_ROUTE_PAGE] >= 3, 'routes differ');
  assert.ok(kinds[MSG_VOICE_CARD] >= 2, 'voice cards differ');
});

test('the saved data ends the same (the usage log names the watch)', function() {
  function without(store) {
    var copy = {};
    Object.keys(store).filter(function(k) { return k !== 'usageLog'; }).forEach(function(k) { copy[k] = store[k]; });
    return copy;
  }
  assert.deepStrictEqual(without(round.node.store), without(time2.node.store));
  assert.ok(/watch Pebble Round 2/.test(round.node.store.usageLog), 'the log says which watch');
});

var failed = 0;
tests.forEach(function(t) {
  try {
    t.fn();
  } catch (e) {
    failed++;
    console.log('FAIL ' + t.name + ': ' + e.message);
  }
});
console.log((tests.length - failed) + '/' + tests.length + ' passed');
if (failed) {
  process.exit(1);
}
