/* Milky Way core engine validation.
   Run: node tests/overhead-milkyway.cjs

   The coordinate path is checked against an **independent implementation written in this file**: Meeus's
   IAU-1976 precession (chapter 21), the GMST series (chapter 12) and explicit spherical trigonometry for
   altitude and azimuth (chapter 13). That reference shares no code with the engine, with overhead-astro.js
   or with Astronomy Engine, and it deliberately uses a different algorithm from the library's rotation
   matrices, so agreement is evidence rather than a tautology. The remaining checks are invariants that no
   implementation can talk its way out of: transit altitude against 90 - |latitude - declination|, half of a
   great circle above the horizon, window edges inside both the darkness and the altitude intervals, and
   monotonicity of the documented quality formula. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
globalThis.Astronomy = require(path.resolve('vendor/overhead/astronomy-2.1.19.min.js'));
const A = require(path.resolve('overhead-astro.js'));
const MW = require(path.resolve('overhead-milkyway.js'));
const O = require(path.resolve('overhead-opportunities.js'));
const D = require(path.resolve('overhead-discovery.js'));
// The other category engines and the plan: the plan refuses to run unless every engine is present, so the
// integration checks load the same set the worker does.
require(path.resolve('overhead-planets.js'));
require(path.resolve('overhead-meteors.js'));
require(path.resolve('overhead-comets.js'));

const D2R = Math.PI / 180, R2D = 180 / Math.PI, DAY = 86400000, MINUTE = 60000, HOUR = 3600000;
const wrap360 = value => ((value % 360) + 360) % 360;
const angle = (a, b) => { const d = Math.abs(wrap360(a) - wrap360(b)) % 360; return Math.min(d, 360 - d); };
const SITES = Object.freeze({
  'Princeton, Indiana (38.4 N)': { lat: 38.3553, lon: -87.5675, tz: 'America/Chicago' },
  'Cape Town (-33.9)': { lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg' },
  'Quito (-0.2)': { lat: -0.1807, lon: -78.4678, tz: 'America/Guayaquil' },
  'Longyearbyen (78.2)': { lat: 78.22, lon: 15.65, tz: 'Arctic/Longyearbyen' },
  'Frankfurt (50.1)': { lat: 50.11, lon: 8.68, tz: 'Europe/Berlin' },
  'South Pole station (-89.9)': { lat: -89.9, lon: 0, tz: 'UTC' },
});
// Tolerances, each with its reason rather than a round number.
const TOL = Object.freeze({
  independentAlt: 0.05,   // deg: the library adds nutation (~0.005 deg) and its own sidereal model; measured worst case is printed
  independentAz: 0.06,    // deg: azimuth error grows near the zenith and near the horizon, where a small angle error is a large bearing change
  transitAltitude: 0.20,  // deg: the transit is found by sampling, and the precessed declination moves slightly in 26 years
  planeAboveHorizon: 1,   // samples of 24: a great circle puts half of the plane up, and the sampling grid is 15 deg wide
  edgeVsScan: 2,          // minutes: a coarse scan plus bisection must land on the same edge as a fine scan
});
const measured = {};
const worst = (key, value) => { measured[key] = Math.max(measured[key] === undefined ? 0 : measured[key], value); };

/* ---- the independent reference implementation --------------------------- */

// Julian day from a UTC instant (Meeus chapter 7, the standard 1970-epoch form).
const julianDay = ms => ms / DAY + 2440587.5;
// Greenwich mean sidereal time in degrees (Meeus chapter 12.4, the polynomial in T from J2000).
function gmstDegrees(ms) {
  const jd = julianDay(ms), T = (jd - 2451545.0) / 36525;
  return wrap360(280.46061837 + 360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T - (T * T * T) / 38710000);
}
// IAU-1976 precession from J2000 to the given instant (Meeus chapter 21.3-21.4), applied to a catalogue
// direction. A different algorithm from the library's rotation matrices, on purpose.
function precess(raDeg, decDeg, ms) {
  const t = (julianDay(ms) - 2451545.0) / 36525, T = 0;
  const zeta = ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t +
    (0.30188 - 0.000344 * T) * t * t + 0.017998 * t * t * t) / 3600;
  const z = ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t +
    (1.09468 + 0.000066 * T) * t * t + 0.018203 * t * t * t) / 3600;
  const theta = ((2004.3109 - 0.85330 * T - 0.000217 * T * T) * t -
    (0.42665 + 0.000217 * T) * t * t - 0.041833 * t * t * t) / 3600;
  const ra = raDeg * D2R, dec = decDeg * D2R;
  const zetaR = zeta * D2R, zR = z * D2R, thetaR = theta * D2R;
  const A1 = Math.cos(dec) * Math.sin(ra + zetaR);
  const B1 = Math.cos(thetaR) * Math.cos(dec) * Math.cos(ra + zetaR) - Math.sin(thetaR) * Math.sin(dec);
  const C1 = Math.sin(thetaR) * Math.cos(dec) * Math.cos(ra + zetaR) + Math.cos(thetaR) * Math.sin(dec);
  return { raDeg: wrap360(Math.atan2(A1, B1) * R2D + z), decDeg: Math.asin(Math.max(-1, Math.min(1, C1))) * R2D };
}
// Altitude and azimuth from hour angle and declination (Meeus chapter 13.5-13.6), azimuth measured from
// north through east, which is the convention the whole product uses.
function referenceHorizontal(raDeg, decDeg, ms, site) {
  const precessed = precess(raDeg, decDeg, ms);
  const localSidereal = wrap360(gmstDegrees(ms) + site.lon);
  const H = wrap360(localSidereal - precessed.raDeg) * D2R;
  const phi = site.lat * D2R, dec = precessed.decDeg * D2R;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) * R2D;
  const azimuth = wrap360(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * R2D + 180);
  return { altitude, azimuth, decDeg: precessed.decDeg, raDeg: precessed.raDeg };
}
const coreAirless = (ms, site) => MW.coreHorizontal(ms, site, { refraction: 'none' });

