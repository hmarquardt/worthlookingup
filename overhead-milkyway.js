/* Overhead Milky Way core engine: when the galactic centre is up, how high, in which direction, and
   whether the sky and the Moon allow a dark-sky look at it.

   Pure computation: no DOM, no storage, no network, no fetch, and no new dependency — everything here
   goes through the same pinned Astronomy Engine 2.1.19 build the rest of the celestial layer uses, via
   the helpers in overhead-astro.js. Requires window.OverheadAstro to be loaded first.

   Scope, and the limits that keep it honest:
   * The primary subject is the *galactic centre* (Sagittarius A*, the radio source at RA 17h45m40.04s
     Dec -29 00 28.1 J2000). It is a fixed direction on the celestial sphere, not a solar-system body:
     no parallax, no phase, no light-time, no orbital motion is applied to it.
   * The broader Milky Way band is *not* a brightness model here. `bandSummary` reports how much of the
     galactic plane is above a threshold, from 24 sampled galactic longitudes at b = 0, and nothing more:
     it exists so the interface never implies the whole band is invisible when the core is down.
   * No sky-brightness, light-pollution, transparency or visibility claim is made anywhere. Darkness is
     solar altitude, moonlight is the Moon's own geometry, and clouds are only ever reported from a
     forecast, with its range and age attached.
   See docs/milky-way.md. */

