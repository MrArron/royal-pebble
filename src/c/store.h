#pragma once
#include <pebble.h>

// Keeps today's slice on the watch so the app shows something useful, and
// alerts keep firing, when the phone is away. Only the essentials are stored,
// chosen by priority to fit (docs/WATCH_PROTOCOL.md, "Stored on the watch").

// Loads the stored slice into data.c. Returns false if there is none.
bool store_load(void);
void store_save(void);

// The first starred event start or alert time that didn't fit in the last
// save (cruise minutes), or NO_TIME when everything fit.
int32_t store_cutoff(void);
// Size of the last save in bytes.
int store_saved_bytes(void);

// Whether to tell the user about the cutoff now: once per cutoff, and again
// when it moves earlier or the one shown has passed. Remembers it as shown.
bool store_should_warn(void);