/* ---- 1. the reference frame reproduces its own published anchors -------- */
{
  const pole = MW.galacticToEquatorial(0, 90);
  assert.ok(angle(pole.raDeg, MW.GALACTIC.poleRaDeg) < 0.01 && Math.abs(pole.decDeg - MW.GALACTIC.poleDecDeg) < 0.01,
    'galactic latitude +90 must be the adopted galactic pole: got ' + pole.raDeg.toFixed(4) + ' ' + pole.decDeg.toFixed(4));
  const anticentre = MW.galacticToEquatorial(180, 0);
  // Opposite the galactic centre, not opposite the pole: the anticentre is the centre's antipode and it sits
  // at the same declination magnitude with the opposite sign of latitude offset.
  assert.ok(angle(anticentre.raDeg, MW.CORE.raDeg + 180) < 0.15 && anticentre.decDeg > 20,
    'the anticentre lies opposite the centre in the plane: got ' + anticentre.raDeg.toFixed(3) + ' ' + anticentre.decDeg.toFixed(3));
  // The frame's own origin must land on the radio position of Sgr A*: the frame constants are IAU-adopted
  // and the position is radio astrometry, so this is a real cross-check with a known 0.07 degree offset.
  const centre = MW.galacticToEquatorial(0, 0);
  const offset = Math.hypot(angle(centre.raDeg, MW.CORE.raDeg), centre.decDeg - MW.CORE.decDeg);
  worst('frameVersusSgrAStarDeg', offset);
  assert.ok(offset < 0.2, 'the galactic origin should sit on Sgr A* to within a tenth of a degree, got ' + offset.toFixed(3));
  const antipode = MW.galacticToEquatorial(210, 0), plane = MW.galacticToEquatorial(30, 0);
  const separation = A.separation(plane.raDeg, plane.decDeg, antipode.raDeg, antipode.decDeg);
  assert.ok(Math.abs(separation - 180) < 0.05, 'l and l+180 at b=0 must be antipodal, got ' + separation.toFixed(3));
}

/* ---- 2. the core position against the independent reference ------------- */
{
  const times = ['2026-01-15T03:00:00Z', '2026-04-02T06:30:00Z', '2026-07-16T05:00:00Z', '2026-07-16T23:00:00Z',
    '2026-10-17T05:00:00Z', '2027-03-01T09:15:00Z'];
  const sites = Object.values(SITES);
  let checked = 0;
  for (const site of sites) for (const time of times) {
    const ms = Date.parse(time);
    const mine = coreAirless(ms, site), reference = referenceHorizontal(MW.CORE.raDeg, MW.CORE.decDeg, ms, site);
    const altitudeDelta = Math.abs(mine.altitude - reference.altitude);
    const azimuthDelta = angle(mine.azimuth, reference.azimuth);
    worst('independentAltDeg', altitudeDelta);
    // Near the zenith the azimuth is degenerate, so it is compared only where the altitude leaves it defined.
    if (Math.abs(reference.altitude) < 85) worst('independentAzDeg', azimuthDelta);
    assert.ok(altitudeDelta < TOL.independentAlt,
      site.lat + '@' + time + ' altitude ' + mine.altitude.toFixed(4) + ' vs reference ' + reference.altitude.toFixed(4));
    if (Math.abs(reference.altitude) < 85) {
      assert.ok(azimuthDelta < TOL.independentAz,
        site.lat + '@' + time + ' azimuth ' + mine.azimuth.toFixed(4) + ' vs reference ' + reference.azimuth.toFixed(4));
    }
    checked++;
  }
  assert.equal(checked, sites.length * times.length);
  // Refraction is reported, not hidden: above the horizon the refracted altitude sits above the airless one.
  const refracted = MW.coreHorizontal(Date.parse('2026-07-16T05:00:00Z'), SITES['Princeton, Indiana (38.4 N)']);
  assert.ok(refracted.refractionApplied && refracted.refractionDeg > 0 &&
    refracted.altitude > refracted.airlessAltitude, 'refraction must raise the core above the airless altitude');
  worst('refractionDeg', refracted.refractionDeg);
}


/* ---- helpers for the night cases --------------------------------------- */

const nightsFor = (site, firstNoonIso, count) => {
  const out = [];
  for (let index = 0; index < count; index++) {
    const noon = Date.parse(firstNoonIso) + index * DAY;
    const { sunset, sunrise } = A.sunsetSunrise(site, noon);
    // Inside the polar circles the Sun may not cross the horizon at all, so the window falls back to a
    // fixed evening-to-morning span, exactly as the product's own night builder does.
    const start = Number.isFinite(sunset) ? sunset : noon + 5 * HOUR;
    const end = Number.isFinite(sunrise) ? sunrise : start + 16 * HOUR;
    out.push({ day: new Date(noon).toISOString().slice(0, 10), start, end });
  }
  return out;
};
const princeton = SITES['Princeton, Indiana (38.4 N)'], capeTown = SITES['Cape Town (-33.9)'];
const longyearbyen = SITES['Longyearbyen (78.2)'], quito = SITES['Quito (-0.2)'];
const frankfurt = SITES['Frankfurt (50.1)'];
const southPole = SITES['South Pole station (-89.9)'];

