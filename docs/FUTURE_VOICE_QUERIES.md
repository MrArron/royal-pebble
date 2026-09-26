# Offline voice questions (v1.1 Phase 4)

Status: researched 2026-09-24; scheduled as v1.1 Phase 4 on 2026-09-26
(`docs/PROJECT_BRIEF.md`). The phase starts with a scope session that decides
between a native Android companion app and the current setup, using the tests
below.

## The idea

Ask the watch a simple question out loud with no internet at sea, for example
"how do I get to my cabin from the Windjammer", and get an answer from the app's
own offline data (venue table, ship directory, My info stateroom deck).

## Findings: is it possible?

Probably yes, as long as the phone is nearby. The recognition runs on the phone, not
the watch.

- **The watch doesn't transcribe.** The Dictation API records on the watch and sends
  the audio over Bluetooth to the Pebble phone app, which returns text. The original
  docs send audio to a cloud service and list "No Bluetooth or Internet connection"
  as a failure (`DictationSessionStatusFailureConnectivityError`). Requires a watch
  with a microphone (Pebble Time 2 has one).
- **The Core Devices Pebble app can now transcribe on the phone.** Pebble Index 01
  voice notes use open-source speech-to-text running locally on the phone, with an
  optional cloud service for better quality. A forum user describes a speech setting
  with a downloadable "local package" set to "local with fallback to online."
- **Resulting path at sea:** watch mic → Bluetooth → phone transcribes locally →
  text back to the watch app → app matches it against offline data. No ship Wi-Fi
  or internet package needed.

## Caveats and open questions

1. **Phone must be within Bluetooth range.** No phone, no voice.
2. **iOS is uncertain.** A forum moderator says voice replies to notifications
   don't work on iOS. That's not the Dictation API itself, so test on an iPhone.
   Android looks safer.
3. **Not confirmed that third-party apps get the local engine.** Nothing found says
   outright that `dictation_session` uses local mode. Needs a test (below).
4. **Understanding the question is our job.** Dictation only returns text. Match
   keywords offline ("cabin", "Windjammer", "deck 5", venue names and aliases from
   the venue table) to fixed question types (where is X, how do I get from X to Y,
   what's next). Not open-ended like an AI assistant.
5. **Quality will be lower** than cloud recognition, and noise (pool deck,
   Windjammer) makes it worse. Short, predictable phrases work best. Consider a
   confirm step ("Windjammer → Cabin? Select to confirm").

## Feasibility test (do before the owner's sailing if possible)

Tiny test app that starts a dictation session and shows the returned text.

1. Pebble app speech setting set to local, local package downloaded.
2. Phone in airplane mode with Bluetooth on.
3. Start dictation on the watch; check whether text comes back.
4. Repeat on Android and iPhone; try a noisy room.

Pass = text returns in airplane mode on the target phone. Then the feature can be
scoped; the directions logic from v1.1 item 3 (Directions from the previous event)
and the ship directory (item 4) are reused for the answers.

## Sources

- [Dictation // Pebble Developers](https://developer.repebble.com/guides/events-and-services/dictation/)
- [Meet Pebble Index 01 – Pebble blog](https://repebble.com/blog/meet-pebble-index-01-external-memory-for-your-brain)
- [Michael Tsai – Pebble Index](https://mjtsai.com/blog/2025/12/09/pebble-index/)
- [Speech recognition not working – Pebble forum](https://forum.repebble.com/t/speech-recognition-not-working/858)
- [Dictate_pebble on GitHub](https://github.com/lordkeynes/Dictate_pebble)
