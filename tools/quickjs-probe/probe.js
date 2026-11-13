// Runs the same scenarios in Node (real require of src/pkjs) and in QuickJS
// (one bundled script, no Node APIs) and compares the output bytes.
// Usage: npm install && node probe.js [--ng]   (--ng also runs QuickJS-NG)
'use strict';
process.env.TZ = 'UTC';
var crypto = require('crypto');
var path = require('path');
var bundler = require('./bundle');

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12); }

async function engines(wantNg) {
  var list = [];
  var qjs = require('quickjs-emscripten');
  list.push({name: 'QuickJS (Bellard, wasm)', mod: await qjs.getQuickJS()});
  if (wantNg) {
    var ng = require('@jitl/quickjs-ng-wasmfile-release-sync').default;
    var core = await qjs.newQuickJSWASMModule(ng);
    list.push({name: 'QuickJS-NG (wasm)', mod: core});
  }
  return list;
}

function runIn(mod, script, names) {
  var vm = mod.newContext();
  var res = vm.evalCode(script);
  if (res.error) { throw new Error('bundle failed: ' + JSON.stringify(vm.dump(res.error))); }
  res.value.dispose();
  var out = {};
  names.forEach(function(n) {
    var t0 = process.hrtime.bigint();
    var r = vm.evalCode('__rp(' + JSON.stringify(n) + ')');
    var ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r.error) { out[n] = {error: JSON.stringify(vm.dump(r.error)), ms: ms}; return; }
    out[n] = {text: vm.getString(r.value), ms: ms};
    r.value.dispose();
  });
  vm.dispose();
  return out;
}

(async function() {
  var scenarios = require('./scenarios');
  var names = JSON.parse(scenarios.run('*list'));
  var script = bundler.bundle(path.join(__dirname, 'scenarios.js'));
  var node = {};
  names.forEach(function(n) {
    var t0 = process.hrtime.bigint();
    var text = scenarios.run(n);
    node[n] = {text: text, ms: Number(process.hrtime.bigint() - t0) / 1e6};
  });
  console.log('bundle: ' + (script.length / 1024).toFixed(0) + ' KB of JS, TZ=' + process.env.TZ + ', node ' + process.version);
  var failed = 0;
  var list = await engines(process.argv.indexOf('--ng') !== -1);
  list.forEach(function(e) {
    console.log('\n== ' + e.name + ' vs Node');
    var t0 = Date.now();
    var got = runIn(e.mod, script, names);
    names.forEach(function(n) {
      var a = node[n].text, b = got[n].text;
      var same = a === b;
      if (!same) { failed++; }
      console.log((same ? 'SAME ' : 'DIFF ') + n + '  ' + (a.length) + ' chars sha ' + sha(a) +
                  (same ? '' : ' vs ' + (b === undefined ? got[n].error : sha(b))) +
                  '  node ' + node[n].ms.toFixed(1) + ' ms, qjs ' + got[n].ms.toFixed(1) + ' ms');
    });
    console.log('(total ' + (Date.now() - t0) + ' ms incl. engine start)');
  });
  console.log(failed ? '\n' + failed + ' scenario(s) differ' : '\nall scenarios identical');
  process.exit(failed ? 1 : 0);
})().catch(function(e) { console.error(e); process.exit(2); });
