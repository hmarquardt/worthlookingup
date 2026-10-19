/* A photography session: when, where, what the sky does, what to bring, and a field plan you can print.

   This module is loaded only when a reader opens the builder. It holds the parts that are not astronomy: the
   date options, the checklist, the camera guidance, the clearance interpolation, the session record and the
   interface. The astronomy stays in the page, which computes it with the Milky Way engine at the chosen site.

   What it will not do: invent a window on a night without one, invent a forecast, invent a drive, invent an
   exposure, or describe a bare-earth model as a clear view. */

(function (root) {
  'use strict';

  var SCHEMA = 'worthlookingup.session/1';
  var LIST_KEY = 'session.list.v1';
  var CURRENT_KEY = 'session.current.v1';
  var CHECKLIST_KEY = 'session.checklist.v1';
  var READINESS_KEY = 'session.readiness.v1';
  var MAX_SESSIONS = 12;
  var MAX_NOTES = 2000;

  // The equipment list is a prompt, not a requirement: every line can be unticked, and an empty list is valid.
  var CHECKLIST = [
    { id: 'camera', label: 'Camera body and a spare battery', note: 'cold drains cells faster than you expect' },
    { id: 'lens', label: 'Wide, fast lens', note: '24 mm or wider on a full-frame camera frames the core' },
    { id: 'tripod', label: 'Sturdy tripod', note: 'a light tripod in wind is worse than none' },
    { id: 'batteries', label: 'Charged batteries and a power bank' },
    { id: 'cards', label: 'Formatted memory cards', note: 'and enough space for bracketed frames' },
    { id: 'remote', label: 'Remote shutter or interval timer' },
    { id: 'redlight', label: 'Red-light headlamp', note: 'white light costs you 20 minutes of night vision' },
    { id: 'clothing', label: 'Warm layers and gloves', note: 'you are standing still for hours' },
    { id: 'rain', label: 'Rain cover or dry bag' },
    { id: 'maps', label: 'Offline copy of the route and the site notes' },
    { id: 'water', label: 'Water and food' },
    { id: 'boots', label: 'Footwear for uneven ground' },
    { id: 'tripodmat', label: 'Something to kneel on' },
  ];

  var SENSORS = [
    { id: 'full-frame', label: 'Full frame (36 x 24 mm)', crop: 1 },
    { id: 'aps-c', label: 'APS-C (about 1.5x)', crop: 1.5 },
    { id: 'micro-four-thirds', label: 'Micro four thirds (2x)', crop: 2 },
    { id: 'unknown', label: 'Not sure', crop: null },
  ];

  function text(value) { return String(value === null || value === undefined ? '' : value); }
  function esc(value) {
    return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Notes are the only free text a visitor supplies. Control characters are dropped, length is bounded, and the
     value is always escaped when it is rendered; nothing is ever inserted as markup. */
  function sanitiseNotes(value) {
    return text(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, MAX_NOTES);
  }

  /* The clearance at any azimuth, interpolated between the two neighbouring profile directions — the same
     linear interpolation the research module uses, applied here to the copy the point artifact carries. */
  function horizonAt(profile, azimuthDeg) {
    if (!Array.isArray(profile) || !profile.length || !Number.isFinite(azimuthDeg)) return null;
    var list = profile.slice().sort(function (a, b) { return a.azimuthDeg - b.azimuthDeg; });
    var target = ((azimuthDeg % 360) + 360) % 360;
    var lower = list[list.length - 1], upper = list[0];
    for (var i = 0; i < list.length; i++) {
      if (list[i].azimuthDeg <= target) lower = list[i];
      if (list[i].azimuthDeg >= target) { upper = list[i]; break; }
    }
    var span = ((upper.azimuthDeg - lower.azimuthDeg) % 360 + 360) % 360 || 360;
    var offset = ((target - lower.azimuthDeg) % 360 + 360) % 360;
    var weight = span ? offset / span : 0;
    var gap = Math.abs(upper.azimuthDeg - lower.azimuthDeg);
    return {
      azimuthDeg: target,
      horizonAngleDeg: lower.horizonAngleDeg + (upper.horizonAngleDeg - lower.horizonAngleDeg) * weight,
      uncertaintyDeg: Math.max(lower.uncertaintyDeg || 0, upper.uncertaintyDeg || 0),
      // Across the 0/360 seam the two neighbours are 337.5 and 0, which is 22.5 apart, not 337.5: the weight is
      // computed on the shorter arc above, so the flag is about honest bookkeeping rather than arithmetic.
      interpolates: gap > 0,
      neighbours: [lower.azimuthDeg, upper.azimuthDeg],
    };
  }

  /* Clear / obstructed / unknown, with the same two-degree margin the research layer uses, widened by the
     profile's own uncertainty at that direction. */
  function clearance(profile, azimuthDeg, altitudeDeg, marginDeg) {
    var horizon = horizonAt(profile, azimuthDeg);
    if (!horizon || !Number.isFinite(altitudeDeg)) return { state: 'unavailable', reason: 'no terrain profile for this place' };
    var margin = Math.max(Number.isFinite(marginDeg) ? marginDeg : 2, horizon.uncertaintyDeg || 0);
    var difference = altitudeDeg - horizon.horizonAngleDeg;
    var state = difference > margin ? 'clear' : difference < -margin ? 'obstructed' : 'unknown';
    return { state: state, differenceDeg: Number(difference.toFixed(2)), horizon: horizon, marginDeg: Number(margin.toFixed(2)) };
  }

  /* Camera guidance. Two rules of thumb, both clearly labelled as such, and neither presented as a measurement:
     the 500 rule (500 / (focal length x crop)) and a shorter duration for sharp corners. With no equipment given,
     the guidance is generic and says so. */
  function cameraGuidance(input) {
    var settings = input || {};
    var sensor = SENSORS.find(function (entry) { return entry.id === settings.sensor; }) || null;
    var focal = Number(settings.focalLength);
    var aperture = Number(settings.aperture);
    var tracker = settings.tracker === true;
    var lines = [], assumptions = [], unknown = false;
    lines.push('Manual exposure mode, RAW capture, and manual focus on a bright star at 10x live view.');
    lines.push('Wide open or one stop down from wide open, then check the corners before you commit.');
    lines.push('Take a test frame, look at the histogram, and adjust the shutter before the ISO.');
    if (!sensor || !sensor.crop || !Number.isFinite(focal) || focal <= 0) {
      unknown = true;
      assumptions.push('No camera or lens was given, so no exposure duration is suggested. Enter a sensor and a ' +
        'focal length to get a starting point.');
      return { lines: lines, assumptions: assumptions, exposure: null, unknown: true };
    }
    if (tracker) {
      assumptions.push('A tracking mount removes the star-trailing limit, so no duration is derived from the focal ' +
        'length; the limit becomes the exposure you can guide and the sky brightness you can tolerate.');
      return { lines: lines.concat(['With a tracker, expose for the sky rather than for the stars, and take dark frames.']),
        assumptions: assumptions, exposure: null, unknown: false };
    }
    var fullFrameEquivalent = focal * sensor.crop;
    var fiveHundred = 500 / fullFrameEquivalent;
    var sharp = 300 / fullFrameEquivalent;
    assumptions.push('Both numbers come from the 500-rule family: 500 / (focal length x crop) for a usable frame and ' +
      '300 / (focal length x crop) for a stricter one. They are rules of thumb from the film era, not a model of ' +
      'your sensor, and they do not account for pixel pitch or for how far the target sits from the celestial pole.');
    assumptions.push('Stars near the pole trail less for the same duration; stars near the celestial equator trail more. ' +
      'The core sits at about -29 degrees declination, so treat the shorter number as the safer starting point.');
    if (Number.isFinite(aperture) && aperture > 0) {
      assumptions.push('Aperture f/' + aperture + ' is your input; stopping down improves corners at the cost of light, ' +
        'and the difference matters most at the edges of a wide lens.');
    }
    return {
      lines: lines.concat([
        'Start around ' + fiveHundred.toFixed(0) + ' s at ' + Math.round(fullFrameEquivalent) + ' mm equivalent, and try ' +
          sharp.toFixed(0) + ' s if the corners matter more than the light.',
        'ISO is a compromise, not a setting to copy: start high enough that the histogram is clear of the left edge, ' +
          'then trade ISO for time until the stars stay round.',
        'White balance is a starting point for the raw file, not a decision you have to get right in the field.',
      ]),
      assumptions: assumptions,
      exposure: { fiveHundredSeconds: Number(fiveHundred.toFixed(1)), sharpSeconds: Number(sharp.toFixed(1)),
        fullFrameEquivalentMm: Math.round(fullFrameEquivalent) },
      unknown: false,
    };
  }

  /* The session record. One stable id per site and night, so saving the same plan twice updates it rather than
     duplicating it, and a saved plan can always be told apart from a refreshed one. */
  function sessionId(siteKey, dateISO) {
    return 'session:' + String(siteKey).replace(/[^a-z0-9-]/gi, '').toLowerCase() + ':' + String(dateISO).slice(0, 10);
  }

  function newSession(partial) {
    var now = Date.now();
    var base = partial || {};
    return normalise({
      schema: SCHEMA, id: base.id || sessionId(base.siteKey || 'site', base.date || '1970-01-01'),
      subject: 'Milky Way core', date: base.date || null, siteKey: base.siteKey || null, site: base.site || null,
      pointId: base.pointId || null, evidenceRef: base.evidenceRef || null,
      window: base.window || null, core: base.core || null, moon: base.moon || null,
      darkness: base.darkness || null, terrain: base.terrain || null, weather: base.weather || null,
      quality: base.quality || null, engine: base.engine || null,
      checklist: base.checklist || {}, camera: base.camera || {}, notes: base.notes || '',
      readiness: base.readiness || {},
      createdAt: base.createdAt || now, updatedAt: now, limitations: base.limitations || [],
    });
  }

  function normalise(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var session = {
      schema: SCHEMA,
      id: text(raw.id) || sessionId(raw.siteKey || 'site', raw.date || '1970-01-01'),
      subject: text(raw.subject || 'Milky Way core'),
      date: /^\d{4}-\d{2}-\d{2}$/.test(text(raw.date)) ? text(raw.date) : null,
      siteKey: raw.siteKey ? text(raw.siteKey) : null,
      site: raw.site && Number.isFinite(raw.site.lat) && Number.isFinite(raw.site.lon)
        ? { name: text(raw.site.name), lat: raw.site.lat, lon: raw.site.lon, tz: text(raw.site.tz) } : null,
      pointId: raw.pointId ? text(raw.pointId) : null,
      evidenceRef: raw.evidenceRef && typeof raw.evidenceRef === 'object' ? raw.evidenceRef : null,
      window: raw.window && Number.isFinite(raw.window.start) ? { start: raw.window.start, end: raw.window.end,
        minutes: raw.window.minutes, level: text(raw.window.level) } : null,
      core: raw.core && Number.isFinite(raw.core.maxAltitudeDeg) ? raw.core : null,
      moon: raw.moon || null, darkness: raw.darkness || null, terrain: raw.terrain || null,
      weather: raw.weather || null, quality: Number.isFinite(raw.quality) ? raw.quality : null,
      engine: raw.engine || null,
      checklist: raw.checklist && typeof raw.checklist === 'object' ? raw.checklist : {},
      readiness: raw.readiness && typeof raw.readiness === 'object' ? raw.readiness : {},
      camera: raw.camera && typeof raw.camera === 'object' ? raw.camera : {},
      notes: sanitiseNotes(raw.notes),
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
      limitations: Array.isArray(raw.limitations) ? raw.limitations.map(text).slice(0, 12) : [],
    };
    return session;
  }

  /* A saved record from an older shape is migrated rather than dropped; anything unrecognisable is refused so the
     page can say so instead of rendering half a plan. */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
    if (raw.schema === SCHEMA) {
      var normalised = normalise(raw);
      return normalised ? { ok: true, session: normalised, migrated: false } : { ok: false, reason: 'unreadable record' };
    }
    if (raw.schema === 'worthlookingup.session/0' || (!raw.schema && raw.date)) {
      var upgraded = normalise({ ...raw, schema: SCHEMA });
      return upgraded ? { ok: true, session: upgraded, migrated: true } : { ok: false, reason: 'unreadable record' };
    }
    return { ok: false, reason: 'unknown session version' };
  }

  function listFrom(storage) {
    if (!storage || typeof storage.get !== 'function') return { ok: true, sessions: [] };
    var raw = storage.get(LIST_KEY, []);
    if (!Array.isArray(raw)) return { ok: false, sessions: [], reason: 'the saved list is not a list' };
    var sessions = [], skipped = 0;
    raw.slice(0, MAX_SESSIONS).forEach(function (entry) {
      var migrated = migrate(entry);
      if (migrated.ok) sessions.push(migrated.session); else skipped++;
    });
    return { ok: true, sessions: sessions, skipped: skipped };
  }

  function put(storage, session) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      return { ok: false, reason: 'browser storage is unavailable' };
    }
    var list = listFrom(storage);
    var next = [session].concat(list.sessions.filter(function (entry) { return entry.id !== session.id; }))
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, MAX_SESSIONS);
    var written = storage.set(LIST_KEY, next) && storage.set(CURRENT_KEY, session);
    return { ok: Boolean(written), sessions: next, reason: written ? null : 'browser storage is full or blocked' };
  }

  function remove(storage, id) {
    var list = listFrom(storage);
    var next = list.sessions.filter(function (entry) { return entry.id !== id; });
    storage.set(LIST_KEY, next);
    return next;
  }

  /* Checklist state lives on its own so an unticked box survives a page reload even with no session open. */
  /* One forecast for one night, from the hours the provider actually publishes. Missing series stay missing:
     a payload without wind produces no wind, rather than a zero that reads as still air. */
  function weatherSummary(hourly, window) {
    var empty = { hours: 0, cloud: null, precipitation: null, temperature: null, wind: null, gust: null, units: {} };
    if (!hourly || !Array.isArray(hourly.time) || !window || !Number.isFinite(window.start) || !Number.isFinite(window.end)) return empty;
    var rows = [];
    for (var i = 0; i < hourly.time.length; i++) {
      var at = hourly.time[i] * 1000;
      if (at >= window.start && at <= window.end) rows.push(i);
    }
    if (!rows.length) return empty;
    var series = function (name) { return Array.isArray(hourly[name]) ? hourly[name] : null; };
    var stats = function (name, reduce) {
      var data = series(name);
      if (!data) return null;
      var values = [];
      rows.forEach(function (index) {
        var value = data[index];
        if (Number.isFinite(value)) values.push(value);
      });
      if (!values.length) return null;
      return { value: reduce(values), min: Math.min.apply(null, values), max: Math.max.apply(null, values), count: values.length };
    };
    var mean = function (values) { return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length; };
    var units = hourly.units || {};
    return {
      hours: rows.length,
      cloud: stats('cloud_cover', mean),
      precipitation: stats('precipitation_probability', function (values) { return Math.max.apply(null, values); }),
      temperature: stats('temperature_2m', mean),
      wind: stats('wind_speed_10m', function (values) { return Math.max.apply(null, values); }),
      gust: stats('wind_gusts_10m', function (values) { return Math.max.apply(null, values); }),
      units: { temperature: units.temperature_2m || null, wind: units.wind_speed_10m || null,
        precipitation: units.precipitation_probability || '%' },
    };
  }

  /* Whether a forecast may be quoted at all. The page requests nine days from now; a night before today
     is history rather than a forecast, and a night beyond that request is never extrapolated. */
  function forecastHorizon(now, nightStart, days) {
    var span = (Number.isFinite(days) ? days : 9) * 86400000;
    if (!Number.isFinite(nightStart)) return { status: 'unknown', lastDay: now + span };
    if (nightStart < now - 86400000) return { status: 'past', lastDay: now + span };
    if (nightStart > now + span) return { status: 'beyond', lastDay: now + span };
    return { status: 'within', lastDay: now + span };
  }

  /* A stable digest of the access evidence that matters, so a saved plan can be compared with what is published
     now without keeping a second copy of the rules. Restrictions are part of it: a new quiet-hours line is a
     change a reader needs to see. */
  function evidenceFingerprint(ref) {
    if (!ref) return null;
    var access = ref.access || {};
    var evidence = Array.isArray(access.evidence) ? access.evidence : [];
    var restrictions = Array.isArray(access.restrictions) ? access.restrictions : [];
    var parts = [ref.verifiedAt || '', access.nightPresence || '', access.parking || '', access.classification || '',
      access.summary || '', evidence.length, evidence[0] ? (evidence[0].verifiedAt || '') + '|' + (evidence[0].quote || '') : '',
      restrictions.map(function (item) { return (item && item.text) || ''; }).join('~')];
    var text = parts.join('');
    var hash = 5381;
    for (var i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    return 'ev-' + hash.toString(36) + '-' + text.length.toString(36);
  }

  /* Saved evidence against current evidence. The saved copy is never overwritten here: it is the record of what
     the plan was made with, and the comparison says whether the published record still agrees with it. */
  function compareAccess(saved, current, now) {
    var savedRef = saved || null;
    if (!current) {
      return { status: 'withheld', label: 'This point is no longer published',
        detail: 'The saved access record is kept below as history. Nothing here says the place is open; the managing agency is the only source that can.',
        saved: savedRef, current: null, changes: [] };
    }
    var savedAccess = savedRef && savedRef.access ? savedRef.access : {};
    var currentAccess = current.access || {};
    var changes = [];
    var compare = function (field, savedValue, currentValue) {
      if (String(savedValue == null ? '' : savedValue) !== String(currentValue == null ? '' : currentValue)) {
        changes.push({ field: field, saved: savedValue == null ? null : savedValue, current: currentValue == null ? null : currentValue });
      }
    };
    compare('night presence', savedAccess.nightPresence, currentAccess.nightPresence);
    compare('parking', savedAccess.parking, currentAccess.parking);
    compare('classification', savedAccess.classification, currentAccess.classification);
    compare('access summary', savedAccess.summary, currentAccess.summary);
    compare('verification date', savedRef && savedRef.verifiedAt, current.verifiedAt);
    var savedRestrictions = (Array.isArray(savedAccess.restrictions) ? savedAccess.restrictions : []).map(function (item) { return (item && item.text) || ''; });
    var currentRestrictions = (Array.isArray(currentAccess.restrictions) ? currentAccess.restrictions : []).map(function (item) { return (item && item.text) || ''; });
    if (savedRestrictions.join('|') !== currentRestrictions.join('|')) {
      changes.push({ field: 'restrictions', saved: savedRestrictions, current: currentRestrictions });
    }
    var currentAt = Date.parse(String(currentAccess.verifiedAt || current.verifiedAt || ''));
    var expired = Number.isFinite(currentAt) && Number.isFinite(now) && now - currentAt > 365 * 86400000;
    if (expired) {
      return { status: 'expired', label: 'The published verification is more than a year old',
        detail: 'Worth Looking Up withholds evidence older than a year, so this record is shown as history rather than as a current permission.',
        saved: savedRef, current: current, changes: changes };
    }
    if (changes.length) {
      return { status: 'changed', label: 'The published access record has changed since this plan was saved',
        detail: 'Both versions are shown below. The current one is what the site publishes now; neither is a substitute for the notice the agency publishes itself.',
        saved: savedRef, current: current, changes: changes };
    }
    return { status: 'current', label: 'Published access evidence',
      detail: 'Checked against the latest Worth Looking Up site record, not with the managing agency. It matches the record this plan was saved with.',
      saved: savedRef, current: current, changes: [] };
  }

  /* The pre-departure list. Ticking one of these is the reader telling themselves they did it; it is never a
     verification of an agency rule, and the wording says so wherever the list appears. */
  var READINESS = [
    { id: 'rules', label: 'Recheck the rules and current alerts the facility publishes itself', action: true },
    { id: 'parking', label: 'Confirm parking or campsite eligibility for this night', action: true },
    { id: 'weather', label: 'Look at the latest local forecast, and at the sky when you arrive', action: true },
    { id: 'roads', label: 'Check roads, gates and vehicle restrictions', action: true },
    { id: 'horizon', label: 'Check the real horizon for trees, buildings or a rise', action: true },
    { id: 'kit', label: 'Charge batteries, format cards and pack the kit', action: true },
    { id: 'company', label: 'Tell someone where you are going and when you expect to be back', action: true },
  ];

  function readReadiness(storage, defaults) {
    var stored = storage && typeof storage.get === 'function' ? storage.get(READINESS_KEY, null) : null;
    var state = {};
    (defaults || READINESS).forEach(function (item) {
      state[item.id] = stored && typeof stored[item.id] === 'boolean' ? stored[item.id] : false;
    });
    return state;
  }

  function readChecklist(storage, defaults) {
    var stored = storage && typeof storage.get === 'function' ? storage.get(CHECKLIST_KEY, null) : null;
    var state = {};
    (defaults || CHECKLIST).forEach(function (item) {
      state[item.id] = stored && typeof stored[item.id] === 'boolean' ? stored[item.id] : false;
    });
    return state;
  }

  root.OverheadSessions = { SCHEMA: SCHEMA, CHECKLIST: CHECKLIST, SENSORS: SENSORS, MAX_SESSIONS: MAX_SESSIONS,
    LIST_KEY: LIST_KEY, CURRENT_KEY: CURRENT_KEY, CHECKLIST_KEY: CHECKLIST_KEY, READINESS_KEY: READINESS_KEY,
    MAX_NOTES: MAX_NOTES, READINESS: READINESS, weatherSummary: weatherSummary, forecastHorizon: forecastHorizon,
    evidenceFingerprint: evidenceFingerprint, compareAccess: compareAccess, readReadiness: readReadiness,
    sanitiseNotes: sanitiseNotes, horizonAt: horizonAt, clearance: clearance, cameraGuidance: cameraGuidance,
    sessionId: sessionId, newSession: newSession, normalise: normalise, migrate: migrate, listFrom: listFrom,
    put: put, remove: remove, readChecklist: readChecklist, esc: esc };
})(typeof self !== 'undefined' ? self : globalThis);

