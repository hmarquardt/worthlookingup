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
  function readChecklist(storage, defaults) {
    var stored = storage && typeof storage.get === 'function' ? storage.get(CHECKLIST_KEY, null) : null;
    var state = {};
    (defaults || CHECKLIST).forEach(function (item) {
      state[item.id] = stored && typeof stored[item.id] === 'boolean' ? stored[item.id] : false;
    });
    return state;
  }

  root.OverheadSessions = { SCHEMA: SCHEMA, CHECKLIST: CHECKLIST, SENSORS: SENSORS, MAX_SESSIONS: MAX_SESSIONS,
    LIST_KEY: LIST_KEY, CURRENT_KEY: CURRENT_KEY, CHECKLIST_KEY: CHECKLIST_KEY, MAX_NOTES: MAX_NOTES,
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

  function conditionsBlock(conditions) {
    if (!conditions) return '<p class="small">Calculating this night at this place…</p>';
    if (conditions.why) {
      return '<div class="sx-nowindow"><p><strong>' + esc(conditions.why.headline) + '</strong></p><p class="small">' +
        esc(conditions.why.detail) + '</p><p class="small">A session saved for this night would hold an observing window that ' +
        'does not exist, so there is nothing to save. Choose another date above: the next favourable night is offered ' +
        'when the engine finds one, and a date months away is still fine — only the astronomy is certain that far ahead.</p></div>';
    }
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
    var html = '<dl class="sx-facts">' + facts.join('') + '</dl>';
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
    if (conditions.weather) {
      html += '<p class="small sx-weather"><strong>Weather:</strong> ' + esc(conditions.weather.label) +
        (conditions.weather.detail ? ' ' + esc(conditions.weather.detail) : '') + '</p>';
    }
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
    return step(4, 'Prepare',
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
    return step(5, 'Save or export',
      '<label class="sx-notes"><span>Notes for the field</span><textarea data-session-input="notes" rows="3" maxlength="' + api.MAX_NOTES +
        '" placeholder="Meeting point, gate code you already know, frames you want…">' + esc(ctx.state.notes || '') + '</textarea></label>' +
      '<div class="sx-actions">' +
      '<button type="button" class="sx-primary" data-session="save"' + disabled + '>Save this plan</button>' +
      '<button type="button" data-session="print"' + disabled + '>Print field plan</button>' +
      '<button type="button" data-session="calendar"' + disabled + '>Add to calendar</button>' +
      '<button type="button" data-session="plan"' + disabled + '>Add to observing plan</button>' +
      '<button type="button" data-session="refresh"' + (ctx.session ? '' : ' disabled') + '>Refresh evidence and forecast</button>' +
      '</div>' +
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
      prepareBlock(context) +
      saveBlock(context) +
      '<p class="small sx-foot">A plan is a record of what was calculated and published at the time you made it. ' +
      'It is not a permission, a forecast, or a promise of a photograph.</p></div>';
  }

  api.render = render;
})(typeof self !== 'undefined' ? self : globalThis);