/* ---- 3. transit, altitude thresholds and the window invariants ---------- */
{
  // Mid-July at 38.4 N: the core transits near local midnight, which is the classic northern window.
  const july = MW.analyse(nightsFor(princeton, '2026-07-15T17:00:00Z', 1), princeton, {}).nights[0];
  assert.equal(july.observable, true, 'the July night at 38.4 N must produce a window: ' + JSON.stringify(july.refusals));
  const transitAltitude = 90 - Math.abs(princeton.lat - MW.CORE.decDeg);
  worst('transitAltitudeErrorDeg', Math.abs(july.core.maxAltitude - transitAltitude));
  assert.ok(Math.abs(july.core.maxAltitude - transitAltitude) < TOL.transitAltitude,
    'the highest core altitude should match 90 - |lat - dec|: ' + july.core.maxAltitude.toFixed(3) + ' vs ' + transitAltitude.toFixed(3));
  assert.ok(angle(july.core.maxAzimuth, 180) < 1.5, 'a transit south of the zenith must be due south, got ' + july.core.maxAzimuth);
  assert.equal(july.core.accessible, true);
  assert.ok(july.core.maxAltitude >= july.bestAltitude - 0.01, 'the best moment cannot be higher than the night maximum');
  assert.ok(july.window.start < july.window.end, 'a window has a direction in time');
  assert.ok(july.window.minutes >= MW.RULES.core.minWindowMinutes, 'a window must clear the minimum length');
  // Every sample inside the window must satisfy both constraints, and the window must sit inside the
  // darkness intervals: the intersection claim is checked, not assumed.
  const darknessLevel = MW.RULES.darkness.levels[july.window.level];
  const insideDarkness = july.darkness.intervals[july.window.level]
    .some(([a, b]) => july.window.start >= a - 1000 && july.window.end <= b + 1000);
  assert.ok(insideDarkness, 'the window must lie inside the achieved darkness');
  for (let t = july.window.start; t <= july.window.end; t += 5 * MINUTE) {
    const core = coreAirless(t, princeton);
    assert.ok(core.altitude >= july.thresholdDeg - 0.05,
      'the core stays above the threshold through the window: ' + core.altitude.toFixed(2) + ' at ' + new Date(t).toISOString());
    assert.ok(A.sunAltitude(t, princeton) <= darknessLevel + 0.02,
      'the Sun stays below the achieved level through the window');
  }
  // At least one edge is a bisected instant rather than a round scan step, which is what makes the
  // boundary honest to the second.
  assert.ok(july.window.start % MINUTE !== 0 || july.window.end % MINUTE !== 0,
    'at least one window edge must be a bisected instant, not a round sample');
  // Midnight crossing: this window opens before local midnight and closes after it.
  const localDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: princeton.tz, year: 'numeric',
    month: '2-digit', day: '2-digit' }).format(new Date(ms));
  assert.notEqual(localDay(july.window.start), localDay(july.window.end), 'the July window crosses local midnight');
  assert.ok(july.band.above.horizon >= 10 && july.band.above.horizon <= 14,
    'about half of the galactic plane is above the horizon, got ' + july.band.above.horizon + ' of ' + july.band.sampled);
  worst('planeAboveHorizonSamples', Math.abs(july.band.above.horizon - 12));
}
{
  // A season later at the same latitude: the core is low in the south-west at dusk and the darkest hours
  // have no core at all, while much of the plane is still up. That is the honest mid-October answer.
  const october = MW.analyse(nightsFor(princeton, '2026-10-17T17:00:00Z', 1), princeton, {}).nights[0];
  assert.equal(october.core.accessible, true, 'the core still rises above 10 degrees in mid-October here');
  assert.equal(october.observable, false, 'but it does not clear the 20 degree threshold in the dark hours');
  assert.ok(october.refusals.length && /twilight|darkness/.test(october.refusals[0]), 'the refusal must explain why');
  assert.ok(october.band.above.usableDeg > 0, 'part of the plane is still above the horizon when the core is not');
  assert.match(october.band.statement, /half of a great circle/);
  // Half the plane being up is the same geometric fact at every latitude and in both hemispheres.
  for (const site of Object.values(SITES)) {
    if (Math.abs(site.lat) > 89.5) continue;
    const night = MW.analyse(nightsFor(site, '2026-07-15T12:00:00Z', 1), site, { stepMinutes: 20 }).nights[0];
    assert.ok(Math.abs(night.band.above.horizon - 12) <= TOL.planeAboveHorizon,
      'half of the plane is up at ' + site.lat + ': got ' + night.band.above.horizon + ' of ' + night.band.sampled);
  }
}