(function (root) {
'use strict';
const A = root.OverheadAstro;
if (!A) throw new Error('overhead-milkyway.js requires overhead-astro.js (window.OverheadAstro)');
const DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (value, digits) => (Number.isFinite(value) ? Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits) : null);

const SCHEMA = 'worthlookingup.milkyway/1';

/* ---- reference coordinates ---------------------------------------------- */

// The galactic centre, from a published radio-astrometry position of Sgr A*. Every number this module
// produces is a rotation of this direction plus the library's time and observer handling.
const CORE = Object.freeze({
  id: 'sagittarius-a-star', name: 'Galactic core (Sagittarius A*)',
  raDeg: 266.41683, decDeg: -29.00781, frame: 'J2000.0',
  source: 'Sgr A* radio position (RA 17h45m40.04s, Dec -29 00 28.1 J2000): Reid & Brunthaler 2004, ' +
    'ApJ 616, 872; the IAU galactic origin lies within 0.06 degrees of it',
});

// IAU galactic coordinates: the transformation constants as adopted, so the band summary is a documented
// rotation and not a hand-built table of sky positions.
const GALACTIC = Object.freeze({
  poleRaDeg: 192.85948, poleDecDeg: 27.12825, poleLongitudeDeg: 122.93192, frame: 'J2000.0',
  convention: 'Galactic longitude l from the galactic centre through the plane; galactic latitude b from ' +
    'the plane. Right ascension measured from north through east.',
  source: 'IAU 1958 galactic frame (Blaauw et al. 1960), the standard J2000 rotation',
});

// The band sample: 24 longitudes round the plane. This is a geometric sample of the plane, never a
// brightness ranking of it — the engine has no photometric model and makes no claim about how bright any
// part of the band is.
const BAND = Object.freeze({ stepDeg: 15, latitudeDeg: 0, points: 24,
  note: 'sampled galactic longitudes at b = 0: geometry of the plane only, not a brightness model' });

/* ---- thresholds, in one place ------------------------------------------- */

const RULES = Object.freeze({
  core: Object.freeze({ usableDeg: 10, goodDeg: 20, photographicDeg: 30, minWindowMinutes: 20 }),
  darkness: Object.freeze({ levels: Object.freeze({ astronomical: -18, nautical: -12, civil: -6 }),
    preferred: 'astronomical', minMinutes: 15 }),
  // Moonlight for a diffuse target: the Moon matters when it is above the horizon AND meaningfully lit AND
  // not far away from the part of the sky being photographed. Phase alone is never the answer, and a
  // bright Moon below the horizon costs nothing.
  moon: Object.freeze({ belowHorizonDeg: -1, lowDeg: 10, moderateIllumination: 0.25, brightIllumination: 0.6,
    closeDeg: 60, farDeg: 110, illumeWeightAtFull: 1, illumeWeightAtQuarter: 0.35 }),
  weather: Object.freeze({ horizonHours: 72 }),
  refraction: Object.freeze({ display: 'Astronomy Engine standard refraction is applied above the horizon; ' +
    'airless core altitude and the size of the correction are both reported' }),
});

/* ---- galactic to equatorial --------------------------------------------- */

// Standard IAU galactic-to-equatorial rotation. Written out rather than hidden in a library call so the
// constants above are visibly the only inputs, and unit-tested against the Sgr A* position it must
// reproduce (l = 0, b = 0 lands within 0.06 degrees of it by construction of the frame).
function galacticToEquatorial(lDeg, bDeg) {
  const l = lDeg * D2R, b = bDeg * D2R;
  const raP = GALACTIC.poleRaDeg * D2R, decP = GALACTIC.poleDecDeg * D2R, lN = GALACTIC.poleLongitudeDeg * D2R;
  // Galactic north pole in equatorial coordinates: this alone fixes the third basis vector.
  const pole = { x: Math.cos(decP) * Math.cos(raP), y: Math.cos(decP) * Math.sin(raP), z: Math.sin(decP) };
  // The north celestial pole described in the galactic frame. Its galactic latitude is the pole's
  // declination (the angle between the two poles is 90 - decP), and its galactic longitude is the adopted
  // l_NCP constant. Solving (0,0,1) = n1*X + n2*(pole x X) + n3*pole for the galactic centre direction X
  // gives the rotation below; no second table of sky positions is involved.
  const bN = decP;
  const n1 = Math.cos(bN) * Math.cos(lN), n2 = Math.cos(bN) * Math.sin(lN), n3 = Math.sin(bN);
  const length = Math.hypot(n1, n2);
  const unit = v => { const radius = Math.hypot(v.x, v.y, v.z); return { x: v.x / radius, y: v.y / radius, z: v.z / radius }; };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const perpendicular = { x: -n3 * pole.x, y: -n3 * pole.y, z: 1 - n3 * pole.z };
  const P = unit(perpendicular), Q = cross(pole, P);
  const X = unit({ x: (n1 * P.x - n2 * Q.x) / length, y: (n1 * P.y - n2 * Q.y) / length,
    z: (n1 * P.z - n2 * Q.z) / length });
  const Y = cross(pole, X);
  const cosB = Math.cos(b), along = cosB * Math.cos(l), across = cosB * Math.sin(l), up = Math.sin(b);
  const x = along * X.x + across * Y.x + up * pole.x;
  const y = along * X.y + across * Y.y + up * pole.y;
  const z = along * X.z + across * Y.z + up * pole.z;
  return { raDeg: ((Math.atan2(y, x) * R2D) % 360 + 360) % 360,
    decDeg: Math.asin(clamp(z, -1, 1)) * R2D, frame: GALACTIC.frame };
}

const coreEquatorial = () => ({ raDeg: CORE.raDeg, decDeg: CORE.decDeg, frame: CORE.frame, id: CORE.id,
  reference: CORE.source });

// Where an observer must look for a J2000 direction right now. Delegates to overhead-astro.js so the core
// is placed with exactly the same frame handling as every planet and star in the product, and reports the
// airless altitude and the refraction correction beside it rather than hiding the choice.
function horizontalOfJ2000(raDeg, decDeg, date, site, options) {
  const naive = options && options.refraction === 'none';
  const found = A.horizontalFromJ2000(raDeg, decDeg, date, site, { refraction: naive ? 'none' : 'normal' });
  const airless = naive ? found : A.horizontalFromJ2000(raDeg, decDeg, date, site, { refraction: 'none' });
  return { t: found.t, altitude: found.altitude, airlessAltitude: airless.altitude, azimuth: found.azimuth,
    compass: A.compass(found.azimuth), refractionDeg: round(found.altitude - airless.altitude, 3),
    refractionApplied: !naive,
    frame: 'topocentric horizontal, J2000 position rotated to the true equator of date' };
}
const coreHorizontal = (date, site, options) => horizontalOfJ2000(CORE.raDeg, CORE.decDeg, date, site, options);



/* ---- the band, as geometry only ----------------------------------------- */

// How much of the galactic plane is above a threshold, and where its highest sampled point is. This is
// deliberately not a brightness map: it exists so the interface can say honestly whether the band is up
// when the core is not. Because the plane is a great circle, about half of it is above the horizon at any
// latitude and any time, which is why "the core is down" is never "the Milky Way is invisible".
function bandSummary(date, site, options) {
  const points = [];
  for (let index = 0; index < BAND.points; index++) {
    const longitudeDeg = index * BAND.stepDeg;
    const eq = galacticToEquatorial(longitudeDeg, BAND.latitudeDeg);
    const hor = horizontalOfJ2000(eq.raDeg, eq.decDeg, date, site, options);
    points.push({ longitudeDeg, altitude: round(hor.altitude, 2), azimuth: round(hor.azimuth, 2), compass: hor.compass });
  }
  const above = threshold => points.filter(point => point.altitude >= threshold).length;
  const highest = points.slice().sort((a, b) => b.altitude - a.altitude)[0];
  const core = points[0];
  return { at: horizontalOfJ2000(CORE.raDeg, CORE.decDeg, date, site, options).t,
    sampled: BAND.points, stepDeg: BAND.stepDeg, latitudeDeg: BAND.latitudeDeg,
    above: { usableDeg: above(RULES.core.usableDeg), goodDeg: above(RULES.core.goodDeg),
      photographicDeg: above(RULES.core.photographicDeg), horizon: above(0) },
    coreSample: { altitude: core.altitude, azimuth: core.azimuth, compass: core.compass },
    highest: { longitudeDeg: highest.longitudeDeg, altitude: highest.altitude, azimuth: highest.azimuth,
      compass: highest.compass },
    statement: above(0) + ' of ' + BAND.points + ' sampled galactic longitudes are above the horizon here; ' +
      'about half of a great circle is always up, so the band itself is visible even when the core is not.',
    note: BAND.note, provenance: { frame: GALACTIC.frame, source: GALACTIC.source } };
}

/* ---- the Moon, at a moment ---------------------------------------------- */

function moonAt(t, site, corePosition) {
  const moon = A.moonInfo(t, site);
  const separationDeg = Number.isFinite(moon.altitude) && corePosition && Number.isFinite(corePosition.altitude)
    ? A.horizonSeparation(moon.altitude, moon.azimuth, corePosition.altitude, corePosition.azimuth) : null;
  return { t, altitude: round(moon.altitude, 2), azimuth: round(moon.azimuth, 2), compass: A.compass(moon.azimuth),
    illumination: round(moon.phaseFraction, 3), separationDeg: round(separationDeg, 2) };
}

// The five states the interface shows, decided by where the Moon actually is and how lit it actually is,
// never by phase alone. A bright Moon below the horizon is a good night; the same Moon 30 degrees from the
// core is not.
function moonInterferenceFor(series, window) {
  const inside = series.filter(sample => sample.t >= window.start && sample.t <= window.end);
  if (!inside.length || !inside.some(sample => sample.moon && Number.isFinite(sample.moon.altitude))) {
    return { classification: 'moon-uncertain', detail: 'the Moon position could not be evaluated for this window',
      metrics: null };
  }
  const minutes = Math.max(1, (window.end - window.start) / MINUTE);
  const step = inside.length > 1 ? (inside[inside.length - 1].t - inside[0].t) / (inside.length - 1) / MINUTE : minutes;
  const above = inside.filter(sample => sample.moon.altitude > RULES.moon.belowHorizonDeg);
  const lit = above.filter(sample => sample.moon.altitude >= RULES.moon.lowDeg &&
    sample.moon.illumination >= RULES.moon.moderateIllumination);
  const bright = lit.filter(sample => sample.moon.illumination >= RULES.moon.brightIllumination);
  const separations = lit.filter(sample => Number.isFinite(sample.moon.separationDeg))
    .map(sample => sample.moon.separationDeg);
  const metrics = {
    upFraction: round(Math.min(1, above.length * step / minutes), 3),
    litUpFraction: round(Math.min(1, lit.length * step / minutes), 3),
    brightUpFraction: round(Math.min(1, bright.length * step / minutes), 3),
    illuminationAtBest: lit.length ? Math.max(...lit.map(sample => sample.moon.illumination)) : 0,
    minSeparationDeg: separations.length ? round(Math.min(...separations), 1) : null,
  };
  const out = { metrics, detail: null, classification: 'some-moonlight' };
  if (!above.length) {
    out.classification = 'moon-below-horizon';
    out.detail = 'the Moon is below the horizon for the whole window';
  } else if (!lit.length) {
    out.classification = 'moon-low-illumination';
    out.detail = 'the Moon is up for ' + Math.round(metrics.upFraction * 100) + '% of the window but is under ' +
      Math.round(RULES.moon.moderateIllumination * 100) + '% lit or below ' + RULES.moon.lowDeg +
      ' degrees altitude, so it adds little to the sky background';
  } else if (metrics.brightUpFraction >= 0.35 || (bright.length &&
      Number.isFinite(metrics.minSeparationDeg) && metrics.minSeparationDeg <= RULES.moon.closeDeg)) {
    out.classification = 'significant-moonlight';
    out.detail = 'a Moon ' + Math.round(metrics.illuminationAtBest * 100) + '% lit is up for ' +
      Math.round(metrics.brightUpFraction * 100) + '% of the window' +
      (Number.isFinite(metrics.minSeparationDeg) ? ', within ' + metrics.minSeparationDeg +
        ' degrees of the core' : '') + ': expect a brighter sky background towards it';
  } else {
    out.classification = 'some-moonlight';
    out.detail = 'the Moon is up and lit for ' + Math.round(metrics.litUpFraction * 100) + '% of the window, up to ' +
      Math.round(metrics.illuminationAtBest * 100) + '% lit' +
      (Number.isFinite(metrics.minSeparationDeg) ? ', ' + metrics.minSeparationDeg + ' degrees from the core' : '');
  }
  return out;
}


/* ---- one night: darkness, the core track, and their intersection -------- */

// Core altitude sampling for one interval. Bisected edges to about ten seconds, exactly as the astro
// layer refines its own twilight edges, so a coarse scan can never move a window edge by minutes.
function coreTrack(site, start, end, stepMinutes) {
  const step = Math.max(1, stepMinutes || 10) * MINUTE;
  const at = t => coreHorizontal(t, site).altitude;
  const samples = [];
  let max = { t: start, altitude: -90 };
  for (let t = start; ; t = Math.min(t + step, end)) {
    const altitude = at(t);
    samples.push({ t, altitude });
    if (altitude > max.altitude) max = { t, altitude };
    if (t >= end) break;
  }
  // Refine the peak on a one-minute grid around the coarse sample: the core crosses its highest point
  // slowly, so a coarse scan can be more than a degree low without this.
  for (let t = Math.max(start, max.t - step); t <= Math.min(end, max.t + step); t += MINUTE) {
    const altitude = at(t);
    if (altitude > max.altitude) max = { t, altitude };
  }
  const intervalsFor = threshold => {
    const out = [];
    let open = null, previous = null;
    for (const sample of samples) {
      const above = sample.altitude >= threshold;
      if (above && open === null) {
        open = previous && previous.t < sample.t && !previous.above
          ? bisectCore(site, previous.t, sample.t, threshold) : start;
      } else if (!above && open !== null) {
        out.push([open, bisectCore(site, Math.max(start, sample.t - step), sample.t, threshold, true)]);
        open = null;
      }
      previous = { t: sample.t, above };
    }
    if (open !== null) out.push([open, end]);
    return out.filter(([a, b]) => b > a);
  };
  const usable = intervalsFor(RULES.core.usableDeg), good = intervalsFor(RULES.core.goodDeg),
    photographic = intervalsFor(RULES.core.photographicDeg);
  const peak = coreHorizontal(max.t, site);
  return { samples, maxAltitude: max.altitude, maxTime: max.t,
    maxAzimuth: round(peak.azimuth, 2), maxCompass: peak.compass,
    intervals: { usableDeg: usable, goodDeg: good, photographicDeg: photographic },
    minutes: { usableDeg: totalMinutes(usable), goodDeg: totalMinutes(good), photographicDeg: totalMinutes(photographic) },
    rise: usable.length ? usable[0][0] : null, set: usable.length ? usable[usable.length - 1][1] : null };
}
// Bisect a crossing of `threshold`. `inverted` refines the closing edge of an above-horizon interval.
function bisectCore(site, low, high, threshold, inverted) {
  const above = t => coreHorizontal(t, site).altitude >= threshold;
  let a = low, b = high;
  const sense = above(a);
  while (b - a > 10000) {
    const middle = (a + b) / 2;
    if (above(middle) === sense) a = middle; else b = middle;
  }
  return inverted ? b : a;
}
const totalMinutes = intervals => Math.round(intervals.reduce((sum, [a, b]) => sum + (b - a), 0) / MINUTE);
function intersectIntervals(left, right) {
  const out = [];
  for (const [a, b] of left) for (const [c, d] of right) {
    const start = Math.max(a, c), end = Math.min(b, d);
    if (end - start > 0) out.push([start, end]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}
// A plain-language name for the dark level a night reaches. "Astronomical twilight" would read as the
// opposite of what a window at that level means, so the levels are named for the darkness they give.
const darknessPhrase = level => level === 'astronomical' ? 'astronomical darkness'
  : level === 'nautical' ? 'nautical twilight darkness' : level === 'civil' ? 'civil twilight darkness'
  : 'no real darkness';
const longestInterval = intervals => intervals.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] || null;

/* ---- the window quality, one documented formula ------------------------- */

// Weights and shape, stated once:
//   quality = 100 * (0.45 * core + 0.30 * darkness + 0.25 * moon)
//   core     = the highest core altitude inside the window, mapped from the usable threshold (10 deg, 0)
//              to the photographic threshold (30 deg, 1)
//   darkness = minutes of the window at the achieved twilight level, capped at 240, multiplied by the
//              level factor (astronomical 1, nautical 0.6, civil 0.25)
//   moon     = 1 - (fraction of the window with a lit Moon above 10 deg) * illumination weight *
//              separation weight, where those weights are the documented rules
// Each factor is monotone in its own inputs, which the tests assert directly: more core altitude, more
// darkness and less moonlight can never lower the value, and no input can push it out of 0..100.
// This number is this category's own measure. It is deliberately not comparable with the satellite,
// meteor or planetary observing values: those describe a point source crossing the sky, this describes a
// diffuse arc of sky, and no shared scale is implied by either number existing.
const QUALITY_WEIGHTS = Object.freeze({ core: 0.45, darkness: 0.30, moon: 0.25 });
const DARKNESS_LEVEL_FACTOR = Object.freeze({ astronomical: 1, nautical: 0.6, civil: 0.25 });
const DARKNESS_FULL_MINUTES = 240;

function moonFactorFor(moon) {
  const metrics = moon || {};
  const lit = clamp(Number.isFinite(metrics.litUpFraction) ? metrics.litUpFraction : 0, 0, 1);
  const illumination = clamp(Number.isFinite(metrics.illuminationAtBest) ? metrics.illuminationAtBest : 0, 0, 1);
  const span = RULES.moon.brightIllumination - RULES.moon.moderateIllumination;
  const position = span > 0 ? clamp((illumination - RULES.moon.moderateIllumination) / span, 0, 1) : 1;
  const illumeWeight = RULES.moon.illumeWeightAtQuarter +
    (RULES.moon.illumeWeightAtFull - RULES.moon.illumeWeightAtQuarter) * position;
  // Separation from the part of the sky being photographed: the closer the lit Moon is to the core, the
  // more it brightens exactly what the camera is pointed at, so the weight falls from 1 at the close
  // threshold to a floor at the far threshold and never reaches zero — a Moon anywhere in the sky lifts the
  // background of a wide exposure.
  const separation = Number.isFinite(metrics.minSeparationDeg) ? metrics.minSeparationDeg : RULES.moon.closeDeg;
  const sepWeight = clamp((RULES.moon.farDeg - separation) / (RULES.moon.farDeg - RULES.moon.closeDeg), 0.15, 1);
  return clamp(1 - lit * illumeWeight * sepWeight, 0, 1);
}

function qualityFor(components) {
  const input = components || {};
  const altitude = Number.isFinite(input.maxCoreAltitudeDeg) ? input.maxCoreAltitudeDeg : 0;
  const minutes = Number.isFinite(input.darknessMinutes) ? Math.max(0, input.darknessMinutes) : 0;
  const level = DARKNESS_LEVEL_FACTOR[input.darknessLevel] === undefined ? 0
    : DARKNESS_LEVEL_FACTOR[input.darknessLevel];
  const core = clamp((altitude - RULES.core.usableDeg) / (RULES.core.photographicDeg - RULES.core.usableDeg), 0, 1);
  const darkness = clamp(clamp(minutes / DARKNESS_FULL_MINUTES, 0, 1) * level, 0, 1);
  const moon = moonFactorFor(input.moon);
  const value = Math.round(clamp(100 * (QUALITY_WEIGHTS.core * core + QUALITY_WEIGHTS.darkness * darkness +
    QUALITY_WEIGHTS.moon * moon), 0, 100));
  return { value, factors: { core: round(core, 3), darkness: round(darkness, 3), moon: round(moon, 3) },
    weights: QUALITY_WEIGHTS,
    formula: '100 * (0.45 * core + 0.30 * darkness + 0.25 * moon), each factor 0..1',
    basis: 'geometry, astronomical darkness and moonlight only — a cloud forecast is reported separately ' +
      'and is never folded into this number',
    comparability: 'Milky Way window quality. This category only: it is not comparable with satellite, ' +
      'meteor or planetary observing values.',
    limitations: ['the core altitude is measured at the best moment inside the window, not averaged over it',
      'light pollution, transparency, haze and the observer\'s own dark adaptation are not modelled',
      'the moonlight term uses the illuminated fraction and separation of the Moon, not a sky-brightness model'] };
}

/* ---- a small, bounded cache for the deterministic part ------------------ */

// Analysis of one night depends only on the site, the night window and the sampling options, so it is
// cached: switching between tonight, seven days and ninety days then reuses the nights they share instead
// of recomputing them. The cache is bounded and session-only — it never leaves this module, never touches
// storage, and holds no user data beyond the site coordinates already in the request.
const CACHE = Object.freeze({ limit: 900 });
const cache = new Map();
// Hit and miss counts, so a caller can prove that reused nights were reused rather than recomputed.
const cacheStats = { hits: 0, misses: 0 };
const cacheKey = (night, site, options) => [site.lat, site.lon, night.day || night.start, night.start, night.end,
  options.thresholdDeg, options.stepMinutes, options.solarStepMinutes, options.moonStepMinutes,
  options.clampStart].join('|');
function clearCache() { cache.clear(); cacheStats.hits = 0; cacheStats.misses = 0; }
const cacheSize = () => cache.size;

/* ---- one night, analysed ------------------------------------------------ */

// Everything about one observing night: the twilight the sky reaches, where the core goes, the window
// those two allow, the Moon inside it, and the quality of that window. `night` is the observing night
// (sunset to the following sunrise) as the rest of the product builds it, so midnight crossings and
// daylight-saving transitions are already handled by the caller.
function analyseNight(night, site, options) {
  const opts = options || {};
  const key = cacheKey(night, site, opts);
  if (cache.has(key)) { cacheStats.hits++; return cache.get(key); }
  cacheStats.misses++;
  const result = computeNight(night, site, opts);
  if (cache.size >= CACHE.limit) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
function computeNight(night, site, opts) {
  const start = night.start, end = night.end;
  const darkness = A.darkness(site, start, end, { stepMinutes: opts.solarStepMinutes || 5 });
  const achieved = darkness.achieved;
  const track = coreTrack(site, start, end, opts.stepMinutes || 10);
  const thresholdDeg = clamp(Number.isFinite(opts.thresholdDeg) ? opts.thresholdDeg : RULES.core.goodDeg, 5, 60);
  const darkIntervals = (achieved && achieved !== 'none' ? darkness.intervals[achieved] : []) || [];
  const aboveIntervals = thresholdDeg <= RULES.core.usableDeg ? track.intervals.usableDeg
    : thresholdDeg <= RULES.core.goodDeg ? track.intervals.goodDeg : track.intervals.photographicDeg;
  const overlaps = intersectIntervals(darkIntervals, aboveIntervals)
    .filter(([a, b]) => (b - a) / MINUTE >= Math.max(RULES.core.minWindowMinutes, RULES.darkness.minMinutes));
  const chosen = longestInterval(overlaps);
  const accessible = track.maxAltitude >= RULES.core.usableDeg;
  const base = { schema: SCHEMA, day: night.day || null, start, end,
    site: { lat: site.lat, lon: site.lon, tz: site.tz || null },
    thresholdDeg,
    darkness: { achieved, limited: darkness.limited, intervals: darkness.intervals,
      minutes: Object.fromEntries(Object.entries(darkness.intervals).map(([key, list]) => [key, totalMinutes(list)])),
      best: darkness.best, provenance: darkness.provenance },
    core: { maxAltitude: round(track.maxAltitude, 2), maxTime: track.maxTime, maxAzimuth: track.maxAzimuth,
      maxCompass: track.maxCompass, rise: track.rise, set: track.set, minutes: track.minutes,
      intervals: track.intervals, accessible, refraction: RULES.refraction.display },
    band: bandSummary(new Date(track.maxTime), site, opts),
    window: null, moon: null, series: [], quality: null, observable: false, refusals: [], caveats: [] };
  if (!accessible) {
    return { ...base, refusals: ['the core never rises above ' + RULES.core.usableDeg +
      ' degrees from this latitude on this date; ' + base.band.statement],
      quality: qualityFor({ maxCoreAltitudeDeg: track.maxAltitude, darknessMinutes: 0, darknessLevel: achieved,
        moon: {} }) };
  }
  if (!chosen) {
    return { ...base, refusals: [achieved && achieved !== 'none'
      ? 'the core is above ' + thresholdDeg + ' degrees only outside the ' + achieved + ' twilight window'
      : 'this location does not reach civil twilight darkness on this date, so no dark window exists'],
      quality: qualityFor({ maxCoreAltitudeDeg: track.maxAltitude, darknessMinutes: 0, darknessLevel: achieved,
        moon: {} }) };
  }
  const windowStart = Number.isFinite(opts.clampStart) && chosen[0] < opts.clampStart ? opts.clampStart : chosen[0];
  const observingWindow = { start: windowStart, end: chosen[1], minutes: Math.round((chosen[1] - windowStart) / MINUTE),
    basis: 'the core at or above ' + thresholdDeg + ' degrees during ' + achieved + ' twilight',
    level: achieved, inProgress: windowStart !== chosen[0],
    provenance: { darkness: darkness.provenance,
      geometry: 'J2000 core direction rotated to the local horizon' } };
  // The Moon is sampled only inside the window, where it can actually matter.
  const step = Math.max(5, opts.moonStepMinutes || 15) * MINUTE;
  const series = [];
  for (let t = observingWindow.start; ; t = Math.min(t + step, observingWindow.end)) {
    const core = coreHorizontal(t, site);
    series.push({ t, altitude: round(core.altitude, 2), azimuth: round(core.azimuth, 2), compass: core.compass,
      moon: moonAt(t, site, core) });
    if (t >= observingWindow.end) break;
  }
  const moon = moonInterferenceFor(series, observingWindow);
  // The best moment is the highest core inside the window that is still usable, not the night's global
  // peak: a window that opened while the core was higher is reported honestly.
  const best = series.slice().sort((a, b) => b.altitude - a.altitude)[0];
  const quality = qualityFor({ maxCoreAltitudeDeg: Math.max(best.altitude, thresholdDeg),
    darknessMinutes: observingWindow.minutes, darknessLevel: achieved, moon: moon.metrics || {} });
  return { ...base, observable: true, window: observingWindow, moon, series, quality,
    bestTime: best.t, bestAltitude: best.altitude, bestAzimuth: best.azimuth, bestCompass: best.compass,
    caveats: [quality.comparability,
      'no sky-brightness or light-pollution measurement is made anywhere in this calculation'] };
}


/* ---- photography guidance, from the numbers ----------------------------- */

// Practical notes for someone carrying a camera into the field. Every statement is either a property of the
// geometry computed above or a fixed photographic fact, and none of them promises a result.
function photographyFor(night, options) {
  const opts = options || {};
  const out = { requirements: [], lighting: [], composition: [], caveats: [] };
  if (!night || !night.observable || !night.window) {
    out.caveats.push('No window clears the thresholds on this night, so there is no photographic plan to give.');
    return out;
  }
  out.requirements.push('A tripod: the exposures that show the core are far too long to hand-hold.');
  out.requirements.push('A wide, fast lens. The core and its surrounding star fields span roughly 30 degrees, ' +
    'so a 24 mm lens on a full-frame camera or wider frames it whole; the faster the lens, the longer you can ' +
    'expose before stars trail.');
  out.requirements.push('Manual focus, a remote release or a two-second delay, and raw files: focus and colour ' +
    'are the two things hardest to fix afterwards.');
  out.lighting.push('Astronomical darkness lasts ' + night.darkness.minutes.astronomical + ' minutes on this ' +
    'night, and the observing window is ' + night.window.minutes + ' minutes long (' +
    darknessPhrase(night.window.level) + ').');
  out.lighting.push('The core peaks at ' + Math.round(night.core.maxAltitude) + ' degrees towards ' +
    night.core.maxCompass + ', so that direction is where to point the camera.');
  out.lighting.push('Allow twenty to thirty minutes away from lights before judging the sky: dark adaptation ' +
    'changes what you can see far more than any camera setting.');
  const moon = night.moon || {};
  if (moon.classification === 'moon-below-horizon') {
    out.lighting.push('The Moon is below the horizon for the whole window, so no moonlight competes with the sky.');
  } else if (moon.classification === 'moon-low-illumination') {
    out.lighting.push('The Moon is up but barely lit or low, so its effect on the sky background is small.');
  } else if (moon.classification === 'significant-moonlight') {
    out.lighting.push('A bright Moon is up inside the window: point away from it and expect a brighter sky ' +
      'than on a moonless night.');
  } else if (moon.classification === 'some-moonlight') {
    out.lighting.push('The Moon is up and lit for part of the window: ' + String(moon.detail || '') + '.');
  } else {
    out.lighting.push('Moonlight could not be classified for this window, so treat the sky background as unknown.');
  }
  out.composition.push('The core sits towards ' + night.core.maxCompass + ' at its highest, so a foreground in ' +
    'that direction can share the frame; the band continues round the sky, so any wide view that includes the ' +
    'horizon includes part of it.');
  out.composition.push('Choose a dark site away from town lights: this engine can say when the sky is dark and ' +
    'where the core is, but nothing here measures light pollution.');
  out.caveats.push('This is astronomy and camera guidance, not a prediction of a striking photograph: cloud, ' +
    'haze, smoke and light pollution decide the result, and none of them are in this calculation.');
  if (opts.weatherNote) out.caveats.push(opts.weatherNote);
  return out;
}

/* ---- opportunities for the shared model --------------------------------- */

// One candidate per observing night, in the shape overhead-opportunities.js expects, so the Milky Way
// travels through the same plan, dedupe, ranking, confidence, discovery and calendar machinery as every
// other category while keeping its own measure of quality.
function candidateFor(night, site, options) {
  const opts = options || {};
  const quality = night.quality;
  const band = night.band;
  const window = night.window;
  const positions = [];
  if (night.observable) {
    const points = [['Window opens', window.start], ['Highest', night.bestTime], ['Window closes', window.end]];
    const seen = new Set();
    for (const [name, t] of points) {
      if (seen.has(t)) continue;
      seen.add(t);
      const core = coreHorizontal(t, site);
      const moon = moonAt(t, site, core);
      positions.push({ name: name + ' — core', altitude: round(core.altitude, 1),
        airlessAltitude: round(core.airlessAltitude, 1), azimuth: round(core.azimuth, 1), compass: core.compass,
        optical: 'camera', moonAltitude: moon.altitude, moonIllumination: moon.illumination,
        separationDeg: moon.separationDeg, frame: core.frame, at: t });
    }
  } else {
    const core = coreHorizontal(night.core.maxTime, site);
    positions.push({ name: 'Core at its highest tonight', altitude: round(core.altitude, 1),
      airlessAltitude: round(core.airlessAltitude, 1), azimuth: round(core.azimuth, 1), compass: core.compass,
      optical: 'camera', frame: core.frame, at: night.core.maxTime });
  }
  const summaryParts = night.observable
    ? ['the core is up to ' + Math.round(night.bestAltitude) + ' degrees towards ' + night.bestCompass,
      night.window.minutes + ' minutes during ' + darknessPhrase(night.window.level) + ' with the core above ' +
        night.thresholdDeg + ' degrees',
      night.moon.classification === 'moon-below-horizon' ? 'no moonlight inside the window'
        : 'Moon: ' + String(night.moon.classification).replace(/-/g, ' ')]
    : [night.refusals[0] || 'no window on this night'];
  const why = [];
  if (night.observable) {
    if (night.core.maxAltitude >= RULES.core.photographicDeg) {
      why.push('the core climbs ' + Math.round(night.core.maxAltitude) + ' degrees above the horizon, well into ' +
        'the photographic range');
    }
    if (night.darkness.minutes.astronomical >= 60) {
      why.push(night.darkness.minutes.astronomical + ' minutes of full astronomical darkness');
    }
    if (night.moon.classification === 'moon-below-horizon') why.push('the Moon is down for the whole window');
    if (band.above.goodDeg >= 6) {
      why.push(band.above.goodDeg + ' of ' + band.sampled + ' sampled galactic longitudes are up, so the band ' +
        'frames the core');
    }
  }
  if (!why.length) {
    why.push(night.observable ? 'this is the best dark window available on this date'
      : 'the core is not usefully placed inside the dark hours on this date');
  }
  // For a night with no window the refusal is the reason the plan and the interface must lead with, so it
  // comes first; the band statement stays a caveat behind it rather than becoming the explanation.
  const caveats = [...(night.observable ? [] : night.refusals), ...night.caveats];
  if (!night.observable && band.above.usableDeg) {
    caveats.push('the core is low or down, but part of the galactic plane is still above the horizon: ' +
      band.statement);
  }
  const weatherCaveat = opts.weatherNote || (opts.weatherState === 'unavailable'
    ? 'No forecast is applied at this range, so the sky could be clear or overcast: missing weather is not a ' +
      'clear-sky prediction.'
    : null);
  return {
    kind: 'milky-way', category: 'milkyway', objects: ['Milky Way core'], night: night.day,
    title: night.observable ? 'Milky Way core window — ' + (night.day || 'tonight')
      : 'Milky Way core below the useful altitude — ' + (night.day || 'tonight'),
    summary: summaryParts.join('; ') + '.', why, caveats,
    t: { start: night.observable ? window.start : night.core.maxTime,
      end: night.observable ? window.end : night.core.maxTime,
      best: night.observable ? night.bestTime : night.core.maxTime },
    positions, optical: 'camera', observable: night.observable,
    site: { lat: site.lat, lon: site.lon, tz: site.tz || null, name: site.name || null },
    data: {
      windowQuality: quality.value, qualityBasis: quality.formula, qualityFactors: quality.factors,
      comparability: quality.comparability, positionGrade: 'reference-j2000',
      windowMinutes: night.observable ? window.minutes : 0,
      windowBasis: night.observable ? window.basis : null,
      windowInProgress: !!(night.observable && window.inProgress), thresholdDeg: night.thresholdDeg,
      coreMaxAltitude: night.core.maxAltitude, coreMaxTime: night.core.maxTime,
      coreMaxAzimuth: night.core.maxAzimuth, coreMaxCompass: night.core.maxCompass,
      coreRise: night.core.rise, coreSet: night.core.set, coreMinutes: night.core.minutes,
      coreIntervals: night.core.intervals,
      darknessAchieved: night.darkness.achieved, darknessMinutes: night.darkness.minutes,
      darknessLimited: night.darkness.limited, darknessIntervals: night.darkness.intervals,
      moon: night.moon ? { classification: night.moon.classification, detail: night.moon.detail,
        metrics: night.moon.metrics } : null,
      band: { sampled: band.sampled, above: band.above, highest: band.highest, statement: band.statement },
      chart: chartSeries(night, site, opts), photography: photographyFor(night, { weatherNote: weatherCaveat }),
      refraction: RULES.refraction.display,
    },
    provenance: { library: A.LIBRARY.name + ' ' + A.LIBRARY.version, reference: CORE.source, frame: CORE.frame,
      galacticFrame: GALACTIC.source, dataset: null },
  };
}

// A compact series for the card's chart: core and Moon altitude across the night at a fixed step, with the
// darkness bands taken from the twilight intervals already computed. Capped so the worker payload stays
// small: the chart is a picture of the night, not a data export.
function chartSeries(night, site, options) {
  const opts = options || {};
  const step = Math.max(10, opts.chartStepMinutes || 30) * MINUTE;
  const anchor = night.window || { start: night.core.maxTime - HOUR, end: night.core.maxTime + HOUR };
  const from = Math.max(night.start, anchor.start - 2 * HOUR);
  const to = Math.min(night.end, anchor.end + 2 * HOUR);
  const points = [];
  for (let t = from; t <= to && points.length < 48; t += step) {
    const core = coreHorizontal(t, site);
    points.push({ t, altitude: round(core.altitude, 1), azimuth: round(core.azimuth, 1), compass: core.compass,
      moonAltitude: round(moonAt(t, site, core).altitude, 1) });
  }
  return { stepMinutes: Math.round(step / MINUTE), from, to, points, bands: night.darkness.intervals,
    window: night.window ? { start: night.window.start, end: night.window.end } : null,
    thresholdDeg: night.thresholdDeg };
}

// A horizon summary, so an empty plan can still answer the question honestly: which night came closest,
// how close it was, what the band is doing, and why each night fell short. Computed here rather than in
// the interface so the numbers and the argmax are tested.
function summariseHorizon(analyses, thresholdDeg, options) {
  const opts = options || {};
  const withWindow = analyses.filter(night => night.observable);
  const best = analyses.slice().sort((a, b) => (b.core.maxAltitude || -90) - (a.core.maxAltitude || -90))[0] || null;
  const reasons = [];
  for (const night of analyses) for (const reason of night.refusals || []) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  const band = best ? best.band : null;
  return { nights: analyses.length, withWindow: withWindow.length,
    thresholdDeg,
    bestDay: best ? best.day : null,
    bestCoreAltitude: best ? best.core.maxAltitude : null,
    bestCoreTime: best ? best.core.maxTime : null,
    bestCoreCompass: best ? best.core.maxCompass : null,
    bestCoreAzimuth: best ? best.core.maxAzimuth : null,
    bestDarknessAchieved: best ? best.darkness.achieved : null,
    bestDarknessMinutes: best ? best.darkness.minutes : null,
    bestBestWindowMinutes: withWindow.length
      ? withWindow.slice().sort((a, b) => b.window.minutes - a.window.minutes)[0].window.minutes : 0,
    reasons: reasons.slice(0, 3),
    band: band ? { above: band.above, highest: band.highest, statement: band.statement } : null,
    // The distinction the whole category exists to keep: no core window is not an empty sky.
    note: analyses.length && !withWindow.length
      ? 'No night in this horizon puts the core above ' + thresholdDeg + ' degrees while the sky is dark. ' +
        'That is a statement about the core, not about the Milky Way: the galactic plane is a great circle, ' +
        'so part of the band is above the horizon at every latitude and every hour.'
      : null };
}


// Analyse a list of observing nights (the same window objects the rest of the product uses) and return the
// analysis plus the candidates for the shared opportunity model. Coarser sampling is available for long
// horizons so a 90-day request stays cheap; nothing about the answer changes except the sampling density,

/* ---- the next season, beyond the ninety-day plan ------------------------ */

// The seasonal search answers the question the ninety-day plan cannot: when will the core next be workable
// from here? It walks the observing nights in order and stops as soon as it has the season's first
// qualifying night and the first genuinely favourable one, because scanning chronologically and stopping at
// the first hit is exact. If the year holds nothing, the whole year is scanned and the reason is classified
// rather than guessed.
const SEASON = Object.freeze({
  // One full annual cycle plus a day, so a leap year cannot hide a season between consecutive searches.
  horizonDays: 366,
  // The favourable bar is this category's own quality scale, calibrated against a full year of qualifying
  // nights at the reference sites (see docs/milky-way.md): a marginal season opening scores in the thirties
  // and forties, and the better half of a mid-latitude season scores sixty and above. It is a *planning*
  // bar, never a promise of a photograph, and it is not comparable with any other category's scale.
  favorableQuality: 60,
});

// The local calendar date of an instant at the site, as YYYY-MM-DD. Intl is the only time-zone source in this
// module; if it is unavailable the UTC date is used and the caller still gets a valid string.
function localDate(instant, tz) {
  if (!Number.isFinite(instant)) return null;
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit',
        day: '2-digit' }).formatToParts(new Date(instant));
      const part = name => (parts.find(entry => entry.type === name) || {}).value;
      const value = part('year') + '-' + part('month') + '-' + part('day');
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    } catch (error) { /* fall through to UTC */ }
  }
  return new Date(instant).toISOString().slice(0, 10);
}

