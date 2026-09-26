#!/bin/sh
# Rebuild the Harmony walkway graph and its review images. Run from the repo root:
#   sh tools/shipmap/build.sh
# Needs the deck SVGs in tools/shipmap/decks/HM (fetch_deck_svgs.py) and, for the
# restroom symbols and review images, Playwright Chromium, opencv-python and numpy.
set -e
cd "$(dirname "$0")/../.."
T=tools/shipmap
mkdir -p $T/out
[ -f $T/out/symbols-HM.json ] || python3 $T/find_restrooms.py $T/decks/HM 362.1 $T/out/symbols-HM.json
python3 $T/build_walkways.py $T/walkways-HM.paths.json src/pkjs/data/places-HM.js $T/out/symbols-HM.json src/pkjs/data/walkways-HM.js | tee $T/out/build-report.txt
python3 $T/review_walkways.py $T/decks/HM 362.1 src/pkjs/data/walkways-HM.js $T/out/review