/* ---- 4. hemispheres, the tropics and the poles -------------------------- */
{
  // Cape Town: the core passes close to the zenith, so the window is long and the peak is very high.
  const cape = MW.analyse(nightsFor(capeTown, '2026-07-15T10:00:00Z', 1), capeTown, {}).nights[0];
  assert.equal(cape.observable, true, 'the southern winter is the best core season: ' + JSON.stringify(cape.refusals));
  const capeTransit = 90 - Math.abs(capeTown.lat - MW.CORE.decDeg);
  worst('southernTransitErrorDeg', Math.abs(cape.core.maxAltitude - capeTransit));
  assert.ok(Math.abs(cape.core.maxAltitude - capeTransit) < TOL.transitAltitude, 'the transit invariant holds in the south');
  assert.ok(cape.core.maxAltitude > 80, 'from Cape Town the core is nearly overhead, got ' + cape.core.maxAltitude.toFixed(1));
  assert.ok(cape.window.minutes > 200, 'a nearly overhead core gives a long window, got ' + cape.window.minutes + ' min');
  // The tropics: the core is high and astronomical darkness is available all year.
  const tropical = MW.analyse(nightsFor(quito, '2026-07-15T17:00:00Z', 1), quito, {}).nights[0];
  assert.equal(tropical.observable, true);
  const quitoTransit = 90 - Math.abs(quito.lat - MW.CORE.decDeg);
  worst('equatorialTransitErrorDeg', Math.abs(tropical.core.maxAltitude - quitoTransit));
  assert.ok(Math.abs(tropical.core.maxAltitude - quitoTransit) < TOL.transitAltitude);
  assert.equal(tropical.darkness.achieved, 'astronomical', 'the equator reaches astronomical darkness in July');
  // Longyearbyen in December: the core never rises, so there is nothing to plan around.
  const polarWinter = MW.analyse(nightsFor(longyearbyen, '2026-12-15T12:00:00Z', 1), longyearbyen, {}).nights[0];
  assert.equal(polarWinter.core.accessible, false, 'the core never rises from 78 N in December');
  assert.equal(polarWinter.observable, false);
  assert.match(polarWinter.refusals[0], /never rises above 10 degrees/);
  assert.equal(polarWinter.window, null, 'no window may be invented when the core never rises');
  // Longyearbyen in June: the polar day, so the core never rises either, and the refusal says which one.
  const polarSummer = MW.analyse(nightsFor(longyearbyen, '2026-06-15T12:00:00Z', 1), longyearbyen, {}).nights[0];
  assert.equal(polarSummer.observable, false, 'midnight sun: no window can exist');
  assert.match(polarSummer.refusals[0], /never rises/, 'the polar-day refusal must be the geometry, not an excuse');
  // The white nights of a mid-northern summer are the real 'no astronomical darkness' case: the core is
  // up, the sky is never astronomically dark, and the engine must say so rather than claim a dark window.
  const whiteNights = MW.analyse(nightsFor(frankfurt, '2026-06-15T10:00:00Z', 1), frankfurt, {}).nights[0];
  assert.equal(whiteNights.core.accessible, true, 'the core is above 10 degrees from 50 N in June');
  assert.equal(whiteNights.darkness.achieved === 'astronomical', false,
    'a mid-northern June night does not reach astronomical darkness');
  assert.ok(whiteNights.darkness.limited, 'and the darkness must be reported as limited');
  worst('whiteNightDarknessMinutes', whiteNights.darkness.minutes.astronomical);
  assert.equal(whiteNights.darkness.minutes.astronomical, 0, 'there is no astronomical darkness on that date');
  if (whiteNights.observable) {
    assert.ok(['nautical', 'civil'].includes(whiteNights.window.level),
      'any window that far north in June must be a twilight window, not a dark one: ' + whiteNights.window.level);
    assert.match(whiteNights.caveats.join(' '), /not comparable|light-pollution|sky-brightness/);
  } else {
    assert.ok(/darkness|twilight/.test(whiteNights.refusals[0]),
      'the refusal must name the missing darkness: ' + whiteNights.refusals[0]);
  }
  // Near the south pole the core is circumpolar: up all night and barely changing altitude.
  const pole = MW.analyse(nightsFor(southPole, '2026-07-15T00:00:00Z', 1), southPole, { stepMinutes: 20 }).nights[0];
  assert.equal(pole.core.accessible, true, 'the core is always up near the south pole');
  const poleTrack = MW.coreTrack(southPole, pole.start, pole.end, 60);
  const spread = poleTrack.maxAltitude - Math.min(...poleTrack.samples.map(sample => sample.altitude));
  assert.ok(spread < 12, 'a circumpolar core barely changes altitude over a day, got ' + spread.toFixed(1));
  worst('polarAltitudeSpreadDeg', spread);
}


/* ---- 5. moonlight policy: where the Moon is, not what phase it shows ---- */
{
  // Synthetic series, so the classification rules are pinned rather than one date's weather.
  const series = samples => samples.map((sample, index) => ({ t: index * 15 * MINUTE, altitude: 30,
    moon: { altitude: sample[0], illumination: sample[1], separationDeg: sample[2] } }));
  const window = { start: 0, end: 8 * 15 * MINUTE };
  const below = MW.moonInterferenceFor(series([[-10, 0.99, 40], [-20, 0.99, 40], [-5, 0.99, 40]]), window);
  assert.equal(below.classification, 'moon-below-horizon', 'a bright Moon below the horizon costs nothing');
  assert.equal(MW.moonFactorFor(below.metrics), 1, 'and its factor is exactly 1');
  const faint = MW.moonInterferenceFor(series([[40, 0.1, 20], [45, 0.12, 18], [50, 0.1, 22]]), window);
  assert.equal(faint.classification, 'moon-low-illumination', 'a thin crescent high in the sky is not interference');
  const bright = MW.moonInterferenceFor(series([[40, 0.98, 25], [45, 0.98, 22], [50, 0.98, 30]]), window);
  assert.equal(bright.classification, 'significant-moonlight');
  const moderate = MW.moonInterferenceFor(series([[40, 0.35, 100], [45, 0.30, 105], [50, 0.32, 98]]), window);
  assert.equal(moderate.classification, 'some-moonlight');
  // Phase is not the answer: the same 98 percent lit Moon is interference or not depending on where it is.
  assert.ok(MW.moonFactorFor(bright.metrics) < MW.moonFactorFor(below.metrics),
    'an illuminated Moon above the horizon must reduce the factor');
  assert.ok(MW.moonFactorFor(faint.metrics) > MW.moonFactorFor(bright.metrics),
    'the same geometry with less illumination must interfere less');
  const near = MW.moonInterferenceFor(series([[40, 0.9, 15], [45, 0.9, 15]]), window);
  const far = MW.moonInterferenceFor(series([[40, 0.9, 130], [45, 0.9, 130]]), window);
  assert.ok(MW.moonFactorFor(far.metrics) > MW.moonFactorFor(near.metrics),
    'distance from the core must reduce the penalty');
  assert.equal(near.classification, 'significant-moonlight');
  assert.equal(MW.moonInterferenceFor([{ t: 0, altitude: 30, moon: { altitude: null } }], window).classification,
    'moon-uncertain');
  assert.equal(MW.moonInterferenceFor([], window).classification, 'moon-uncertain');
}
{
  // Real dates: the new Moon of 2026-07-14 leaves the July window moonless, while the full Moon a fortnight
  // later is up inside it. Everything else about those two nights is nearly identical, so the difference in
  // the window quality is moonlight and nothing else.
  const newMoon = MW.analyse(nightsFor(princeton, '2026-07-14T17:00:00Z', 1), princeton, {}).nights[0];
  const fullMoon = MW.analyse(nightsFor(princeton, '2026-07-28T17:00:00Z', 1), princeton, {}).nights[0];
  assert.equal(newMoon.moon.classification, 'moon-below-horizon',
    'the new Moon is down during the July window: ' + JSON.stringify(newMoon.moon.metrics));
  assert.ok(['significant-moonlight', 'some-moonlight'].includes(fullMoon.moon.classification),
    'the full Moon is up during the window: ' + JSON.stringify(fullMoon.moon));
  assert.ok(fullMoon.quality.factors.moon < newMoon.quality.factors.moon, 'moonlight must lower the moon factor');
  assert.ok(newMoon.quality.value > fullMoon.quality.value,
    'the moonless night must score higher: ' + newMoon.quality.value + ' vs ' + fullMoon.quality.value);
  worst('fullMoonQualityDrop', newMoon.quality.value - fullMoon.quality.value);
  // The quality is not a phase function: two cases with identical illumination but different separation must
  // differ, in the direction the rules state.
  const near = MW.qualityFor({ maxCoreAltitudeDeg: 25, darknessMinutes: 180, darknessLevel: 'astronomical',
    moon: { litUpFraction: 1, illuminationAtBest: 0.8, minSeparationDeg: 45 } });
  const distant = MW.qualityFor({ maxCoreAltitudeDeg: 25, darknessMinutes: 180, darknessLevel: 'astronomical',
    moon: { litUpFraction: 1, illuminationAtBest: 0.8, minSeparationDeg: 140 } });
  assert.ok(distant.value > near.value,
    'with the same illumination, a Moon 140 degrees away must cost less than one 45 degrees away');
}