// A compact record of one night, with the limitations that make it marginal when it is. `tz` names the
// observing site's zone, so a window that opens at 04:49 is dated to that morning rather than the evening
// before, which is the night's own label.
function seasonNightRecord(night, favorableQuality, tz) {
  const core = night.core, window = night.window, quality = night.quality.value;
  const limitations = [];
  if (window.minutes < 60) limitations.push('the window is only ' + window.minutes + ' minutes long');
  if (core.maxAltitude < RULES.core.photographicDeg) {
    limitations.push('the core stays under ' + RULES.core.photographicDeg + ' degrees, in the worst of the ' +
      'atmosphere');
  }
  if (night.moon && night.moon.classification === 'significant-moonlight') {
    limitations.push('a bright Moon is up inside the window');
  } else if (night.moon && night.moon.classification === 'some-moonlight') {
    limitations.push('the Moon is up for part of the window');
  }
  if (night.darkness.achieved !== 'astronomical') {
    limitations.push('the sky only reaches ' + night.darkness.achieved + ' twilight, not astronomical darkness');
  }
  const series = Array.isArray(night.series) ? night.series : [];
  const first = series[0] || null, last = series.length ? series[series.length - 1] : null;
  return { day: night.day, date: localDate(window.start, tz), start: window.start, end: window.end,
    minutes: window.minutes,
    level: window.level, thresholdDeg: night.thresholdDeg,
    openAltitude: first ? first.altitude : null, openAzimuth: first ? first.azimuth : null,
    openCompass: first ? first.compass : null,
    closeAltitude: last ? last.altitude : null, closeAzimuth: last ? last.azimuth : null,
    closeCompass: last ? last.compass : null,
    coreAltitude: core.maxAltitude, coreTime: core.maxTime, coreCompass: core.maxCompass,
    coreAzimuth: core.maxAzimuth, bestAltitude: night.bestAltitude, bestCompass: night.bestCompass,
    bestTime: night.bestTime,
    darknessMinutes: night.darkness.minutes, darknessAchieved: night.darkness.achieved,
    moon: night.moon ? { classification: night.moon.classification, detail: night.moon.detail,
      metrics: night.moon.metrics } : null,
    quality, factors: night.quality.factors,
    band: night.band ? { above: night.band.above, highest: night.band.highest, statement: night.band.statement } : null,
    favorable: quality >= favorableQuality,
    limitations };
}