(function (root) {
  'use strict';
  var api = root.OverheadSessions;
  var esc = api.esc;

  function button(action, value, label, extra) {
    return '<button type="button" class="sx-choice' + (extra && extra.active ? ' is-on' : '') + '" data-session="' +
      esc(action) + '"' + (value ? ' data-value="' + esc(value) + '"' : '') + (extra && extra.disabled ? ' disabled' : '') +
      (extra && extra.active ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + label + '</button>';
  }

  function step(number, title, body, note) {
    return '<section class="sx-step"><h4 class="sx-step-head"><span class="sx-step-num">' + number + '</span>' + esc(title) +
      '</h4>' + (note ? '<p class="small sx-step-note">' + note + '</p>' : '') + body + '</section>';
  }

  function fact(label, value, note) {
    return '<div class="sx-fact"><dt>' + esc(label) + '</dt><dd>' + value + (note ? '<span class="small">' + note + '</span>' : '') + '</dd></div>';
  }

  function tag(label, tone) {
    return '<span class="sx-tag sx-tag-' + esc(tone || 'neutral') + '">' + esc(label) + '</span>';
  }

  function fieldRow(key, value, note, big) {
    return '<div class="sx-field' + (big ? ' sx-field-big' : '') + '"><span class="sx-field-key">' + esc(key) + '</span>' +
      '<span class="sx-field-value">' + value + (note ? ' <span class="small">' + note + '</span>' : '') + '</span></div>';
  }

  /* The forecast, stated as a forecast: which hours it covers, how old it is, and whether the provider answered at
     all. A missing forecast is never rendered as quiet air, and a cached one is never rendered as current. */
  function forecastBlock(forecast) {
    if (!forecast) return '';
    var tone = forecast.status === 'forecast' ? (forecast.stale ? 'warn' : 'good') : forecast.status === 'loading' ? 'neutral' : 'warn';
    var head = '<div class="sx-forecast"><p><strong>' + esc(forecast.label) + '</strong> ' + tag(forecast.tag, tone) + '</p>';
    if (forecast.detail) head += '<p class="small">' + esc(forecast.detail) + '</p>';
    if (forecast.rows && forecast.rows.length) {
      head += '<dl class="sx-forecast-rows">' + forecast.rows.map(function (row) {
        return '<dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd>';
      }).join('') + '</dl>';
    }
    if (forecast.lastKnown) {
      var saved = forecast.lastKnown;
      head += '<div class="sx-lastforecast"><p class="small"><strong>' + esc(saved.label) + '</strong> ' + tag(saved.tag || 'saved', 'warn') + '</p>' +
        '<p class="small">' + esc(saved.whenLabel) + '. This is the forecast the plan was saved with, not a current one, ' +
        'and it does not describe the sky now.</p>' +
        (saved.rows && saved.rows.length ? '<dl class="sx-forecast-rows small">' + saved.rows.map(function (row) {
          return '<dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd>';
        }).join('') + '</dl>' : '') + '</div>';
    }
    return head + '</div>';
  }

  /* Saved evidence against published evidence. The differences are listed field by field, and the official link is
     always present, because this page can only compare records — it cannot contact the managing agency. */
  function accessBlock(access) {
    if (!access) return '';
    var tone = access.status === 'current' ? 'good' : access.status === 'changed' ? 'warn' : 'bad';
    var html = '<div class="sx-access sx-access-' + esc(access.status) + '" data-access-status="' + esc(access.status) + '">' +
      '<p><strong>' + esc(access.label) + '</strong> ' + tag(access.status === 'current' ? 'matches this plan' : access.status, tone) + '</p>' +
      '<p class="small">' + esc(access.detail) + '</p>';
    if (access.rows && access.rows.length) {
      html += '<dl class="sx-access-rows small">' + access.rows.map(function (row) {
        return '<dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd>';
      }).join('') + '</dl>';
    }
    if (access.changes && access.changes.length) {
      html += '<ul class="sx-changes small">' + access.changes.map(function (change) {
        var from = Array.isArray(change.saved) ? change.saved.join('; ') : change.saved;
        var to = Array.isArray(change.current) ? change.current.join('; ') : change.current;
        return '<li><strong>' + esc(change.field) + ':</strong> was ' + esc(from || 'not recorded') + ' — now ' +
          esc(to || 'not recorded') + '</li>';
      }).join('') + '</ul>';
    }
    if (access.officialUrl) {
      html += '<p class="small"><a href="' + esc(access.officialUrl) + '" rel="noopener">The managing agency source</a> — the ' +
        'only place the current rule can be confirmed.</p>';
    }
    return html + '</div>';
  }

  function conditionsBlock(conditions) {
    if (!conditions) return '<p class="small">Calculating this night at this place…</p>';
    // The field summary is what a reader needs with a torch in one hand: where, when, which way, what the Moon and
    // the forecast are doing, and any access warning. It is built before the no-window branch, because a night with
    // no window still has a place, a forecast and an access rule, and hiding those would be less useful than showing
    // them with the reason nothing here can be saved.
    var summary = [];
    // A reader in a dead zone needs to know why nothing below is moving. The connection flag is the browser's own
    // hint, so it is phrased as a report rather than as a measurement of the sky or the site.
    if (conditions.offline) {
      summary.push(fieldRow('Connection', 'Offline' + (conditions.forecast && conditions.forecast.lastKnown ? ' · saved forecast below' : ''),
        'nothing is being refreshed'));
    }
    if (conditions.destination) {
      summary.push(fieldRow('Where', esc(conditions.destination.name) + ' ' +
        (conditions.destination.withheld ? tag('no longer published', 'bad')
          : conditions.destination.verified ? tag('verified point', 'good') : tag('your location, unverified', 'warn'))));
    }
    if (conditions.window) {
      summary.push(fieldRow('Window', esc(conditions.window.startLabel) + ' – ' + esc(conditions.window.endLabel),
        esc(conditions.window.minutes) + ' min', true));
    }
    if (conditions.best) {
      summary.push(fieldRow('Best moment', esc(conditions.best.timeLabel), '', true));
    }
    if (conditions.direction) {
      summary.push(fieldRow('Point the camera', esc(conditions.direction.cardinal),
        esc(conditions.direction.bearing) + '° · core ' + esc(conditions.direction.altitudeDeg) + '° up', true));
    }
    if (conditions.moon) {
      summary.push(fieldRow('Moon', esc(conditions.moon.short || conditions.moon.label)));
    }
    if (conditions.forecast) {
      summary.push(fieldRow('Forecast', esc(conditions.forecast.short || conditions.forecast.label),
        conditions.forecast.whenLabel ? esc(conditions.forecast.whenLabel) : ''));
    }
    if (conditions.access && conditions.access.warning) {
      summary.push(fieldRow('Access', esc(conditions.access.warning)));
    }
    var summaryHTML = '<div class="sx-fieldsum" role="group" aria-label="The field summary">' + summary.join('') + '</div>';
    if (conditions.why) {
      return '<div class="sx-nowindow"><p><strong>' + esc(conditions.why.headline) + '</strong></p><p class="small">' +
        esc(conditions.why.detail) + '</p><p class="small">A session saved for this night would hold an observing window that ' +
        'does not exist, so there is nothing to save. Choose another date above: the next favourable night is offered ' +
        'when the engine finds one, and a date months away is still fine — only the astronomy is certain that far ahead.</p></div>' +
        summaryHTML + (conditions.forecast ? forecastBlock(conditions.forecast) : '') +
        (conditions.access ? accessBlock(conditions.access) : '');
    }
    var html = summaryHTML;
    var facts = [];
    if (conditions.window) {
      facts.push(fact('Observing window', esc(conditions.window.startLabel) + ' – ' + esc(conditions.window.endLabel),
        esc(conditions.window.minutes) + ' min · ' + esc(conditions.window.level)));
    }
    if (conditions.best) {
      facts.push(fact('Best available moment', esc(conditions.best.timeLabel),
        'core ' + esc(conditions.best.altitudeDeg) + '° up, bearing ' + esc(conditions.best.azimuthDeg) + '° ' + esc(conditions.best.compass)));
    }
    if (conditions.direction) {
      facts.push(fact('Point the camera', esc(conditions.direction.cardinal) + ' · ' + esc(conditions.direction.bearing) + '°',
        'core altitude ' + esc(conditions.direction.altitudeDeg) + '° at that moment'));
    }
    if (conditions.moon) {
      facts.push(fact('Moon', esc(conditions.moon.label), conditions.moon.detail ? esc(conditions.moon.detail) : ''));
    }
    if (conditions.timezone) facts.push(fact('Times in', esc(conditions.timezone), 'all times on this plan are local to the site'));
    if (conditions.darkness) {
      facts.push(fact('Darkness', esc(conditions.darkness.label), conditions.darkness.detail ? esc(conditions.darkness.detail) : ''));
    }
    if (Number.isFinite(conditions.quality)) {
      facts.push(fact('Window quality', esc(conditions.quality) + ' / 100', 'this category\'s own scale, not comparable with satellite or meteor values'));
    }
    html += '<dl class="sx-facts">' + facts.join('') + '</dl>';
    if (conditions.terrain) {
      var t = conditions.terrain;
      html += '<div class="sx-terrain sx-terrain-' + esc(t.state) + '"><p><strong>Terrain toward the core: ' + esc(t.state) + '</strong></p>' +
        '<p class="small">Modeled horizon ' + esc(t.horizonAngleDeg) + '° at bearing ' + esc(t.azimuthDeg) + '°, core ' +
        esc(t.altitudeDeg) + '° — clearance ' + esc(t.differenceDeg) + '°, uncertainty ±' + esc(t.uncertaintyDeg) + '°. ' +
        'Bare-earth ' + esc(t.dem) + ' model: it does not know about trees, buildings or a bank of ground right in front of you.</p>' +
        (Array.isArray(t.moments) && t.moments.length ? '<p class="small">The reference night was evaluated at three moments as the core moved: ' +
          t.moments.map(function (m) { return esc(m.label) + ' ' + esc(m.azimuthDeg) + '° → ' + esc(m.horizonAngleDeg) + '° horizon'; }).join('; ') +
          '. Your date\'s own bearing is the one quoted above.</p>' : '') + '</div>';
    } else {
      html += '<p class="small sx-terrain-none">Terrain horizon unavailable for this place: no bare-earth profile has been ' +
        'evaluated here, and none is invented. Check the view yourself before dark.</p>';
    }
    if (conditions.forecast) {
      html += forecastBlock(conditions.forecast);
    } else if (conditions.weather) {
      html += '<p class="small sx-weather"><strong>Weather:</strong> ' + esc(conditions.weather.label) +
        (conditions.weather.detail ? ' ' + esc(conditions.weather.detail) : '') + '</p>';
    }
    if (conditions.access) html += accessBlock(conditions.access);
    if (Array.isArray(conditions.limitations) && conditions.limitations.length) {
      html += '<ul class="sx-limits small">' + conditions.limitations.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul>';
    }
    return html;
  }

  function whereBlock(ctx) {
    var points = Array.isArray(ctx.points) ? ctx.points : [];
    var choices = points.map(function (point) {
      var parking = point.access && point.access.parking ? point.access.parking : 'unknown';
      return button('where', point.id, '<span class="sx-choice-name">' + esc(point.name) + '</span>' +
        '<span class="small">' + esc(point.agency && point.agency.name ? point.agency.name : 'managing agency not recorded') + ' · parking ' + esc(parking.replace(/-/g, ' ')) + '</span>',
        { active: ctx.state.where === point.id });
    }).join('');
    choices += button('where', 'home', '<span class="sx-choice-name">My saved location</span>' +
      '<span class="small">' + esc(ctx.home && ctx.home.name ? ctx.home.name : 'your own site') + ' · not a verified public site</span>',
      { active: ctx.state.where === 'home' });
    return '<div class="sx-choices">' + choices + '</div>';
  }

  function whenBlock(ctx) {
    var options = Array.isArray(ctx.dates) ? ctx.dates : [];
    var chips = options.map(function (option) {
      return button('when', option.id, '<span class="sx-choice-name">' + esc(option.label) + '</span>' +
        '<span class="small">' + esc(option.detail) + '</span>', { active: ctx.state.when === option.id });
    }).join('');
    chips += button('when', 'custom', '<span class="sx-choice-name">A date of my own</span>' +
      '<span class="small">any night in the next year, calculated at your site</span>', { active: ctx.state.when === 'custom' });
    var custom = ctx.state.when === 'custom'
      ? '<label class="sx-date"><span>Observing date</span><input type="date" data-session-input="date" value="' +
        esc(ctx.state.date || ctx.todayISO) + '" min="' + esc(ctx.todayISO) + '" max="' + esc(ctx.maxDateISO) + '"></label>' +
        '<p class="small">The app calculates that night at the selected place; it never reuses another site\'s window. ' +
        'Beyond the forecast horizon only astronomy and the Moon are predictable, and the plan will say so.</p>'
      : '';
    return '<div class="sx-choices">' + chips + '</div>' + custom;
  }

  /* The pre-departure review: what is known, what is forecast, what is unverified, and what still has to be done by
     hand. The checkboxes record that the reader did something; they never turn an agency rule into a verified fact. */
  function readinessBlock(ctx) {
    var conditions = ctx.conditions || {};
    var rows = [];
    var row = function (key, value, note) {
      rows.push('<dt>' + esc(key) + '</dt><dd>' + value + (note ? ' <span class="small">' + note + '</span>' : '') + '</dd>');
    };
    if (conditions.destination) {
      row('Destination', esc(conditions.destination.name),
        conditions.destination.verified ? 'verified observation point' : 'your own location, not a verified public site');
    }
    if (conditions.dateLabel) row('Night', esc(conditions.dateLabel), conditions.timezone ? 'times in ' + esc(conditions.timezone) : '');
    if (conditions.window) row('Window', esc(conditions.window.startLabel) + ' – ' + esc(conditions.window.endLabel) + ' (' + esc(conditions.window.minutes) + ' min)');
    if (conditions.forecast) row('Forecast', esc(conditions.forecast.short || conditions.forecast.label), conditions.forecast.whenLabel ? esc(conditions.forecast.whenLabel) : '');
    if (conditions.access) {
      row('Access evidence', esc(conditions.access.short || conditions.access.label),
        conditions.access.verifiedAt ? 'verified ' + esc(conditions.access.verifiedAt) : '');
    }
    if (conditions.terrain) row('Terrain', esc(conditions.terrain.state) + ' at ' + esc(conditions.terrain.horizonAngleDeg) + '°, uncertainty ±' + esc(conditions.terrain.uncertaintyDeg) + '°');
    else row('Terrain', 'no bare-earth profile for this place', 'check the real horizon yourself');
    var gear = api.CHECKLIST.filter(function (item) { return ctx.checklist && ctx.checklist[item.id]; }).length;
    row('Equipment', gear + ' of ' + api.CHECKLIST.length + ' packed', gear === api.CHECKLIST.length ? 'all ticked' : 'still to pack');
    if (Array.isArray(conditions.limitations) && conditions.limitations.length) {
      row('Still unverified', conditions.limitations.length + ' item' + (conditions.limitations.length === 1 ? '' : 's'),
        'listed with the conditions above');
    }
    var items = api.READINESS.map(function (item) {
      var on = Boolean(ctx.readiness && ctx.readiness[item.id]);
      return '<li><label class="sx-check"><input type="checkbox" data-session-ready="' + esc(item.id) + '"' +
        (on ? ' checked' : '') + '><span>' + esc(item.label) + '</span></label></li>';
    }).join('');
    return step(4, 'Before you leave',
      '<dl class="sx-preflight">' + rows.join('') + '</dl>' +
      '<ul class="sx-checks sx-ready">' + items + '</ul>' +
      '<p class="small">Ticking these records that you did them. It does not verify anything: this page cannot see the ' +
      'site, contact the agency, or know whether a gate is open tonight.</p>',
      'Every one of these is a thing to do, not a thing this page can check for you.');
  }

  function prepareBlock(ctx) {
    var guidance = ctx.guidance || api.cameraGuidance(ctx.state.camera);
    var items = api.CHECKLIST.map(function (item) {
      var on = Boolean(ctx.checklist && ctx.checklist[item.id]);
      return '<li><label class="sx-check"><input type="checkbox" data-session-check="' + esc(item.id) + '"' +
        (on ? ' checked' : '') + '><span>' + esc(item.label) + (item.note ? '<span class="small"> — ' + esc(item.note) + '</span>' : '') +
        '</span></label></li>';
    }).join('');
    var readiness = [
      'Recheck the facility\'s own hours and alerts on the day: this page records what the agency published, not what it will publish tomorrow.',
      'Confirm that parking or the campsite is allowed for the night you chose — a campground permit is not a day-use lot permit.',
      'Recheck the forecast shortly before leaving, and look at the sky when you arrive.',
      'Check road and gate conditions for the last stretch.',
      'Look at the actual horizon: the terrain model is bare earth and cannot see trees or buildings.',
      'Carry a red light, warm layers and water, and know the quiet hours and wildlife rules.',
    ].map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('');
    var camera = ctx.state.camera || {};
    var sensorOptions = api.SENSORS.map(function (entry) {
      return '<option value="' + esc(entry.id) + '"' + (camera.sensor === entry.id ? ' selected' : '') + '>' + esc(entry.label) + '</option>';
    }).join('');
    return step(5, 'Prepare',
      '<div class="sx-readiness"><h5>Readiness checklist</h5><ul class="small">' + readiness + '</ul>' +
      '<p class="small">Ticking these boxes is a prompt, not a safety certification, and this page cannot know the conditions at the site.</p></div>' +
      '<div class="sx-gear"><h5>Equipment checklist</h5><ul class="sx-checks">' + items + '</ul>' +
      '<p class="small">Your ticks are stored in this browser only, survive a reload, and are copied into a saved plan. ' +
      'Nothing is uploaded.</p></div>' +
      '<div class="sx-camera"><h5>Camera starting points</h5>' +
      '<div class="sx-camera-inputs">' +
      '<label><span>Sensor</span><select data-session-input="sensor"><option value="">Not given</option>' + sensorOptions + '</select></label>' +
      '<label><span>Focal length (mm)</span><input type="number" inputmode="numeric" min="4" max="1200" step="1" data-session-input="focalLength" value="' +
        esc(camera.focalLength || '') + '" placeholder="e.g. 24"></label>' +
      '<label><span>Widest aperture (f/)</span><input type="number" inputmode="decimal" min="0.7" max="32" step="0.1" data-session-input="aperture" value="' +
        esc(camera.aperture || '') + '" placeholder="e.g. 2.8"></label>' +
      '<label class="sx-inline"><input type="checkbox" data-session-input="tracker"' + (camera.tracker ? ' checked' : '') + '><span>Tracking mount</span></label>' +
      '</div><ul class="sx-guidance">' + guidance.lines.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul>' +
      (guidance.assumptions.length ? '<details class="sx-assumptions"><summary class="small">What these numbers assume</summary><ul class="small">' +
        guidance.assumptions.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul></details>' : '') +
      '</div>',
      'Starting points, not recipes: the light, the lens and your own taste decide the exposure.');
  }

  function saveBlock(ctx) {
    var saved = Array.isArray(ctx.saved) ? ctx.saved : [];
    var list = saved.length ? '<ul class="sx-saved">' + saved.map(function (entry) {
      return '<li><span><strong>' + esc(entry.site ? entry.site.name : 'Saved plan') + '</strong> <span class="small">' + esc(entry.date || '') +
        '</span></span><span class="sx-saved-actions">' + button('open', entry.id, 'Open') + button('delete', entry.id, 'Delete') + '</span></li>';
    }).join('') + '</ul>' : '<p class="small">No plans saved in this browser yet.</p>';
    var disabled = ctx.conditions && ctx.conditions.why ? ' disabled' : '';
    return step(6, 'Save or export',
      '<label class="sx-notes"><span>Notes for the field</span><textarea data-session-input="notes" rows="3" maxlength="' + api.MAX_NOTES +
        '" placeholder="Meeting point, gate code you already know, frames you want…">' + esc(ctx.state.notes || '') + '</textarea></label>' +
      '<div class="sx-actions">' +
      '<button type="button" class="sx-primary" data-session="save"' + disabled + '>Save this plan</button>' +
      '<button type="button" data-session="print"' + disabled + '>Print field plan</button>' +
      '<button type="button" data-session="offline"' + disabled + '>Download a field copy</button>' +
      '<button type="button" data-session="calendar"' + disabled + '>Add to calendar</button>' +
      '<button type="button" data-session="plan"' + disabled + '>Add to observing plan</button>' +
      '<button type="button" data-session="refresh"' + (ctx.session ? '' : ' disabled') + '>Refresh evidence and forecast</button>' +
      '</div>' +
      '<p class="small">Download a field copy saves one self-contained HTML file with this plan. It opens from your own ' +
      'device with no network and no app, and it says when it was made. The page itself still has to be loaded once before ' +
      'that, so this is how a plan survives a cold start in a dead zone.</p>' +
      (Array.isArray(ctx.refreshReport) && ctx.refreshReport.length
        ? '<ul class="sx-refresh small">' + ctx.refreshReport.map(function (line) {
          return '<li data-refresh-status="' + esc(line.status) + '">' + esc(line.text) + '</li>';
        }).join('') + '</ul>' : '') +
      (ctx.notice ? '<p class="small sx-notice" role="status">' + esc(ctx.notice) + '</p>' : '') +
      '<h5>Saved plans in this browser</h5>' + list +
      '<p class="small">Plans are stored locally, one list of at most ' + api.MAX_SESSIONS + ' entries, and never synchronised. ' +
      'A saved plan keeps the calculations it was made with; "refresh" recalculates and marks what changed, and an access rule may ' +
      'have changed since. Clearing site data removes them.</p>',
      'Nothing here books a site, reserves a pitch or guarantees a clear sky.');
  }

  function render(ctx) {
    var context = ctx || {};
    var state = context.state || {};
    var chosen = context.conditions && context.conditions.siteName ? context.conditions.siteName : null;
    return '<div class="sx" data-session-root>' +
      '<header class="sx-head"><h3>Plan a photography session</h3><p class="small">Choose a night and a documented place, read ' +
      'what the sky does there, prepare the kit, and print or save the result. Every number on this page comes from the same ' +
      'engines as the Milky Way category above; nothing is filled in to make the plan look complete.</p></header>' +
      step(1, 'When', whenBlock(context), 'The next favourable night and the next season come from the season search, ' +
        'which walks your site\'s own nights in order.') +
      step(2, 'Where', whereBlock(context), 'Verified points carry quoted agency evidence. <strong>My saved location</strong> is ' +
        'where you are: the app has no public-access evidence for it and will never claim any.') +
      step(3, 'Conditions at ' + esc(chosen || 'the chosen place'), conditionsBlock(context.conditions),
        context.conditions && context.conditions.dateLabel ? esc(context.conditions.dateLabel) : null) +
      readinessBlock(context) +
      prepareBlock(context) +
      saveBlock(context) +
      '<p class="small sx-foot">A plan is a record of what was calculated and published at the time you made it. ' +
      'It is not a permission, a forecast, or a promise of a photograph.</p></div>';
  }

  /* A single self-contained HTML file for the field: no scripts, no network, no app. It carries the facts the page
     shows, the evidence the plan was made with, when it was made and what it could not know. This is the only form
     of cold-start offline access this release claims. */
  function offlinePlanHTML(record, context) {
    var ctx = context || {};
    var site = (record && record.site) || { name: 'saved location', tz: '' };
    var zone = site.tz || 'UTC';
    var clock = function (ms) {
      if (!Number.isFinite(ms)) return '--';
      try { return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); }
      catch (error) { return new Date(ms).toISOString().slice(11, 16) + ' UTC'; }
    };
    var conditions = ctx.conditions || {};
    var forecast = conditions.forecast || null;
    var access = conditions.access || null;
    var rows = [];
    var row = function (key, value) { if (value) rows.push('<tr><th>' + esc(key) + '</th><td>' + value + '</td></tr>'); };
    row('Destination', esc(site.name || 'saved location') + (record && record.pointId ? ' (verified observation point)' : ' (your own location, unverified)'));
    row('Coordinates', Number.isFinite(site.lat) ? esc(site.lat.toFixed(4)) + ', ' + esc(site.lon.toFixed(4)) : 'not recorded');
    row('Local timezone', esc(zone));
    row('Night', esc(record && record.date ? record.date : 'not recorded'));
    if (record && record.window) row('Observing window', esc(clock(record.window.start)) + ' - ' + esc(clock(record.window.end)) + ' (' + esc(record.window.minutes) + ' min, ' + esc(record.window.level || '') + ')');
    if (record && record.core) row('Best moment', esc(clock(record.core.bestTime)) + ' · core ' + esc(Number(record.core.bestAltitudeDeg).toFixed(1)) + '° up, bearing ' + esc(Number(record.core.maxAzimuthDeg).toFixed(0)) + '° ' + esc(record.core.maxCompass));
    if (record && record.moon) row('Moon', esc(String(record.moon.classification).replace(/-/g, ' ')) + (record.moon.detail ? ' — ' + esc(record.moon.detail) : ''));
    if (record && record.darkness) row('Darkness', esc(String(record.darkness.achieved).replace(/-/g, ' ')) + ' twilight reached');
    if (record && Number.isFinite(record.quality)) row('Window quality', esc(record.quality) + ' / 100 — this category only, not comparable with satellite or meteor values');
    row('Forecast', forecast ? esc(forecast.label) + (forecast.whenLabel ? ' · ' + esc(forecast.whenLabel) : '') : 'not recorded in this plan');
    if (forecast && forecast.rows && forecast.rows.length) {
      row('Forecast detail', forecast.rows.map(function (entry) { return esc(entry[0]) + ': ' + esc(entry[1]); }).join(' · '));
    }
    if (forecast && forecast.lastKnown) {
      row('Last-known forecast', esc(forecast.lastKnown.label) + ' · ' + esc(forecast.lastKnown.whenLabel) +
        ' — saved with the plan, not current');
      if (forecast.lastKnown.rows && forecast.lastKnown.rows.length) {
        row('Last-known detail', forecast.lastKnown.rows.map(function (entry) { return esc(entry[0]) + ': ' + esc(entry[1]); }).join(' · '));
      }
    }
    if (record && record.terrain) row('Terrain toward the core', esc(record.terrain.state) + ' · modeled horizon ' + esc(record.terrain.horizonAngleDeg) + '° at bearing ' + esc(record.terrain.azimuthDeg) + '°, clearance ' + esc(record.terrain.differenceDeg) + '° ±' + esc(record.terrain.uncertaintyDeg) + '° — bare earth, no trees or buildings');
    else row('Terrain toward the core', 'no bare-earth profile for this place, and none is invented');
    appendOfflineAccessRows(row, access);
    return offlinePlanDocument(record, ctx, rows, clock);
  }

  function appendOfflineAccessRows(row, access) {
    if (!access) return;
    row('Access at planning time', esc(access.savedShort || access.short || access.label || ''));
    row('Access status', esc(access.label) + (access.verifiedAt ? ' · verified ' + esc(access.verifiedAt) : ''));
    if (access.changes && access.changes.length) {
      row('Changed since', access.changes.map(function (change) {
        var from = Array.isArray(change.saved) ? change.saved.join('; ') : change.saved;
        var to = Array.isArray(change.current) ? change.current.join('; ') : change.current;
        return esc(change.field) + ': was ' + esc(from || 'not recorded') + ', now ' + esc(to || 'not recorded');
      }).join(' · '));
    }
    if (access.officialUrl) row('Official source', '<a href="' + esc(access.officialUrl) + '">' + esc(access.officialUrl) + '</a>');
  }

  function offlinePlanDocument(record, ctx, rows, clock) {
    var site = (record && record.site) || { name: 'saved location' };
    var gear = record && record.checklist ? Object.keys(record.checklist).filter(function (key) { return record.checklist[key]; }) : [];
    var gearList = api.CHECKLIST.map(function (item) {
      return '<li>' + (record && record.checklist && record.checklist[item.id] ? '[x]' : '[ ]') + ' ' + esc(item.label) + '</li>';
    }).join('');
    var outstanding = api.READINESS.filter(function (item) { return !(record && record.readiness && record.readiness[item.id]); })
      .map(function (item) { return '<li>' + esc(item.label) + '</li>'; }).join('');
    var made = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Field plan: ' + esc(site.name || 'saved location') + ' · ' + esc(record && record.date ? record.date : '') + '</title>' +
      '<style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:46rem;padding:18px;color:#111;background:#fff}' +
      'h1{font-size:1.3rem;margin:0 0 4px}h2{font-size:1rem;margin:20px 0 6px;border-bottom:1px solid #111;padding-bottom:2px}' +
      'table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:4px 8px 4px 0;border-bottom:1px solid #ddd}' +
      'th{white-space:nowrap;font-weight:600;width:38%}ul{padding-left:18px;margin:4px 0}.note{font-size:.85rem;color:#333}' +
      '@media print{body{max-width:none;padding:0}h2{break-after:avoid}}@page{margin:16mm}</style></head><body>' +
      '<h1>Milky Way field plan: ' + esc(site.name || 'saved location') + '</h1>' +
      '<p class="note">Made by Worth Looking Up on ' + esc(made) + ' UTC. This file works with no network. Everything in it was ' +
      'calculated or published when it was made; nothing here is a permission, a forecast for a different place, or a promise ' +
      'of a photograph.</p>' +
      '<h2>Where and when</h2><table>' + rows.join('') + '</table>' +
      '<h2>Equipment (' + gear.length + ' of ' + api.CHECKLIST.length + ' ticked)</h2><ul>' + gearList + '</ul>' +
      '<h2>Still to do before leaving</h2><ul>' + (outstanding || '<li>Nothing left on the pre-departure list.</li>') + '</ul>' +
      '<p class="note">This file cannot verify a rule, a gate, a road or the sky. Check the agency source and the local forecast ' +
      'before you go.</p>' +
      (record && record.notes ? '<h2>Notes</h2><p>' + esc(record.notes).replace(/\n/g, '<br>') + '</p>' : '') +
      (record && record.limitations && record.limitations.length ? '<h2>Unresolved</h2><ul>' +
        record.limitations.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul>' : '') +
      '</body></html>';
  }

  api.offlinePlanHTML = offlinePlanHTML;
  api.render = render;
})(typeof self !== 'undefined' ? self : globalThis);