/* ---- 6. the documented quality formula: monotone, bounded, weather-free - */
{
  const base = { maxCoreAltitudeDeg: 25, darknessMinutes: 180, darknessLevel: 'astronomical',
    moon: { litUpFraction: 0.5, illuminationAtBest: 0.7, minSeparationDeg: 90 } };
  const value = components => MW.qualityFor(components).value;
  let previous = -1;
  for (const altitude of [5, 10, 15, 20, 25, 30, 40, 70]) {
    const current = value({ ...base, maxCoreAltitudeDeg: altitude });
    assert.ok(current >= previous, 'quality must not fall as the core rises: ' + altitude + ' gave ' + current);
    previous = current;
  }
  previous = -1;
  for (const minutes of [0, 30, 60, 120, 180, 240, 400]) {
    const current = value({ ...base, darknessMinutes: minutes });
    assert.ok(current >= previous, 'quality must not fall with more darkness: ' + minutes + ' gave ' + current);
    previous = current;
  }
  previous = 101;
  for (const lit of [0, 0.25, 0.5, 0.75, 1]) {
    const current = value({ ...base, moon: { ...base.moon, litUpFraction: lit } });
    assert.ok(current <= previous, 'quality must not rise with more moonlight: ' + lit + ' gave ' + current);
    previous = current;
  }
  previous = 101;
  for (const illumination of [0.25, 0.4, 0.6, 0.8, 1]) {
    const current = value({ ...base, moon: { ...base.moon, illuminationAtBest: illumination } });
    assert.ok(current <= previous, 'quality must not rise with a brighter Moon: ' + illumination + ' gave ' + current);
    previous = current;
  }
  previous = -1;
  for (const separation of [10, 60, 90, 120, 180]) {
    const current = value({ ...base, moon: { ...base.moon, minSeparationDeg: separation } });
    assert.ok(current >= previous, 'quality must not fall as the Moon moves away: ' + separation + ' gave ' + current);
    previous = current;
  }
  // Twilight level: the levels are ordered, and no darkness means no darkness credit however long it lasts.
  assert.ok(value({ ...base, darknessLevel: 'astronomical' }) > value({ ...base, darknessLevel: 'nautical' }));
  assert.ok(value({ ...base, darknessLevel: 'nautical' }) > value({ ...base, darknessLevel: 'civil' }));
  assert.equal(value({ ...base, darknessMinutes: 0, darknessLevel: 'none' }),
    value({ ...base, darknessMinutes: 400, darknessLevel: 'none' }));
  // Bounds hold at the extremes, and nonsense input cannot push the number out of range.
  for (const altitude of [-90, 0, 90, 1000]) for (const minutes of [-10, 0, 10000]) {
    const current = value({ maxCoreAltitudeDeg: altitude, darknessMinutes: minutes, darknessLevel: 'astronomical', moon: {} });
    assert.ok(current >= 0 && current <= 100, 'quality must stay in 0..100: ' + current);
  }
  assert.equal(value({}), 25, 'an empty input is a minimum-quality window, not a crash');
  // The formula is documented in the returned record, and weather is not part of it.
  const documented = MW.qualityFor(base);
  assert.match(documented.formula, /0\.45 \* core \+ 0\.30 \* darkness \+ 0\.25 \* moon/);
  assert.deepEqual(documented.weights, { core: 0.45, darkness: 0.30, moon: 0.25 });
  assert.match(documented.basis, /forecast is reported separately/);
  assert.match(documented.comparability, /not comparable with satellite, meteor or planetary/);
  assert.equal(value({ ...base, weather: { cloudCover: 100 } }), value({ ...base, weather: { cloudCover: 0 } }),
    'weather must not enter the window quality');
  assert.ok(documented.limitations.some(text => /light pollution/.test(text)),
    'the limitations must name light pollution as unmodelled');

/* ---- 7. horizons: seven days, ninety days, and cheap reuse -------------- */
{
  const week = nightsFor(princeton, '2026-07-15T17:00:00Z', 7);
  const weekRun = MW.analyse(week, princeton, {});
  assert.equal(weekRun.nights.length, 7);
  assert.equal(weekRun.candidates.length, 7, 'one candidate per night, so each night is its own decision');
  for (const candidate of weekRun.candidates) {
    assert.equal(candidate.kind, 'milky-way');
    assert.equal(candidate.category, 'milkyway');
    assert.ok(Number.isFinite(candidate.data.windowQuality));
    assert.ok(candidate.t.end >= candidate.t.start, 'a window never runs backwards');
    if (candidate.observable) assert.ok(candidate.data.windowMinutes > 0);
  }
  // Ninety days at the coarse sampling: bounded cost, and the answer must agree with the fine sampling.
  MW.clearCache();
  const ninety = nightsFor(princeton, '2026-06-01T17:00:00Z', 90);
  const coarseStart = Date.now();
  const coarse = MW.analyse(ninety, princeton, { stepMinutes: 20, solarStepMinutes: 15, moonStepMinutes: 20, chartStepMinutes: 60 });
  const coarseMs = Date.now() - coarseStart;
  assert.equal(coarse.nights.length, 90);
  assert.equal(coarse.candidates.length, 90);
  worst('ninetyDayMs', coarseMs);
  assert.ok(coarseMs < 20000, 'a 90-day request must stay bounded, took ' + coarseMs + ' ms');
  assert.ok(MW.cacheSize() >= 90, 'the nights must be cached for reuse: ' + MW.cacheSize());
  // The same night analysed at fine sampling must produce the same window edges to within a couple of
  // minutes: the bisection is what makes the coarse scan safe, and this is the evidence for it.
  let compared = 0, worstEdge = 0;
  for (let index = 0; index < 90; index += 7) {
    const night = ninety[index];
    const coarseNight = coarse.nights[index];
    if (!coarseNight.observable) continue;
    const fine = MW.analyseNight(night, princeton, {});
    if (!fine.observable) continue;
    const startDelta = Math.abs(fine.window.start - coarseNight.window.start) / MINUTE;
    const endDelta = Math.abs(fine.window.end - coarseNight.window.end) / MINUTE;
    worstEdge = Math.max(worstEdge, startDelta, endDelta);
    assert.ok(startDelta < TOL.edgeVsScan && endDelta < TOL.edgeVsScan,
      'coarse sampling changed a window edge by ' + Math.max(startDelta, endDelta).toFixed(2) + ' minutes');
    compared++;
  }
  assert.ok(compared >= 5, 'the sampling comparison needs several comparable nights, got ' + compared);
  worst('coarseEdgeDeltaMinutes', worstEdge);
  // The cache returns the identical object for the same night and options, so switching horizons cannot
  // change an answer, and a different threshold is a different key rather than a stale hit.
  const again = MW.analyseNight(ninety[0], princeton, { stepMinutes: 20, solarStepMinutes: 15, moonStepMinutes: 20, chartStepMinutes: 60 });
  assert.equal(again, coarse.nights[0], 'the cached night must be reused unchanged');
  const otherThreshold = MW.analyseNight(ninety[0], princeton, { stepMinutes: 20, solarStepMinutes: 15,
    moonStepMinutes: 20, chartStepMinutes: 60, thresholdDeg: 25 });
  assert.notEqual(otherThreshold, coarse.nights[0], 'a different threshold is a different analysis');
  assert.ok(MW.cacheSize() <= MW.CACHE.limit, 'the cache must stay bounded');
  MW.clearCache();
  assert.equal(MW.cacheSize(), 0);
}

/* ---- 8. daylight-saving transitions do not break the windows ------------ */
{
  // The US spring-forward night of 2026-03-08: the local clock loses an hour inside the observing night.
  const [dstNight] = nightsFor(princeton, '2026-03-08T17:00:00Z', 1);
  const dst = MW.analyseNight(dstNight, princeton, {});
  assert.ok(dst.end > dst.start, 'the night must still run forwards across the transition');
  assert.equal(Math.round((dst.end - dst.start) / MINUTE), Math.round((dstNight.end - dstNight.start) / MINUTE));
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: princeton.tz, hour: 'numeric', minute: '2-digit', hour12: false });
  const localStart = formatter.format(new Date(dstNight.start)), localEnd = formatter.format(new Date(dstNight.end));
  assert.match(localStart, /^\d{2}:\d{2}$/, 'the local start must format in the site timezone: ' + localStart);
  assert.match(localEnd, /^\d{2}:\d{2}$/, 'the local end must format in the site timezone: ' + localEnd);
  if (dst.observable) {
    // A window inside a night that is an hour short is still a real interval, and its length must equal the
    // elapsed milliseconds rather than a wall-clock subtraction.
    assert.equal(dst.window.minutes, Math.round((dst.window.end - dst.window.start) / MINUTE));
  }
  const [autumnNight] = nightsFor(princeton, '2026-11-01T17:00:00Z', 1);
  const autumn = MW.analyseNight(autumnNight, princeton, {});
  assert.ok(autumn.end > autumn.start && autumn.observable === (autumn.window !== null));
}