// and the window edges are bisected either way.
function analyse(windows, site, options) {
  const opts = options || {};
  const nights = (windows || []).filter(window => window && Number.isFinite(window.start) &&
    Number.isFinite(window.end) && window.end > window.start);
  // The cached night objects are shared between calls, so callers must treat them as read-only.
  const analyses = nights.map(window => analyseNight(window, site, opts));
  const thresholdDeg = clamp(Number.isFinite(opts.thresholdDeg) ? opts.thresholdDeg : RULES.core.goodDeg, 5, 60);
  return { schema: SCHEMA, site: { lat: site.lat, lon: site.lon, tz: site.tz || null, name: site.name || null },
    nights: analyses, candidates: analyses.map(night => candidateFor(night, site, opts)),
    summary: summariseHorizon(analyses, thresholdDeg, opts),
    thresholdDeg,
    provenance: { library: A.LIBRARY.name + ' ' + A.LIBRARY.version, core: CORE.source,
      galacticFrame: GALACTIC.source, refraction: RULES.refraction.display,
      sampling: 'core track every ' + (opts.stepMinutes || 10) + ' minutes with bisected edges; Moon inside ' +
        'the window every ' + Math.max(5, opts.moonStepMinutes || 15) + ' minutes' } };
}

root.OverheadMilkyWay = { SCHEMA, CORE, GALACTIC, BAND, RULES, QUALITY_WEIGHTS, DARKNESS_FULL_MINUTES,
  galacticToEquatorial, coreEquatorial, coreHorizontal, horizontalOfJ2000, bandSummary, moonAt,
  moonInterferenceFor, qualityFor, moonFactorFor, photographyFor, coreTrack, analyseNight, analyse,
  chartSeries, candidateFor, intersectIntervals, longestInterval, summariseHorizon,
  SEASON, analyseSeason, seasonNightRecord, seasonCandidate, classifySeason,
  CACHE, clearCache, cacheSize, cacheStats };
