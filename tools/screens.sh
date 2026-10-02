#!/bin/bash
# Screenshot walk for Royal Pebble on the Pebble Time 2 (emery) and Pebble
# Round 2 (gabbro) emulators. Run inside WSL from the repo root after
# `pebble build` (see CLAUDE.md for running it from Git Bash):
#
#   bash tools/screens.sh <out-dir> [emery] [gabbro]
#
# For each platform (both when none is named) it kills any emulator, installs
# the app with the fixed-offset TZ, walks the main screens with the demo data
# and saves <out-dir>/<platform>/NN_<screen>.png. One emulator runs at a time.
# The walk changes nothing it doesn't put back: the five Home demo variants
# (Hold Up) come round to the one it started on.
#
# Screens taken: Home, My info (top and at Ship directory), the day's
# summary, directory (deck list, an area, a place), Today, event details,
# route from Home, then Home and its route in the other four demo
# variants. Ask needs `pebble transcribe` and the alerts need real time, so
# they're not walked.
#
# SET_TIME=HH:MM:SS sets the watch clock before the walk (same content on two
# runs a few minutes apart only if the phone's demo was built at the same time).
set -u
OUT=${1:?usage: tools/screens.sh <out-dir> [emery] [gabbro]}
shift
PLATFORMS=${*:-emery gabbro}
export PATH="$HOME/.local/bin:$PATH"
export TZ=Etc/GMT+4
WAIT=${WAIT:-2}

for P in $PLATFORMS; do
  DIR="$OUT/$P"
  mkdir -p "$DIR"
  N=0
  shot() {
    N=$((N + 1))
    sleep "$WAIT"
    pebble screenshot --no-open --emulator "$P" "$(printf '%s/%02d_%s.png' "$DIR" "$N" "$1")" >/dev/null 2>&1 \
      || echo "screenshot $1 failed on $P"
  }
  press() { pebble emu-button click "$1" --emulator "$P" >/dev/null 2>&1; }
  hold() { pebble emu-button click "$1" --duration 900 --emulator "$P" >/dev/null 2>&1; }
  relaunch() {
    for _ in 1 2 3; do
      pebble install --emulator "$P" >/dev/null 2>&1 && return 0
      sleep 3
    done
    echo "reinstall failed on $P"
  }

  echo "== $P"
  pebble kill >/dev/null 2>&1
  pebble install --emulator "$P" || { echo "install failed on $P"; continue; }
  # A fresh boot may show the firmware's "wakeup events occurred" dialog over
  # the app: Back clears it (or exits the app), then a second install opens
  # the app on top either way, keeping its storage.
  sleep 3
  press back
  relaunch
  if [ -n "${SET_TIME:-}" ]; then
    pebble emu-set-time "$SET_TIME" --emulator "$P" >/dev/null 2>&1
  fi
  sleep 8  # the phone sends the day's data

  shot home
  press up;     shot myinfo
  press select; shot summary
  press back
  press down;   shot myinfo_directory
  press select; shot directory
  press select; shot directory_areas
  press select; shot directory_area
  press select; shot directory_place
  press back; press back; press back; press back; press back
  press down;   shot today
  press select; shot event
  press back; press back
  # Select routes to the NEXT card's event, or does nothing; a reinstall
  # brings Home back on top either way (Back would exit from Home).
  press select; shot route
  relaunch
  for v in 1 2 3 4; do
    hold up; sleep 8  # the phone sends the next variant
    shot "home_v$v"
    press select; shot "route_v$v"
    relaunch
  done
  hold up; sleep 8  # back to the first variant
done
pebble kill >/dev/null 2>&1
echo "saved under $OUT"