/* ---- 9. weather: missing is missing, never clear ------------------------- */
{
  const CP = require(path.resolve('overhead-celestial-plan.js'));
  const week = nightsFor(princeton, '2026-07-15T17:00:00Z', 4);
  const without = CP.compute({ site: princeton, windows: week, now: Date.parse('2026-07-15T18:00:00Z'),
    horizon: 'week', category: 'milkyway', datasets: {}, weather: null, options: { minAltitude: 10 } });
  assert.deepEqual(without.errors, [], 'the Milky Way category must compute without any dataset or forecast');
  const plan = without.plans.week;
  assert.ok(plan.opportunities.length >= 4, 'each night is its own card in the week plan');
  for (const opportunity of plan.opportunities) {
    assert.equal(opportunity.category, 'milkyway');
    assert.equal(opportunity.observing.weatherUsed, false, 'no forecast was supplied, so none may be used');
    assert.equal(opportunity.confidence.observing.grade, 'no-usable-forecast',
      'missing weather must be reported as missing, not as clear skies');
    assert.match(opportunity.observing.detail, /No forecast is applied at this range/);
    assert.equal(opportunity.observing.value, opportunity.attributes.windowQuality,
      'the displayed number must be the category-specific window quality');
  }
  const values = plan.opportunities.map(opportunity => opportunity.observing.value);
  for (let index = 1; index < values.length; index++) {
    assert.ok(values[index - 1] >= values[index], 'the week plan must be ordered by window quality');
  }
  // With a forecast inside its range the grade changes but the window quality does not: the two numbers
  // answer different questions, which is why weather stays out of the geometry.
  const hourly = { time: [], cloud_cover: [], visibility: [], precipitation: [], temperature_2m: [], weather_code: [] };
  for (let index = 0; index < 24 * 8; index++) {
    const seconds = Math.floor(Date.parse('2026-07-15T18:00:00Z') / 1000) + index * 3600;
    hourly.time.push(seconds); hourly.cloud_cover.push(10); hourly.visibility.push(24000);
    hourly.precipitation.push(0); hourly.temperature_2m.push(20); hourly.weather_code.push(0);
  }
  const withForecast = CP.compute({ site: princeton, windows: week, now: Date.parse('2026-07-15T18:00:00Z'),
    horizon: 'week', category: 'milkyway', datasets: {}, weather: { hourly }, options: { minAltitude: 10 } });
  const first = withForecast.plans.week.opportunities.find(opportunity => opportunity.observing.weatherUsed === true);
  assert.ok(first, 'a forecast inside its range must be used');
  assert.equal(first.confidence.observing.grade, 'forecast-included');
  assert.equal(first.observing.value,
    without.plans.week.opportunities.find(opportunity => opportunity.id === first.id).observing.value,
    'the window quality must not change when a forecast appears');
  assert.ok(first.attributes.photography, 'the photography notes must travel with the opportunity');
  // The same question across the whole ninety days: a four-night window list cannot reach beyond a
  // week-long forecast, so the horizon check needs its own ninety nights. A night past the forecast must
  // keep its geometry and report no forecast.
  const ninety = nightsFor(princeton, '2026-06-01T17:00:00Z', 90);
  const forecastDays = { hourly: { time: [], cloud_cover: [], visibility: [], precipitation: [],
    temperature_2m: [], weather_code: [] } };
  for (let index = 0; index < 24 * 4; index++) {
    const seconds = Math.floor(Date.parse('2026-06-01T17:00:00Z') / 1000) + index * 3600;
    forecastDays.hourly.time.push(seconds); forecastDays.hourly.cloud_cover.push(5);
    forecastDays.hourly.visibility.push(24000); forecastDays.hourly.precipitation.push(0);
    forecastDays.hourly.temperature_2m.push(18); forecastDays.hourly.weather_code.push(0);
  }
  const longRange = CP.compute({ site: princeton, windows: ninety, now: Date.parse('2026-06-01T17:00:00Z'),
    horizon: 'extended', category: 'milkyway', datasets: {}, weather: forecastDays, options: { minAltitude: 10 } });
  const far = longRange.plans.extended.opportunities.find(opportunity => opportunity.best >
    Date.parse('2026-06-05T17:00:00Z') + 72 * HOUR);
  if (far) {
    assert.equal(far.observing.weatherUsed, false, 'a night past the forecast horizon must not use a forecast');
    assert.equal(far.confidence.observing.grade, 'astronomy-only');
    assert.match(far.observing.detail, /No forecast is applied at this range/);
  } else {
    assert.ok(longRange.plans.extended.opportunities.length > 0, 'the extended plan must still list nights');
  }
  measured.extendedNightCount = longRange.plans.extended.considered;
  assert.ok(measured.extendedNightCount > 30, 'the ninety-day plan must consider a long run of nights');
  assert.ok(longRange.plans.extended.consolidated, 'a long horizon consolidates consecutive nights into runs');
}