if (typeof module !== 'undefined') module.exports = root.OverheadMilkyWay;

// The seasonal answer for one location. `windows` are the site's own observing nights, in order; the caller
// supplies them (the interface reuses the same builder it uses for the plans, so nothing about nights is
// re-implemented here).
function analyseSeason(windows, site, options) {
  const opts = options || {};
  const started = Date.now();
  const thresholdDeg = clamp(Number.isFinite(opts.thresholdDeg) ? opts.thresholdDeg : RULES.core.goodDeg, 5, 60);
  const favorableQuality = Number.isFinite(opts.favorableQuality) ? opts.favorableQuality : SEASON.favorableQuality;
  const horizonDays = Number.isFinite(opts.horizonDays) ? opts.horizonDays : SEASON.horizonDays;
  const nights = (windows || []).filter(window => window && Number.isFinite(window.start) &&
    Number.isFinite(window.end) && window.end > window.start).slice(0, horizonDays);
  const nightOptions = { ...opts, thresholdDeg };
  const statsBefore = { ...cacheStats };
  let opening = null, favorable = null, scanned = 0, withWindow = 0, maxCoreAll = -90, anyDarkness = false;
  for (const window of nights) {
    scanned++;
    const night = analyseNight(window, site, nightOptions);
    if (night.observable) {
      withWindow++;
      if (!opening) opening = seasonNightRecord(night, favorableQuality, site.tz);
      if (!favorable && night.quality.value >= favorableQuality) {
        favorable = seasonNightRecord(night, favorableQuality, site.tz);
      }
      // Both found: nothing later in the year can be earlier, so the scan stops there.
      if (opening && favorable) break;
    } else {
      if (Number.isFinite(night.core.maxAltitude) && night.core.maxAltitude > maxCoreAll) {
        maxCoreAll = night.core.maxAltitude;
      }
      if (night.darkness && night.darkness.achieved && night.darkness.achieved !== 'none') anyDarkness = true;
    }
  }
  const base = { schema: SCHEMA, kind: 'season',
    site: { lat: site.lat, lon: site.lon, tz: site.tz || null, name: site.name || null },
    thresholdDeg, favorableQuality, horizonDays,
    search: { nights: nights.length, scanned, withWindow, stoppedEarly: scanned < nights.length,
      cacheHits: cacheStats.hits - statsBefore.hits, cacheMisses: cacheStats.misses - statsBefore.misses,
      ms: Date.now() - started },
    // Months ahead there is no forecast, and the result says so rather than implying calm skies.
    weather: { state: 'not-forecastable',
      detail: 'No forecast exists at this range. This is planned sky geometry — darkness, the core and the ' +
        'Moon — not a prediction of cloud, haze or light pollution.' },
    band: opening && opening.band ? opening.band
      : bandSummary(new Date(nights[0] ? nights[0].start : Date.now()), site, opts),
    provenance: { library: A.LIBRARY.name + ' ' + A.LIBRARY.version, core: CORE.source,
      galacticFrame: GALACTIC.source, method: 'the same nightly analysis the plans use, walked in date order' } };
  return classifySeason(base, { nights, opening, favorable, scanned, withWindow, maxCoreAll, anyDarkness,
    thresholdDeg, favorableQuality });
}


