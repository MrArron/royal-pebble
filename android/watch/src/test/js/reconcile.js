// Node side of JsStarReconcilerTest: index.js useBundle's reconcile step, from
// the JSON arguments on stdin, printed as JSON (the same call JsStarReconciler makes).
var slice = require('../../../../../src/pkjs/slice.js');
var a = JSON.parse(require('fs').readFileSync(0, 'utf8'));
var r = slice.reconcileStars(a.old, a.new, a.stars, a.settings, new Date(a.now), a.times);
process.stdout.write(JSON.stringify({stars: r.stars, times: slice.pruneStarTimes(r.times, a.new, a.settings, r.stars),
  changes: r.changes, notices: r.changes.length ? slice.buildNotices(a.new.sailDate, r.changes) : []}));