/* ---- 10. the shared model, discovery and the calendar ------------------- */
{
  const CP = require(path.resolve('overhead-celestial-plan.js'));
  const Cal = require(path.resolve('overhead-calendar.js'));
  const week = nightsFor(princeton, '2026-07-15T17:00:00Z', 3);
  const result = CP.compute({ site: princeton, windows: week, now: Date.parse('2026-07-15T18:00:00Z'),
    horizon: 'week', category: 'milkyway', datasets: {}, weather: null, options: { minAltitude: 10 } });
  const opportunity = result.plans.week.opportunities[0];
  // The unified model accepted it, with the reference-frame grade and the Milky Way phenomenon description.
  assert.equal(opportunity.confidence.astrometric.grade, 'reference-j2000');
  assert.match(opportunity.confidence.astrometric.detail, /fixed J2000 catalogue direction/);
  assert.match(opportunity.confidence.phenomenon.detail, /galactic centre/);
  assert.equal(opportunity.optical, 'camera');
  assert.match(String(opportunity.provenance.reference), /Sgr A\*|Reid/);
  assert.equal(opportunity.eligibility.observable, true);
  // Discovery: a window with its own category.
  const event = D.celestial(opportunity, { category: 'milkyway', errors: [] });
  assert.ok(event, 'the opportunity must convert into a discovery event');
  assert.equal(event.category, 'milkyway');
  assert.equal(event.precision, 'window');
  assert.equal(event.start, opportunity.start, 'the event window is the opportunity window');
  assert.equal(event.end, opportunity.end);
  assert.match(event.warnings.join(' '), /not comparable with satellite|light-pollution|sky-brightness/i);
  assert.equal(D.LABELS.milkyway, 'Milky Way');
  const now = Date.parse('2026-07-15T18:00:00Z');
  assert.equal(D.tonight([event], { now, start: week[0].start, end: week[0].end }).length, 1,
    'the Milky Way can lead tonight for its own category');
  assert.equal(D.comingUp([event], { now, end: week[2].end, limit: 6 }).length, 1);
  // Calendar: a window is an interval, and the exported event says what it is.
  const options = { now, site: princeton, timezone: princeton.tz, clock: '12', compass: A.compass,
    scoreLabel: () => 'Milky Way window quality', source: opportunity,
    // The page passes the same label map it uses on the cards, so the exported text matches the interface.
    opticalLabel: value => (value === 'camera' ? 'Camera on a tripod' : value) };
  const first = Cal.describe(event, options);
  assert.equal(first.eligible, true, first.reason);
  assert.equal(first.event.start, event.start);
  assert.equal(first.event.end, event.end, 'the calendar interval is the observing window, not a one-hour block');
  assert.ok(first.event.end - first.event.start > 60 * MINUTE, 'this window is longer than an hour and exports as such');
  assert.match(first.event.description, /Observing window:/);
  assert.match(first.event.description, /Milky Way window quality \d+\/100/);
  assert.match(first.event.description, /not comparable with satellite, meteor or planetary scores/);
  assert.match(first.event.description, /Facing: /, 'the description must say which way to look');
  assert.match(first.event.description, /Equipment: Camera on a tripod/);
  const second = Cal.describe(event, options);
  assert.equal(second.event.uid, first.event.uid, 'the calendar identity must be stable across calls');
  const exported = Cal.single({ event, source: opportunity }, options);
  assert.equal(exported.eligible, true, exported.reason);
  assert.match(String(exported.name), /\.ics$/);
  const text = String(exported.ics || '');
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.match(text, /BEGIN:VEVENT/);
  assert.match(text, new RegExp('DTSTART:' + Cal.formatUtc(first.event.start)));
  assert.match(text, new RegExp('DTEND:' + Cal.formatUtc(first.event.end)));
  assert.match(text, /CATEGORIES:.*Milky Way/);
  assert.match(text, /UID:wlu-milkyway/);
  // The same night requested twice must produce the same event id, so a calendar entry is updated rather
  // than duplicated when the plan is recalculated.
  const repeat = CP.compute({ site: princeton, windows: week, now: now + HOUR,
    horizon: 'week', category: 'milkyway', datasets: {}, weather: null, options: { minAltitude: 10 } });
  assert.equal(repeat.plans.week.opportunities[0].id, opportunity.id, 'the event identity is stable for a night');
  // Nothing may leak into the other categories.
  const planets = CP.compute({ site: princeton, windows: week, now, horizon: 'week', category: 'planets',
    datasets: {}, weather: null, options: { minAltitude: 10 } });
  for (const entry of planets.plans.week.opportunities) {
    assert.notEqual(entry.category, 'milkyway', 'the Milky Way must never appear inside another category');
  }
  assert.equal(planets.milkyWay, null, 'and its analysis must not be computed for another category');
}



