// Validates a cruise data bundle (docs/DATA_FORMAT.md, v1).

var KNOWN_VERSIONS = [1];

// Returns null if the bundle is usable, otherwise a short reason.
function validate(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    return 'Not a cruise data bundle';
  }
  if (bundle.format !== 'cruise-watch') {
    return 'Not a cruise data bundle';
  }
  if (KNOWN_VERSIONS.indexOf(bundle.v) === -1) {
    return 'Unsupported bundle version ' + bundle.v;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bundle.sailDate || '')) {
    return 'Missing sail date';
  }
  if (!Array.isArray(bundle.itinerary) || bundle.itinerary.length === 0) {
    return 'Missing itinerary';
  }
  var sched = bundle.schedule;
  if (!sched || !Array.isArray(sched.events) || !Array.isArray(sched.fields)) {
    return 'Missing schedule';
  }
  var needed = ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'];
  for (var i = 0; i < needed.length; i++) {
    if (sched.fields.indexOf(needed[i]) === -1) {
      return 'Schedule is missing "' + needed[i] + '"';
    }
  }
  return null;
}

// Parses bundle text (as pasted). Returns {bundle} or {error}.
function parse(text) {
  var bundle;
  try {
    bundle = JSON.parse(text);
  } catch (e) {
    return {error: 'That text is not valid cruise data'};
  }
  var error = validate(bundle);
  return error ? {error: error} : {bundle: bundle};
}

module.exports = {validate: validate, parse: parse};