// A seasonal night as a candidate for the shared opportunity model, so a future window can be registered
// with the same identity rules, calendar serializer and observing plan as any other opportunity. The number
// is the category's own window quality, exactly as on a card tonight.
function seasonCandidate(record, site) {
  if (!record) return null;
  const positions = [];
  const push = (name, t, altitude, azimuth, compass) => {
    if (!Number.isFinite(t) || !Number.isFinite(altitude)) return;
    positions.push({ name, altitude: round(altitude, 1), azimuth: round(azimuth, 1), compass: compass || null,
      optical: 'camera', at: t });
  };
  push('The core as the window opens', record.start, record.openAltitude, record.openAzimuth, record.openCompass);
  push('The core at its highest', record.bestTime, record.bestAltitude, record.coreAzimuth, record.bestCompass);
  push('The core as the window closes', record.end, record.closeAltitude, record.closeAzimuth, record.closeCompass);
  return {
    kind: 'milky-way', category: 'milkyway', objects: ['Milky Way core'], night: record.date || record.day,
    title: 'Milky Way core window — ' + (record.date || record.day),
    summary: 'the core is up to ' + Math.round(record.bestAltitude) + ' degrees towards ' + record.bestCompass +
      '; ' + record.minutes + ' minutes during ' + darknessPhrase(record.level) + ' with the core above ' +
      record.thresholdDeg + ' degrees' +
      (record.moon && record.moon.classification === 'moon-below-horizon' ? '; no moonlight inside the window'
        : record.moon ? '; Moon: ' + String(record.moon.classification).replace(/-/g, ' ') : '') +
      '. Planned from the season search one year ahead: no forecast exists at this range.',
    why: [record.favorable
      ? 'this window clears the favourable bar of this category\'s own quality scale'
      : 'this is the first qualifying window of the season, and it is a marginal one: ' +
        (record.limitations.join('; ') || 'short or low in the sky')],
    caveats: [...record.limitations,
      'Weather months ahead is not forecastable: this is planned geometry, not a promise of clear skies.',
      'The number is this category\'s own window quality and is not comparable with satellite, meteor or ' +
        'planetary observing values.'],
    t: { start: record.start, end: record.end, best: record.bestTime },
    positions, optical: 'camera', observable: true,
    site: { lat: site.lat, lon: site.lon, tz: site.tz || null, name: site.name || null },
    data: { windowQuality: record.quality, qualityBasis: 'Milky Way window quality (geometry, darkness, moonlight)',
      qualityFactors: record.factors, positionGrade: 'reference-j2000',
      comparability: 'Milky Way window quality — this category\'s own measure, not comparable with satellite, ' +
        'meteor or planetary scores.',
      windowMinutes: record.minutes, windowBasis: 'the core at or above ' + record.thresholdDeg +
        ' degrees during ' + darknessPhrase(record.level),
      thresholdDeg: record.thresholdDeg, coreMaxAltitude: record.coreAltitude, coreMaxTime: record.coreTime,
      coreMaxAzimuth: record.coreAzimuth, coreMaxCompass: record.coreCompass,
      darknessAchieved: record.darknessAchieved, darknessMinutes: record.darknessMinutes,
      moon: record.moon, band: record.band, season: true, favorable: record.favorable,
      seasonDate: record.date || record.day, nightLabel: record.day,
      weatherState: 'not-forecastable' },
    provenance: { library: A.LIBRARY.name + ' ' + A.LIBRARY.version, reference: CORE.source, frame: CORE.frame,
      galacticFrame: GALACTIC.source, dataset: null,
      method: 'season search over the site\'s own observing nights' },
  };
}


