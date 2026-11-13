// Minimal CommonJS bundler: packs scenarios.js and every module it requires
// (relative paths only, src/pkjs plus tools/quickjs-probe) into one plain script.
// The script defines globalThis.__rp(name) so any JS engine can run it, with no
// Node APIs. Used by probe.js; nothing here ships in the watch app build.
'use strict';
var fs = require('fs');
var path = require('path');

function bundle(entry) {
  var mods = {};
  function add(file) {
    file = fs.realpathSync(file);
    if (mods[file]) { return file; }
    var src = fs.readFileSync(file, 'utf8');
    var entryRec = {deps: {}, src: src};
    mods[file] = entryRec;
    var re = /require\(\s*'(\.[^']*)'\s*\)/g;
    var m;
    while ((m = re.exec(src))) {
      var want = path.resolve(path.dirname(file), m[1]);
      var found = [want, want + '.js', want + '.json'].filter(function(p) {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      })[0];
      if (!found) { throw new Error(file + ': cannot resolve ' + m[1]); }
      entryRec.deps[m[1]] = add(found);
    }
    return file;
  }
  var root = add(entry);
  var out = ['(function(){var defs={};var cache={};'];
  Object.keys(mods).forEach(function(f) {
    var rec = mods[f];
    var body = f.slice(-5) === '.json' ? 'module.exports=' + rec.src + ';' : rec.src;
    out.push('defs[' + JSON.stringify(f) + ']={deps:' + JSON.stringify(rec.deps) +
             ',fn:function(module,exports,require){' + body + '\n}};');
  });
  out.push('function load(id){if(cache[id]){return cache[id].exports;}' +
           'var d=defs[id];var m={exports:{}};cache[id]=m;' +
           'd.fn(m,m.exports,function(n){return load(d.deps[n]);});return m.exports;}');
  out.push('globalThis.__rp=load(' + JSON.stringify(root) + ').run;})();');
  return out.join('\n');
}

module.exports = {bundle: bundle};
