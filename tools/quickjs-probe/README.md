# quickjs-probe

Phase 0 check for the Android companion plan (see `docs/QUICKJS_PHASE0.md`): does
the phone side's packing code (`src/pkjs/slice.js`, `pack.js`, `directory.js`,
`voice.js`, `voicecard.js` and their data) give the same bytes in an embedded
QuickJS as in Node?

```
cd tools/quickjs-probe
npm install
node probe.js        # QuickJS (Bellard) vs Node
node probe.js --ng   # also QuickJS-NG
```

It bundles `scenarios.js` and everything it requires into one plain script
(`bundle.js`, a small CommonJS packer), runs it in QuickJS compiled to WebAssembly
(`quickjs-emscripten`), runs the same scenarios in Node with the real `require`,
and compares the JSON text of every result character for character. Exit code 1
if anything differs.

The fixture is Royal's public Harmony schedule from `test/fixtures` on a made-up
itinerary, plus the demo sailings. No personal cruise data. To try a real saved
sailing, add a scenario that `require`s it (keep it out of git).

Not part of the watch build: nothing in `src/` or `package.json` references this folder.
