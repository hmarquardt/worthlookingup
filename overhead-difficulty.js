/* Overhead observing difficulty: a conservative, object-specific explanation of what it takes to see
   or photograph a calculated opportunity. Pure computation: no DOM, storage, network or scoring.

   This module deliberately does not replace the observing-suitability score. That score describes the
   opportunity (geometry, darkness, moonlight, optical demand, weather and significance). Difficulty is a
   separate answer: how much aperture, technique and experience a target is likely to need. A faint comet
   can have a favourable opportunity and still be an advanced visual target.

   The rules are documented heuristics for this product, not an astronomical standard and not a limiting-
   magnitude calculator. Total comet magnitude is never treated as a stellar point-source magnitude, and a
   coma size is never converted into surface brightness unless its unit is verified. */
(function (root) {
'use strict';

var SCHEMA = 'worthlookingup.equipment/1';
var AU_KM = 149597870.7;
var LEVELS = Object.freeze([
  { level: 1, id: 'easy', label: 'Easy' },
  { level: 2, id: 'accessible', label: 'Accessible' },
  { level: 3, id: 'moderate', label: 'Moderate' },
  { level: 4, id: 'challenging', label: 'Challenging' },
  { level: 5, id: 'advanced', label: 'Advanced' },
]);
var LEVEL_BY_ID = {};
LEVELS.forEach(function (entry) { LEVEL_BY_ID[entry.id] = entry; LEVEL_BY_ID[entry.level] = entry; });
var EQUIPMENT_LABELS = Object.freeze({
  'naked-eye': 'Naked eye',
  binoculars: 'Binoculars',
  'small-telescope': 'Small visual telescope (about 80–150 mm)',
  'large-telescope': 'Larger visual telescope (about 200 mm or more)',
  'smart-telescope': 'Smart telescope',
  'camera-widefield': 'Camera and wide-field lens on a tripod',
  'tracked-imaging': 'Tracked camera imaging',
  'advanced-imaging': 'Advanced guided imaging',
  'solar-filter': 'Certified solar filter',
  unknown: 'Not established',
});
var SENSORS = ['full-frame', 'aps-c', 'micro-four-thirds', 'unknown'];
// Equatorial radii in km, used only to turn a published geocentric distance into an approximate
// angular diameter. Sources: NASA planetary fact sheets (nssdc.gsfc.nasa.gov/planetary/factsheet/).
var BODY_RADIUS_KM = Object.freeze({
  Mercury: 2439.7, Venus: 6051.8, Mars: 3389.5, Jupiter: 69911, Saturn: 58232,
  Uranus: 25362, Neptune: 24622, Moon: 1737.4, Sun: 695700,
});
var TELESCOPIC_PLANETS = ['Uranus', 'Neptune'];
var CLASSICAL_PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function number(value) {
  if (finite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function round(value, digits) {
  return finite(value) ? Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits) : null;
}
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function levelOf(value) {
  if (finite(value)) {
    var numeric = Math.round(value);
    if (numeric < 1 || numeric > 5) return null;
    return LEVELS[numeric - 1];
  }
  if (typeof value === 'string' && LEVEL_BY_ID[value]) return LEVEL_BY_ID[value];
  return null;
}
function levelUp(level, amount) { return level ? levelOf(clamp(level.level + (amount || 1), 1, 5)) : null; }
function confidence(value, detail) { return { level: value, detail: detail || '' }; }
function visual(level, detail, certainty) {
  var entry = levelOf(level);
  return entry ? { level: entry.level, id: entry.id, label: entry.label, detail: detail || '', confidence: certainty || confidence('medium', '') }
    : { level: null, id: 'uncertain', label: 'Difficulty uncertain', detail: detail || 'There is not enough object-specific information to classify this target.', confidence: certainty || confidence('unknown', '') };
}
function imaging(level, detail, certainty) {
  var entry = levelOf(level);
  return entry ? { level: entry.level, id: entry.id, label: entry.label, detail: detail || '', confidence: certainty || confidence('medium', '') }
    : { level: null, id: 'uncertain', label: 'Difficulty uncertain', detail: detail || 'No object-specific imaging guidance is available.', confidence: certainty || confidence('unknown', '') };
}
function inputRow(label, value) { return { label: label, value: value === null || value === undefined || value === '' ? 'not available' : String(value) }; }
function equipment(primary, alternatives, minimum) {
  return { primary: primary, label: EQUIPMENT_LABELS[primary] || primary, alternatives: alternatives || [],
    minimum: minimum || null, minimumLabel: minimum ? (EQUIPMENT_LABELS[minimum] || minimum) : null };
}
function profileFit(status, label, detail) { return { status: status, label: label, detail: detail }; }
function result(type, objectType, options) {
  var out = {
    schema: 'worthlookingup.difficulty/1', type: type, objectType: objectType,
    visual: options.visual, imaging: options.imaging || null,
    equipment: options.equipment || equipment('unknown', [], null),
    reasons: options.reasons || [], inputs: options.inputs || [], limitations: options.limitations || [],
    evidence: options.evidence || 'unknown', confidence: options.confidence || 'medium',
    surfaceBrightness: null, profileFit: null,
  };
  out.profileFit = applyProfile(out, options.profile || null);
  return out;
}

/* ---- user-reported equipment profile --------------------------------- */

// A profile is capabilities the reader reports, never a calibrated instrument model. Incomplete values
// are normal and every field is optional. Unknown or malformed input becomes an empty profile.
function normaliseProfile(raw) {
  var source = raw && typeof raw === 'object' ? raw : {};
  var types = source.types && typeof source.types === 'object' ? source.types : {};
  var legacy = typeof source.kind === 'string' ? source.kind : '';
  var bin = source.binoculars && typeof source.binoculars === 'object' ? source.binoculars : {};
  var scope = source.telescope && typeof source.telescope === 'object' ? source.telescope : {};
  var cam = source.camera && typeof source.camera === 'object' ? source.camera : {};
  var flag = function (key, legacyName) { return types[key] === true || legacy === legacyName; };
  var magnification = number(bin.magnification), objective = number(bin.objectiveMm);
  var aperture = number(scope.apertureMm), focal = number(cam.focalLengthMm), fnumber = number(cam.aperture);
  return {
    schema: SCHEMA,
    types: {
      nakedEye: flag('nakedEye', 'naked-eye'),
      binoculars: flag('binoculars', 'binoculars'),
      telescope: flag('telescope', 'telescope'),
      smartTelescope: flag('smartTelescope', 'smart-telescope'),
      camera: flag('camera', 'camera'),
      trackedImaging: flag('trackedImaging', 'tracked-imaging'),
      advancedImaging: flag('advancedImaging', 'advanced-imaging'),
    },
    binoculars: {
      magnification: magnification !== null && magnification >= 1 && magnification <= 60 ? round(magnification, 1) : null,
      objectiveMm: objective !== null && objective >= 10 && objective <= 250 ? round(objective, 0) : null,
    },
    telescope: { apertureMm: aperture !== null && aperture >= 20 && aperture <= 1500 ? round(aperture, 0) : null },
    camera: {
      sensor: SENSORS.indexOf(cam.sensor) > -1 ? cam.sensor : null,
      focalLengthMm: focal !== null && focal >= 1 && focal <= 5000 ? round(focal, 0) : null,
      aperture: fnumber !== null && fnumber >= 0.7 && fnumber <= 64 ? round(fnumber, 1) : null,
      tracking: cam.tracking === true ? true : cam.tracking === false ? false : null,
    },
    updatedAt: finite(source.updatedAt) ? source.updatedAt : Date.now(),
  };
}
function profileHasAny(profile) {
  if (!profile || !profile.types) return false;
  return Object.keys(profile.types).some(function (key) { return profile.types[key] === true; });
}
function profileSummary(profile) {
  var p = normaliseProfile(profile);
  if (!profileHasAny(p)) return 'No equipment profile';
  var parts = [];
  if (p.types.nakedEye) parts.push('Naked eye');
  if (p.types.binoculars) parts.push('Binoculars' + (p.binoculars.magnification && p.binoculars.objectiveMm ? ' ' +
    p.binoculars.magnification + '×' + p.binoculars.objectiveMm : ''));
  if (p.types.telescope) parts.push((p.telescope.apertureMm ? p.telescope.apertureMm + ' mm ' : '') + 'telescope');
  if (p.types.smartTelescope) parts.push('Smart telescope');
  if (p.types.camera) parts.push('Camera' + (p.camera.focalLengthMm ? ' · ' + p.camera.focalLengthMm + ' mm' : '') +
    (p.camera.tracking === true ? ' · tracking' : ''));
  if (p.types.trackedImaging && !p.types.camera) parts.push('Tracked imaging');
  if (p.types.advancedImaging && !p.types.camera) parts.push('Advanced imaging');
  return parts.join(' · ');
}


function applyProfile(assessment, rawProfile) {
  var profile = rawProfile && rawProfile.types ? rawProfile : normaliseProfile(rawProfile || {});
  if (!profileHasAny(profile)) return profileFit('no-profile', 'No equipment profile',
    'Guidance is general. Add your equipment to see how this target relates to what you actually have.');
  var hasBinoculars = profile.types.binoculars, hasScope = profile.types.telescope;
  var cameraProfile = profile.camera || { sensor: null, focalLengthMm: null, aperture: null, tracking: null };
  var telescopeProfile = profile.telescope || { apertureMm: null };
  var aperture = telescopeProfile.apertureMm, hasCamera = profile.types.camera || profile.types.smartTelescope;
  var tracked = profile.types.trackedImaging || profile.types.advancedImaging || cameraProfile.tracking === true ||
    profile.types.smartTelescope;
  var level = assessment.visual && assessment.visual.level;
  if (assessment.type === 'milkyway') {
    if (profile.types.camera) {
      var focal = cameraProfile.focalLengthMm;
      if (focal !== null && focal > 85) return profileFit('possible', 'Your camera is reported with a longer lens',
        'A ' + focal + ' mm lens can photograph part of the band, but a whole-sky Milky Way landscape is easier at a shorter focal length.');
      return profileFit('suitable', 'Your camera is the right kind of instrument',
        'A camera and wide lens on a stable tripod are suited to the wide-field Milky Way' +
        (cameraProfile.tracking ? '; a tracking mount can support longer exposures.' : '.'));
    }
    if (profile.types.smartTelescope) return profileFit('possible', 'A smart telescope is a detail instrument',
      'A smart telescope can capture individual clusters and nebulae, but its field is usually too narrow for a whole-sky Milky Way landscape.');
    if (hasBinoculars) return profileFit('suitable', 'Binoculars can show the band',
      'Binoculars under a genuinely dark sky can reveal the brighter star clouds; they cannot replace a wide-field camera for a landscape photograph.');
    if (hasScope) return profileFit('not-suitable', 'A telescope is not the primary instrument here',
      'A telescope is too narrow for the whole-sky band; it can show individual clusters and nebulae instead.');
    return profileFit('possible', 'Naked-eye viewing is possible under dark skies',
      'The band is a naked-eye target under dark skies; photography needs a camera and wide lens.');
  }
  if (assessment.type === 'meteor-shower') {
    if (hasCamera) return profileFit('suitable', 'A camera can record trails',
      'A wide-field camera on a tripod can record meteors; it is a different technique from watching the shower, not a substitute for it.');
    if (hasBinoculars) return profileFit('possible', 'Binoculars narrow the view',
      'Binoculars show a small patch of sky well, but most meteors are best seen with the unaided eye and a wide field.');
    if (hasScope) return profileFit('not-suitable', 'A telescope is the wrong field of view',
      'A telescope shows too little sky for a meteor watch; use your eyes and keep the field wide.');
    return profileFit('suitable', 'Your eyes are the primary instrument', 'Naked-eye observing under a dark sky is the standard way to watch a shower.');
  }
  if (assessment.type === 'satellite-pass') {
    if (hasScope) return profileFit('challenging', 'A telescope is difficult for a fast pass',
      'A bright satellite can cross the sky in minutes. Manual high-magnification tracking is an advanced exercise; a telescope is not the ordinary beginner tool for a pass.');
    if (hasBinoculars) return profileFit('possible', 'Binoculars may help on a bright pass',
      'Use a wide field and start on the predicted path; a faint satellite may still be invisible.');
    if (hasCamera) return profileFit('suitable', 'A camera can record a trail',
      'A wide-field camera on a tripod can record a bright pass as a streak; this is not a visual observation and depends on brightness and sky conditions.');
    return profileFit('suitable', 'Naked-eye viewing is the usual approach', 'Find a dark view of the predicted path and watch without optical aid.');
  }

  if (assessment.type === 'comet' && level >= 4) {
    if (profile.types.smartTelescope || tracked) return profileFit('possible', 'Imaging may be more practical than visual observing',
      'Stacked or tracked exposures may reveal the comet, but detectability depends on the coma, focal length, exposure time, sky brightness and processing. This is not a promise of a detection.');
    if (hasScope && aperture !== null) {
      if (aperture >= 200) return profileFit('possible', 'A larger visual telescope is the right kind of attempt',
        'A ' + aperture + ' mm telescope may be adequate under dark, moonless skies, but a diffuse comet near this magnitude remains a challenging visual target. Total magnitude is not a stellar limiting magnitude.');
      if (aperture >= 100) return profileFit('challenging', 'Your aperture is on the small side for this comet',
        'A ' + aperture + ' mm telescope may show the brighter part under excellent skies, but this is likely to be difficult. No stellar limiting magnitude establishes a detection.');
      return profileFit('not-suitable', 'Your telescope is likely too small for this comet',
        'A ' + aperture + ' mm aperture is unlikely to show a comet at this total magnitude visually. The estimate is conservative and is not a limiting-magnitude calculation.');
    }
    if (hasBinoculars) return profileFit('not-suitable', 'Binoculars are not the right instrument for this comet',
      'This target is beyond the range where binoculars are a reasonable primary instrument. Keep binoculars for brighter, larger comets.');
    if (hasCamera) return profileFit('possible', 'Your camera may be better than your eyes here',
      'Without tracked imaging, a faint comet is difficult to record. A tracking mount or stacked short exposures may be needed; the outcome is not guaranteed.');
    return profileFit('challenging', 'This is an advanced visual target',
      'A larger telescope, dark skies and experience are likely to be needed; the app cannot confirm a detection from your location.');
  }
  if (assessment.type === 'planet') {
    if (hasScope) return profileFit('suitable', 'Your telescope is the right kind of instrument for detail',
      (aperture ? 'A ' + aperture + ' mm aperture can show a planetary disc under steady air; ' : '') +
      'Atmospheric seeing, not aperture alone, usually limits the detail you can use.');
    if (hasBinoculars) return profileFit('possible', 'Binoculars can identify it, with limited detail',
      'Binoculars may show a bright disc or a close grouping; a small telescope is needed for surface detail and moons.');
    if (hasCamera) return profileFit('possible', 'A camera can record it, but planets need a different technique',
      'Planetary imaging is usually short-exposure or video “lucky imaging”, not a long deep-sky exposure.');
    return profileFit('suitable', 'Naked-eye identification may be possible', 'The main naked-eye question is whether the planet is above the horizon in a dark enough sky; a telescope is needed for detail.');
  }
  if (assessment.type === 'solar-eclipse') {
    return profileFit('challenging', 'A certified solar filter is mandatory',
      'Never look at the Sun without a certified filter. The profile cannot verify that a filter is safe or undamaged.');
  }
  if (hasScope) return profileFit('possible', 'Your telescope may be useful',
    'The fit depends on the object and conditions; this target does not have a more specific aperture model.');
  if (hasBinoculars) return profileFit('possible', 'Binoculars may be useful', 'The fit depends on the object, its size and the sky conditions.');
  if (hasCamera) return profileFit('possible', 'Your camera may be useful', 'The fit depends on the field of view, exposure and sky conditions.');
  return profileFit('no-profile', 'No equipment profile', 'Add what you have for a more direct comparison.');
}


/* ---- object-specific assessments ------------------------------------- */

function angularDiameterArcsec(body, distanceAu) {
  var radius = BODY_RADIUS_KM[body];
  if (!finite(radius) || !finite(distanceAu) || distanceAu <= 0) return null;
  return round(2 * Math.atan(radius / (distanceAu * AU_KM)) * 206264.806, 2);
}

// Comets are diffuse. The levels below use TOTAL magnitude only as a conservative visual tier; they do
// not claim that a telescope reaching a given stellar magnitude will show the comet. A CCD total
// magnitude can include much fainter outer coma than a visual observer records, so when a 30-day median
// is available the fainter of the two is used for the visual tier. No surface brightness is derived.
function assessComet(input, profile) {
  var measured = input && input.measured ? input.measured : null;
  var predicted = input && input.predicted ? input.predicted : null;
  var measuredMagnitude = measured && finite(measured.magnitude) ? measured.magnitude : null;
  var predictedMagnitude = predicted && finite(predicted.magnitude) ? predicted.magnitude : null;
  var age = input && finite(input.measurementAgeDays) ? input.measurementAgeDays : null;
  var method = measured && measured.method ? String(measured.method) : null;
  var median = measured && finite(measured.median30d) ? measured.median30d : null;
  var visualMagnitude = measuredMagnitude;
  if (measuredMagnitude !== null && median !== null && method === 'CCD') visualMagnitude = Math.max(measuredMagnitude, median);
  if (visualMagnitude === null) visualMagnitude = predictedMagnitude;
  var reasons = [], limitations = [], inputs = [];
  var certainty = age === null ? confidence('unknown', 'the age of the photometry is not recorded')
    : age <= 14 ? confidence('high', 'measured ' + round(age, 1) + ' days before this night')
    : age <= 30 ? confidence('medium', 'measured ' + round(age, 1) + ' days before this night')
    : confidence('low', 'the latest measurement is ' + round(age, 1) + ' days before this night');
  if (visualMagnitude === null) {
    return result('comet', 'Diffuse comet', { visual: visual(0, 'No measured or predicted total magnitude is available, so no visual tier is claimed.'),
      imaging: imaging(0, 'No object-specific imaging tier is claimed without a brightness estimate.'),
      equipment: equipment('unknown', [], 'unknown'), reasons: ['The catalog carries no usable brightness for this comet.'],
      inputs: [inputRow('Measured magnitude', measuredMagnitude), inputRow('Predicted magnitude', predictedMagnitude)],
      limitations: ['Without a brightness estimate, any equipment recommendation would be invented.'],
      evidence: 'missing', confidence: 'unknown', profile: profile });
  }
  var level = visualMagnitude <= 3.5 ? 1 : visualMagnitude <= 5.5 ? 2 : visualMagnitude <= 8 ? 2
    : visualMagnitude <= 10.5 ? 3 : visualMagnitude <= 12.5 ? 4 : 5;
  if (finite(input.altitudeDeg) && input.altitudeDeg < 20) { level = Math.min(5, level + 1); reasons.push('The best position is only ' + round(input.altitudeDeg, 1) + '° above the horizon, so atmospheric extinction and horizon haze make it harder.'); }
  if (input.darknessAchieved && input.darknessAchieved !== 'astronomical') { level = Math.min(5, level + 1); reasons.push('The sky does not reach astronomical darkness on this night, which matters for a diffuse target.'); }
  if (input.moonInterference === 'washed-out') { level = Math.min(5, level + 1); reasons.push('Moonlight is strong enough to wash out a faint, diffuse object.'); }
  reasons.unshift('The conservative visual tier comes from a total magnitude of ' + visualMagnitude + ', not from a stellar limiting magnitude.');
  reasons.push('A diffuse comet of this total magnitude is harder to see than a star of the same magnitude because its light is spread over a coma.');
  inputs.push(inputRow('Magnitude used for the visual tier', visualMagnitude + (method === 'CCD' && median !== null && measuredMagnitude !== median ? ' (fainter of the latest CCD value and the 30-day median)' : '')));
  inputs.push(inputRow('Measured total magnitude', measuredMagnitude));
  inputs.push(inputRow('Predicted magnitude', predictedMagnitude));
  if (age !== null) inputs.push(inputRow('Measurement age', round(age, 1) + ' days before this night'));
  if (method) inputs.push(inputRow('Latest measurement method', method));
  if (median !== null) inputs.push(inputRow('30-day median magnitude', median));
  if (measured && measured.observerCount !== null) inputs.push(inputRow('Observers at the latest measurement', measured.observerCount));
  if (finite(input.altitudeDeg)) inputs.push(inputRow('Altitude at the best moment', round(input.altitudeDeg, 1) + '°'));
  if (input.darknessAchieved) inputs.push(inputRow('Darkness', String(input.darknessAchieved).replace(/-/g, ' ')));

  if (measured && measured.trend && finite(measured.trend.magnitudesPerDay)) {
    reasons.push('The published trend is ' + measured.trend.direction + ' (' + measured.trend.magnitudesPerDay + ' mag/day); it is a fit through uneven observations and is not a prediction for tonight.');
  }
  if (measured && predicted && Math.abs(measured.magnitude - predicted.magnitude) >= 1.5) {
    limitations.push('The measured and predicted magnitudes differ by ' + round(Math.abs(measured.magnitude - predicted.magnitude), 1) + ' mag; neither is treated as certainty.');
  }
  if (age !== null && age > 30) limitations.push('The latest photometry is more than a month old; the comet may have changed brightness.');
  if (input.coma && input.coma.value !== null && input.coma.value !== undefined) {
    limitations.push('A coma size is recorded, but its unit is not verified' + (input.coma.unit ? ' (' + input.coma.unit + ')' : '') + ', so no surface brightness is calculated from it.');
  } else {
    limitations.push('No verified coma size is available, so no surface-brightness or detectability estimate is made.');
  }
  limitations.push('Total comet magnitude is not a stellar limiting magnitude. The app does not claim that any aperture will show this comet.');
  var imagingLevel = visualMagnitude <= 6 ? 1 : visualMagnitude <= 8 ? 2 : visualMagnitude <= 11 ? 3 : visualMagnitude <= 13.5 ? 4 : 5;
  var imagingDetail = imagingLevel <= 2 ? 'A camera with a short lens may record the brighter comet and its tail; a tripod can be enough for a short exposure.'
    : imagingLevel === 3 ? 'Tracked exposures or a small telescope with a camera are likely to be needed; stacking improves the result but does not guarantee a detection.'
    : 'Tracked imaging, longer integration and careful processing are likely to be needed. The result depends on the coma, sky brightness, focal length and exposure.';
  return result('comet', 'Diffuse comet', {
    visual: visual(level, 'Total magnitude ' + visualMagnitude + ' sets a conservative visual tier; a diffuse comet is harder than a star of the same magnitude.', certainty),
    imaging: imaging(imagingLevel, imagingDetail, confidence('medium', 'a brightness-tier heuristic, not a camera model')),
    equipment: equipment(level >= 4 ? 'large-telescope' : level === 3 ? 'small-telescope' : 'binoculars',
      level >= 4 ? ['tracked-imaging', 'advanced-imaging'] : level === 3 ? ['tracked-imaging'] : ['naked-eye'],
      level >= 4 ? 'large-telescope' : level === 3 ? 'small-telescope' : 'binoculars'),
    reasons: reasons, inputs: inputs, limitations: limitations,
    evidence: measured ? 'measured' : 'predicted', confidence: certainty.level, profile: profile,
  });
}


function assessPlanet(input, profile) {
  var name = input && input.name ? String(input.name) : 'planet';
  var magnitude = input && finite(input.magnitude) ? input.magnitude : null;
  var angular = input && finite(input.angularDiameterArcsec) ? input.angularDiameterArcsec : null;
  var reasons = [], limitations = [], inputs = [];
  if (magnitude === null) {
    return result('planet', 'Planet', { visual: visual(0, 'The planet brightness is not available, so no visual tier is claimed.'),
      imaging: imaging(0, 'No imaging tier is claimed without the planet magnitude and angular size.'),
      equipment: equipment('unknown', [], 'unknown'), reasons: ['The planetary calculation did not return a magnitude.'],
      limitations: ['Brightness and angular size are both needed for useful guidance.'], evidence: 'missing', confidence: 'unknown', profile: profile });
  }
  var level = TELESCOPIC_PLANETS.indexOf(name) > -1 ? 4 : magnitude <= 6 ? 1 : 3;
  if (angular !== null && angular < 6) level = Math.max(level, 4);
  else if (angular !== null && angular < 15 && level < 3) level = Math.max(level, 3);
  if (name === 'Mercury' || name === 'Venus') level = Math.max(level, 2);
  inputs.push(inputRow('Model magnitude', magnitude + ' (point-source model, not a measurement)'));
  if (angular !== null) inputs.push(inputRow('Approximate angular diameter', angular + ' arcseconds at this distance'));
  if (finite(input.altitudeDeg)) inputs.push(inputRow('Altitude', round(input.altitudeDeg, 1) + '°'));
  reasons.push(name + ' is a point-like planet; its brightness and angular diameter, not a comet-style diffuse-magnitude rule, set this tier.');
  if (angular !== null) reasons.push('At about ' + angular + ' arcseconds across, the disc is ' + (angular >= 15 ? 'large enough for a small telescope to show detail' : angular >= 6 ? 'small but workable with a modest telescope' : 'small enough that detail is challenging') + '.');
  if (TELESCOPIC_PLANETS.indexOf(name) > -1) reasons.push('Uranus and Neptune never become naked-eye objects in this product; they remain star-like points in binoculars or a telescope.');
  if (name === 'Jupiter' || name === 'Saturn') reasons.push('A small telescope can show the disc, and Jupiter\'s brighter moons or Saturn\'s rings are within reach of a modest instrument under steady air.');
  if (name === 'Mercury' || name === 'Venus') limitations.push('Mercury and Venus are often visible only in bright twilight, so contrast and a clear horizon matter more than aperture.');
  limitations.push('Atmospheric seeing, not aperture alone, usually limits planetary detail; a larger telescope does not guarantee a sharper image.');
  if (finite(input.apertureMm) && input.apertureMm > 0) limitations.push('A common rule of thumb is that useful magnification is about twice the aperture in millimetres; beyond that the image is enlarged but not more detailed.');
  var imagingLevel = angular !== null && angular >= 20 ? 2 : 3;
  return result('planet', 'Planet', {
    visual: visual(level, 'A ' + (angular === null ? 'planet' : angular + ' arcsecond disc') + '; identification and detail are different questions. A telescope is for detail, not for finding the planet.',
      confidence('high', 'deterministic planetary geometry and model magnitude')),
    imaging: imaging(imagingLevel, 'Planetary imaging uses short exposures or video, then selects and stacks the sharpest frames; it is not a long deep-sky exposure.',
      confidence('medium', 'a technique tier, not a camera model')),
    equipment: equipment(level >= 4 ? 'large-telescope' : 'small-telescope', level >= 4 ? ['advanced-imaging'] : ['camera-widefield', 'tracked-imaging'],
      TELESCOPIC_PLANETS.indexOf(name) > -1 ? 'small-telescope' : 'naked-eye'),
    reasons: reasons, inputs: inputs, limitations: limitations,
    evidence: 'computed', confidence: 'high', profile: profile,
  });
}


function assessMeteor(input, profile) {
  var zhr = input && finite(input.zhr) ? input.zhr : null;
  var reasons = ['Meteors are a wide-field, dark-adaptation activity: the unaided eye sees more sky than binoculars or a telescope.'];
  if (zhr !== null) reasons.push('The published ZHR is ' + zhr + ', an ideal-sky reference rate and not a forecast for one observer.');
  else reasons.push('The calendar publishes no single ZHR for this shower, so no rate is claimed.');
  return result('meteor-shower', 'Meteor shower', {
    visual: visual(1, 'Naked-eye observing with a wide view of the sky; look away from the radiant so the meteors have a longer apparent path.',
      confidence('high', 'the geometry is calculated; the actual meteor count is statistical')),
    imaging: imaging(3, 'A wide-field camera on a tripod can record bright trails, usually with a long exposure or repeated short frames; tracking is optional, not a substitute for a dark sky.',
      confidence('medium', 'a technique tier, not a camera model')),
    equipment: equipment('naked-eye', ['camera-widefield'], 'naked-eye'),
    reasons: reasons,
    inputs: [inputRow('ZHR', zhr), inputRow('Radiant altitude at best', finite(input.radiantAltitudeDeg) ? round(input.radiantAltitudeDeg, 0) + '°' : null),
      inputRow('Moon interference', input.moonInterference || null)],
    limitations: ['Binoculars and telescopes narrow the field and are not the primary tools for watching a shower.',
      'ZHR is not a promise of meteors tonight; the actual rate depends on the radiant, darkness, moonlight and the shower\'s own variability.'],
    evidence: 'computed', confidence: 'high', profile: profile,
  });
}

function assessSatellite(input, profile) {
  var brightness = input && finite(input.brightness) ? clamp(input.brightness, 0, 1) : null;
  var altitude = input && finite(input.peakAltitudeDeg) ? input.peakAltitudeDeg : null;
  var train = !!(input && input.train);
  var level = train ? 1 : brightness === null ? 2 : brightness >= 0.85 ? 1 : brightness >= 0.55 ? 2 : 3;
  if (altitude !== null && altitude < 20) level = Math.min(5, level + 1);
  var reasons = [train ? 'A Starlink train is a wide-field naked-eye phenomenon; a telescope is too narrow to follow the group.' :
    'A satellite pass is a moving, short-lived target best followed with the unaided eye or a wide field.'];
  if (brightness !== null) reasons.push('This product uses the pass brightness category, not an apparent magnitude; ' + (brightness >= 0.85 ? 'this is an unusually bright object.' : brightness >= 0.55 ? 'it is a bright-catalogue object, but brightness tonight is not guaranteed.' : 'the brightness category is faint or uncertain.'));
  if (altitude !== null) reasons.push('The peak is ' + round(altitude, 0) + '° above the horizon, which affects how easy it is to follow.');
  return result('satellite-pass', train ? 'Starlink train' : 'Satellite pass', {
    visual: visual(level, 'Look along the predicted path with a wide field. No optical aid is required for a bright pass; binoculars can help only if the pass is bright and you can follow it.',
      confidence('medium', 'a brightness-category heuristic, not an apparent-magnitude prediction')),
    imaging: imaging(train || level <= 2 ? 2 : 3, 'A camera on a tripod can record a bright pass as a short streak. Tracking a fast satellite with a long lens is a different, more demanding technique.',
      confidence('medium', 'a technique tier')),
    equipment: equipment('naked-eye', ['camera-widefield'], 'naked-eye'),
    reasons: reasons,
    inputs: [inputRow('Brightness category', brightness), inputRow('Peak altitude', altitude === null ? null : round(altitude, 0) + '°'),
      inputRow('Duration', finite(input.durationSeconds) ? Math.round(input.durationSeconds) + ' seconds' : null)],
    limitations: ['No apparent magnitude is derived; spacecraft orientation and distance can change brightness.',
      'A high-magnification telescope on a manual mount is not an ordinary beginner activity for a fast pass, and tracking a satellite photographically is advanced work.'],
    evidence: 'computed', confidence: 'medium', profile: profile,
  });
}


function assessMilkyWay(input, profile) {
  var coreAltitude = input && finite(input.coreAltitudeDeg) ? input.coreAltitudeDeg : null;
  var darkness = input && input.darknessAchieved ? String(input.darknessAchieved) : null;
  var level = darkness === 'astronomical' ? 1 : 2;
  if (coreAltitude !== null && coreAltitude < 15) level = Math.max(level, 2);
  var reasons = ['The Milky Way band is a naked-eye target under genuinely dark skies; the galactic core is low-contrast and easily lost to moonlight or light pollution.'];
  if (coreAltitude !== null) reasons.push('The core reaches about ' + round(coreAltitude, 0) + '° above the horizon in this window.');
  if (darkness) reasons.push('The sky reaches ' + darkness + ' twilight.');
  reasons.push('For a whole-sky or landscape photograph, a camera and a wide lens on a stable tripod are the right instruments; a telescope is too narrow.');
  return result('milkyway', 'Milky Way band and core', {
    visual: visual(level, 'Naked-eye viewing of the band and core under dark skies. The category\'s window quality is a separate opportunity measure, not a difficulty score.',
      confidence('high', 'deterministic geometry and darkness; sky brightness is not measured')),
    imaging: imaging(2, 'A wide-field camera on a tripod is the usual approach: short exposures can work; a tracking mount supports longer exposures. Only a narrow-field instrument is suitable for individual clusters and nebulae, not for the whole band.',
      confidence('high', 'a technique tier')),
    equipment: equipment('camera-widefield', ['naked-eye'], 'naked-eye'),
    reasons: reasons,
    inputs: [inputRow('Core altitude', coreAltitude === null ? null : round(coreAltitude, 0) + '°'), inputRow('Darkness', darkness),
      inputRow('Moon interference', input.moonInterference || null)],
    limitations: ['Local artificial sky brightness has not been assessed here; a dark-looking forecast is not a measurement of sky brightness.',
      'The window quality shown on the card is this category\'s own 45/30/25 measure and is not comparable with satellite, meteor or planetary scores.',
      'A telescope can show individual clusters and nebulae, but it cannot frame a whole-sky Milky Way landscape.'],
    evidence: 'computed', confidence: 'high', profile: profile,
  });
}

function assessEclipse(input, profile) {
  var solar = input && input.solar === true;
  if (solar) {
    return result('solar-eclipse', 'Solar eclipse', {
      visual: visual(1, 'A solar eclipse is easy to see with a certified solar filter. Never look at the Sun without one, and never use a telescope without a full-aperture solar filter.',
        confidence('high', 'eclipse geometry is deterministic; filter condition cannot be verified by the app')),
      imaging: imaging(3, 'Solar imaging requires a certified full-aperture filter and a camera or telescope designed for it; the app cannot verify your filter.',
        confidence('medium', 'a safety and technique tier')),
      equipment: equipment('solar-filter', ['camera-widefield'], 'solar-filter'),
      reasons: ['The Sun is never safe to view without a certified filter except during the brief total phase of a total eclipse, and only from the path of totality.'],
      limitations: ['The app cannot verify that a filter is certified, undamaged or correctly fitted.'],
      evidence: 'computed', confidence: 'high', profile: profile,
    });
  }
  return result('lunar-eclipse', 'Lunar eclipse', {
    visual: visual(1, 'A lunar eclipse is a naked-eye event; binoculars make the Moon larger and can help with colour, but are not required.',
      confidence('high', 'eclipse geometry is deterministic')),
    imaging: imaging(2, 'A camera on a tripod can record the Moon; a telephoto lens or small telescope gives a larger disc.',
      confidence('high', 'a technique tier')),
    equipment: equipment('naked-eye', ['binoculars', 'camera-widefield'], 'naked-eye'),
    reasons: ['The Moon is bright and large enough to see without optical aid; the Earth\'s shadow is the event.'],
    limitations: ['Weather and local horizon remain the practical limits; the geometry is deterministic.'],
    evidence: 'computed', confidence: 'high', profile: profile,
  });
}

function assessGeneric(input, profile) {
  return result('unknown', 'Unclassified target', {
    visual: visual(0, 'No object-specific difficulty rule exists for this event, so no visual tier is claimed.'),
    imaging: imaging(0, 'No object-specific imaging rule exists for this event.'),
    equipment: equipment('unknown', [], 'unknown'),
    reasons: ['The product does not classify this event type for equipment guidance.'],
    limitations: ['A general magnitude threshold would be misleading across different kinds of object.'],
    evidence: 'missing', confidence: 'unknown', profile: profile,
  });
}


/* ---- normalised opportunity adapter ---------------------------------- */

function profileFor(profile) {
  return profile && profile.types ? profile : normaliseProfile(profile || {});
}

function assessOpportunity(opportunity, profile) {
  if (!opportunity || typeof opportunity !== 'object') return assessGeneric({}, profile);
  var attributes = opportunity.attributes || {};
  var position = (opportunity.positions || []).slice().sort(function (a, b) {
    return (b.altitude || -90) - (a.altitude || -90);
  })[0] || null;
  var category = opportunity.category || '';
  var type = opportunity.type || '';
  if (category === 'comets' && type === 'comet') {
    var measured = attributes.measuredBrightness || null;
    var best = opportunity.best;
    var measuredDate = measured && measured.date ? Date.parse(String(measured.date)) : NaN;
    var age = Number.isFinite(measuredDate) && Number.isFinite(best) ? Math.max(0, (best - measuredDate) / 86400000) : null;
    return assessComet({
      measured: measured, predicted: attributes.predictedBrightness || null, measurementAgeDays: age,
      altitudeDeg: attributes.altitudeAtBest !== undefined ? attributes.altitudeAtBest : (position && position.altitude),
      darknessAchieved: attributes.darknessAchieved || null,
      moonInterference: attributes.moon && attributes.moon.interference || null,
      coma: attributes.coma || null,
    }, profile);
  }
  if (category === 'comets' && (type === 'solar-eclipse' || type === 'lunar-eclipse')) {
    return assessEclipse({ solar: type === 'solar-eclipse' }, profile);
  }
  if (category === 'planets') {
    var objects = (opportunity.objects || []).filter(function (name) { return name !== 'Moon'; });
    var name = objects.filter(function (item) { return CLASSICAL_PLANETS.indexOf(item) > -1; })[0] || objects[0] || 'planet';
    var planetPosition = (opportunity.positions || []).find(function (item) { return item.name === name; }) || position;
    var distance = planetPosition && finite(planetPosition.geoDistanceAu) ? planetPosition.geoDistanceAu : null;
    return assessPlanet({
      name: name,
      magnitude: planetPosition && finite(planetPosition.magnitude) ? planetPosition.magnitude : null,
      angularDiameterArcsec: angularDiameterArcsec(name, distance),
      altitudeDeg: planetPosition && planetPosition.altitude,
      apertureMm: profileFor(profile).telescope.apertureMm,
    }, profile);
  }
  if (category === 'meteors' || type === 'meteor-shower') {
    return assessMeteor({ zhr: attributes.zhr, radiantAltitudeDeg: attributes.radiantAltitudeAtBest !== undefined ? attributes.radiantAltitudeAtBest : attributes.radiantPeakAltitude,
      moonInterference: attributes.moon && attributes.moon.interference || null }, profile);
  }
  if (category === 'milkyway') {
    return assessMilkyWay({ coreAltitudeDeg: attributes.coreMaxAltitude !== undefined ? attributes.coreMaxAltitude : null,
      darknessAchieved: attributes.darknessAchieved || null, moonInterference: attributes.moon && attributes.moon.interference || null }, profile);
  }
  if (category === 'satellites' || type === 'satellite-pass') {
    return assessSatellite({ brightness: attributes.brightness, peakAltitudeDeg: position && position.altitude,
      durationSeconds: attributes.durationSeconds, train: type === 'starlink-train' || opportunitiesIsTrain(opportunity) }, profile);
  }
  return assessGeneric({}, profile);
}

function opportunitiesIsTrain(opportunity) {
  return !!(opportunity && opportunity.objects && opportunity.objects.some(function (name) { return /train/i.test(String(name)); }));
}

/* ---- exports ---------------------------------------------------------- */
root.OverheadDifficulty = {
  SCHEMA: SCHEMA, LEVELS: LEVELS, EQUIPMENT_LABELS: EQUIPMENT_LABELS, BODY_RADIUS_KM: BODY_RADIUS_KM,
  normaliseProfile: normaliseProfile, profileSummary: profileSummary, profileHasAny: profileHasAny,
  angularDiameterArcsec: angularDiameterArcsec, assessComet: assessComet, assessPlanet: assessPlanet,
  assessMeteor: assessMeteor, assessSatellite: assessSatellite, assessMilkyWay: assessMilkyWay,
  assessEclipse: assessEclipse, assessGeneric: assessGeneric, assessOpportunity: assessOpportunity,
  applyProfile: applyProfile, profileFit: profileFit,
};
if (typeof module !== 'undefined') module.exports = root.OverheadDifficulty;
})(typeof self !== 'undefined' ? self : globalThis);