function classifySeason(base, state) {
  const { nights, opening, favorable, maxCoreAll, anyDarkness, thresholdDeg, favorableQuality } = state;
  const round1 = value => round(value, 1);
  if (!nights.length) {
    return { ...base, opening: null, favorable: null, classification: 'unavailable',
      explanation: ['No observing nights were supplied, so no season could be searched.'] };
  }
  if (!opening) {
    // Nothing qualified in the whole year. Classify why, in the order the geometry forces: altitude first,
    // then darkness, then the overlap between them.
    if (maxCoreAll < thresholdDeg) {
      const neverRises = maxCoreAll < RULES.core.usableDeg;
      return { ...base, opening: null, favorable: null,
        classification: neverRises ? 'never-reaches-threshold' : 'below-threshold',
        maxCoreAltitude: round1(maxCoreAll),
        explanation: [neverRises
          ? 'The galactic core never rises above ' + RULES.core.usableDeg + ' degrees from this latitude, so no ' +
            'season exists here: the core stays below the useful horizon all year.'
          : 'The galactic core peaks at ' + round1(maxCoreAll) + ' degrees from this latitude, under the ' +
            thresholdDeg + ' degree threshold the window rule asks for, so no night can qualify.',
        'The rest of the galaxy is a different question: the galactic plane is a great circle, so part of the ' +
          'band is above the horizon here at every hour, and the core being out of reach does not make the ' +
          'band invisible.'] };
    }
    if (!anyDarkness) {
      return { ...base, opening: null, favorable: null, classification: 'no-darkness',
        maxCoreAltitude: round1(maxCoreAll),
        explanation: ['The sky never reaches even civil darkness during the searched nights, so there is no dark ' +
          'window to place the core in.',
        'The core itself does reach ' + round1(maxCoreAll) + ' degrees here: it is the twilight, not the ' +
          'geometry, that rules the season out.'] };
    }
    return { ...base, opening: null, favorable: null, classification: 'no-darkness-overlap',
      maxCoreAltitude: round1(maxCoreAll),
      explanation: ['The core does climb above ' + thresholdDeg + ' degrees here, but only while the sky is still ' +
        'too bright: across the searched nights its altitude and the dark hours never overlap.',
      'That is a statement about the core and the twilight at this latitude, not about the whole band.'] };
  }
  const explanation = [];
  explanation.push(opening.favorable
    ? 'The season opens on ' + opening.date + ' with a window that already clears the favourable bar: ' +
      opening.minutes + ' minutes, the core reaching ' + Math.round(opening.coreAltitude) + ' degrees towards ' +
      opening.coreCompass + '.'
    : 'The season opens on ' + opening.date + ' with a qualifying but marginal window: ' + opening.minutes +
      ' minutes, the core reaching ' + Math.round(opening.coreAltitude) + ' degrees towards ' +
      opening.coreCompass + '.');
  if (opening && opening.limitations && opening.limitations.length) {
    explanation.push('Its limitations: ' + opening.limitations.join('; ') + '.');
  }
  if (favorable && opening && favorable.day !== opening.day) {
    explanation.push('The first genuinely favourable night is ' + favorable.date + ': ' + favorable.minutes +
      ' minutes, the core at ' + Math.round(favorable.coreAltitude) + ' degrees towards ' +
      favorable.coreCompass + ', quality ' + favorable.quality + '/100 on this category\'s own scale.');
  } else if (!favorable) {
    explanation.push('No night in the searched period reaches the favourable bar of ' + favorableQuality +
      '/100, so this season offers marginal windows only — worth knowing, and worth checking the Moon and ' +
      'the weather on the night.');
  }
  return { ...base, opening, favorable, classification: favorable ? 'season-favorable' : 'season-marginal',
    explanation };
}

})(typeof self !== 'undefined' ? self : globalThis);