/* ---- 11. nothing fabricated: no brightness, no light pollution, no promise */
{
  const CP = require(path.resolve('overhead-celestial-plan.js'));
  const source = fs.readFileSync(path.resolve('overhead-milkyway.js'), 'utf8');
  // The engine must not claim a sky-brightness, magnitude, light-pollution or visibility model it does not
  // have. Words like these cannot appear except in the limitations that deny them.
  const forbidden = [/sky brightness (?:is|was|of) [\d.]/i, /visual magnitude of the milky way/i,
    /bortle [1-9]/i, /guarantee(?:d)? (?:a|the) (?:view|photograph)/i, /likelihood of seeing/i,
    /probability/i];
  for (const pattern of forbidden) assert.doesNotMatch(source, pattern, 'the engine must not invent: ' + pattern);
  assert.match(source, /never a brightness ranking|not a brightness model|never a sky-brightness model/);
  // And nowhere in the data may a brightness or a light-pollution number appear.
  const week = nightsFor(princeton, '2026-07-15T17:00:00Z', 2);
  const result = CP.compute({ site: princeton, windows: week, now: Date.parse('2026-07-15T18:00:00Z'),
    horizon: 'week', category: 'milkyway', datasets: {}, weather: null, options: { minAltitude: 10 } });
  const serialized = JSON.stringify(result.plans.week.opportunities);
  for (const field of ['"brightness"', '"magnitude"', '"lightPollution"', '"bortle"', '"transparency"',
    '"probability"', '"plume"']) {
    assert.equal(serialized.includes(field), false, 'no opportunity may carry ' + field);
  }
  // The quality record itself states what it is not, and the card's own words say the same.
  assert.match(serialized, /not comparable with satellite, meteor or planetary/);
  assert.match(serialized, /no sky-brightness or light-pollution measurement/);
  assert.match(serialized, /Missing weather is not a clear-sky prediction|No forecast is applied at this range/);
  // The band is geometry only: it reports counts of sampled longitudes, never which part is brightest.
  assert.match(serialized, /sampled galactic longitudes/);
  assert.doesNotMatch(serialized, /brightest part of the (?:milky way|band)/i);
  // The engine is pure: no DOM, no storage, no network.
  assert.doesNotMatch(source, /\bdocument\.|localStorage|indexedDB|fetch\(|XMLHttpRequest/);
  assert.match(source, /requires overhead-astro\.js/);
  worst('engineBytes', source.length);
}

/* ---- summary ------------------------------------------------------------ */
const round3 = value => Math.round(value * 1000) / 1000;
console.log('PASS: Milky Way core engine — an independent Meeus/GMST reference for the coordinate path, the ' +
  'transit and great-circle invariants, window intersection inside darkness and altitude together, northern ' +
  'and southern and tropical and polar cases, white nights with no astronomical darkness, moonlight decided ' +
  'by where the Moon is rather than its phase, the documented monotone quality formula, seven- and ninety-day ' +
  'horizons with cached reuse, daylight-saving nights, missing weather reported as missing, discovery and ' +
  'calendar integration with a window rather than an hour, and no fabricated brightness or light-pollution claim.');
console.log('Measured: independentAltDeg ' + round3(measured.independentAltDeg || 0) +
  ', independentAzDeg ' + round3(measured.independentAzDeg || 0) +
  ', frameVersusSgrAStarDeg ' + round3(measured.frameVersusSgrAStarDeg || 0) +
  ', transitAltitudeErrorDeg ' + round3(Math.max(measured.transitAltitudeErrorDeg || 0,
    measured.southernTransitErrorDeg || 0, measured.equatorialTransitErrorDeg || 0)) +
  ', refractionDeg ' + round3(measured.refractionDeg || 0) +
  ', planeAboveHorizonOffBy ' + (measured.planeAboveHorizonSamples || 0) +
  ', coarseEdgeDeltaMinutes ' + round3(measured.coarseEdgeDeltaMinutes || 0) +
  ', fullMoonQualityDrop ' + (measured.fullMoonQualityDrop || 0) +
  ', polarAltitudeSpreadDeg ' + round3(measured.polarAltitudeSpreadDeg || 0) +
  ', whiteNightAstronomicalMinutes ' + (measured.whiteNightDarknessMinutes || 0) +
  ', ninetyDayMs ' + (measured.ninetyDayMs || 0) +
  ', ninetyDayNights ' + (measured.extendedNightCount || 0) + '.');

}
