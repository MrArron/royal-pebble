# Phase 0: QuickJS vs Node for watch packing

Part of the Android companion plan (HANDOFF.md, Phase 0, last bullet): run the phone
side's packing code in an embedded QuickJS and compare its output bytes with Node.
Harness: `tools/quickjs-probe/` (`node probe.js --ng`).

## Result

**Feasible. Output is byte-identical.** Nine scenarios, all the same in both engines
(Bellard QuickJS and QuickJS-NG, each compiled to WebAssembly), compared as JSON text,
which includes every packed byte array:

| Scenario | Output |
| --- | --- |
| `buildSlice` + `packEvents` + `packAlarms`, fixture sailing, 4 moments (embark evening, sea day, 00:30 night, port day with 12 stars and settings) | 0.8 to 12 KB each |
| Demo sailings, variants 0-4 | 37 KB |
| `packNotices` (moved, cancelled, check; UTF-8 title with accent and en dash) | 365 chars |
| `directory.buildPage` + `packRows` for 59 pages (decks, areas, elevators, 40 places) | 88 KB |
| `voicecard.answer` + `packCard`, 10 phrases incl. routes and restrooms | 7.5 KB |
| `voice.parse` over the first 400 phrases of the voice corpus | 64 KB |

Why it works: `src/pkjs` is plain ES5 with `require`/`module.exports` and no Node or
PebbleKit APIs in these modules (`index.js`, `royal.js`, `config.js` are the ones that
touch `Pebble`, `localStorage`, `XMLHttpRequest`; they stay out of the engine). Only
`Date` needs care: the code reads local time (`getHours()` etc.), so the host must give
the engine the device's time zone, or pass `now` in explicitly. The probe pins `TZ=UTC`.

The bundle is 454 KB of JS (all ship data included). Calls on the
fixture sailing took 35 to 50 ms for a slice (Node 4 to 14 ms) in the WebAssembly build;
the largest job, all 59 directory pages, took 4 s (Node 0.23 s). On Android the engine
is native, which is normally several times faster than WebAssembly, and the app would
build one page per watch request, not all 59 at once.

## Engine choice: Zipline's QuickJS, not `app.cash.quickjs`

- `app.cash.quickjs` is the old name of the project, which became Zipline in
  September 2021. I found no artifacts under the old coordinates on Maven Central.
- Zipline is active: 1.28.0 was released 2026-09-29 (`app.cash.zipline:zipline-android`,
  AAR about 280 KB on Maven Central).
- You don't need Zipline's Kotlin/JS machinery. Its host module still has the plain
  engine class `app.cash.zipline.QuickJs`: `QuickJs.create()`, `evaluate(script, fileName)`
  returning `Any?`, `compile()`/`execute()` for bytecode, `gc()`, `close()`. Not thread
  safe: keep one instance on one thread.
- Plan: load the bundled script once, call a `run(...)`-style function with JSON in
  and JSON out, and convert the byte arrays to Kotlin `ByteArray` for
  `PebbleKit Android 2`. Passing JSON strings avoids any dependence on how the
  bridge maps JS objects.

**Not verified here:** the Android build itself (no Android SDK in this environment),
so Zipline's QuickJS version, its `Date`/time-zone behaviour and its speed on a phone
are untested. Both engines tested here share a common ES2020+ core, and the code
under test is ES5, so a difference is unlikely. The probe is the check to repeat on
device: `bundle.js` produces the script, and the scenario names and expected hashes
(from `node probe.js`) can be run through `QuickJs.evaluate` in an instrumented test.

## Things to keep in mind for Phase 3

- Build the engine script from `src/pkjs` at Gradle time with a bundler like
  `bundle.js` (or esbuild) so the app and the PebbleKit JS side keep sharing one source.
- `slice.js` takes `now` as a `Date`; pass the epoch and construct the Date inside
  the engine, in the device's time zone.
- Settings, stars and the bundle live in the Kotlin store (what `localStorage` holds
  today) and cross the boundary as JSON per call. The ship data (`data/*.js`) loads
  once with the bundle.
- Keep `test/pkjs/` as the guard and extend `scenarios.js` whenever a new packed
  message kind is added (Phase 2 notice kinds).
