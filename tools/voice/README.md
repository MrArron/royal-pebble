# Voice tools

These build the phone's voice lexicon for Phase 5 voice commands
(`docs/DESIGN_V1_1.md` §9.6, brief item 29). Nothing here runs at sea. The watch
gets no ship knowledge: the phone turns what was heard into the usual strings.

| File | What it is | Edited by hand? |
|---|---|---|
| `venue-mishearings-HM.json` | Every place a guest can say: spoken forms, likely mishearings (type, likelihood, observed), collisions, groups, flags | **Yes**: the one source for venue words |
| `build_voice.js` | Builds `src/pkjs/data/voice-HM.js` from it and `src/pkjs/venues.js` | yes (code) |
| `measure_voice.js` | Sizes, leave-one-out and false-match numbers | yes (code) |
| `voice-commands.json` | The command grammar as designed: intents, phrasings, watch wording. Reference only; the build doesn't read it | until the wording is approved |
| `src/pkjs/data/voice-HM.js` | Generated lexicon | **never** |
| `src/pkjs/voice.js` | Parser and matcher; `GRAMMAR` holds the command words, restroom / elevator / stairs / cabin words and numbers | yes |

Command words and category words live only in `voice.js`. Venue names, aliases
and mishearings live only in `venue-mishearings-HM.json`. Don't add a venue word
to `GRAMMAR`, or a command word to the table.

## Rebuilding

    node tools/voice/build_voice.js [--report]
    node test/pkjs/voice.test.js

The build fails when a venue in `venues.js` has no entry, when a target isn't in
`venues.js`, when a phrase is a bare generic word (`bar`, `deck`, `wine bar`; the
only ones allowed are `pool`, `theater` and `park`, owner decision D3), or when a
high or medium phrase fits two places (make a `group` entry). `--report` lists the
low-likelihood forms it had to keep.

What ships: every name and alias, spoken form, observed form and high or medium
form. A low-likelihood form ships only when the runtime fallback doesn't already
find the right place without it; the build measures that each time.

## Entries

- `kind`: `venue` / `place` (a `venues.js` row), `group` (several places, with
  `members`; the route goes to the nearest), `category` (known but not a place).
- `asr[]`: `{text, type, likelihood, observed?}`. `observed: true` = heard in a
  real test or in a usage log; always shipped.
- `location: false`: fine as a destination, refused as "I'm at" (several spots).
- `route: false`: known, but no route yet (answered "Not on the map yet").

## After a sailing

Copy the usage log out on the settings page (never commit it). Its `voice` lines
show what was heard and what it matched. For each miss or wrong match, add the
heard phrase to its place as `observed: true` (or a `group`), rebuild, and add
the utterance to `test/fixtures/voice-corpus-HM.json` with a made-up cabin number.
