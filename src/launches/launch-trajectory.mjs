/* Launch ascent geometry prototype (Phase 5A research artifact).
   Pure computation: no DOM, no storage, no network, no library import, and no import from the
   launch schedule engine. Nothing in the product imports this file; it exists to establish what can
   honestly be computed about a rocket's ascent from an observer's location, and to prove that the
   geometry is right, before any of it is allowed near a user-facing surface.

   Scope and hard limits, all deliberate:
   * It answers geometric questions only: where the vehicle is, which way you look, how high it is,
     whether it is in sunlight. It never answers how bright anything is or how likely it is to be
     seen, and it never merges its separate knowledge claims into one percentage.
   * Every profile carries an evidence level, and each level fixes which outputs are permitted.
     When the evidence is not there the module returns a refusal with a reason instead of a number.
   * Uncertain and contradictory source data are carried in the profile and surfaced in the result,
     not silently averaged.
   * Time is UTC epoch milliseconds throughout; angles are degrees; azimuth is measured from north
     through east, exactly as overhead-astro.js defines horizontal coordinates.
   See docs/launch-trajectory-feasibility.md. */

/* ---- constants ---------------------------------------------------------- */

// WGS-84 ellipsoid, the datum the launch pads in the feed are published in.
export const WGS84 = Object.freeze({
  a: 6378137.0,                 // semi-major axis, metres
  f: 1 / 298.257223563,         // flattening
  b: 6356752.314245,            // semi-minor axis, metres
  e2: 6.6943799901413165e-3,    // first eccentricity squared
});

// Geometric shadow model constants. The Earth is treated as a sphere for the shadow cone only: the
// difference between the spherical radius and either WGS-84 axis is under 0.4 %, far smaller than
// the atmospheric refraction of grazing sunlight the model already ignores.
export const SHADOW = Object.freeze({
  earthRadiusM: 6371000,        // mean spherical radius used for the shadow cone
  sunAngularRadiusDeg: 0.2666,  // mean apparent solar radius (16 arcmin)
  umbraApexM: 6371000 / Math.tan(0.2666 * Math.PI / 180),
});

// Mean spherical radius used to convert a downrange distance into an along-track angle. The ascent
// ground track of a fixed-azimuth launch is a great circle on a sphere, so the projected surface
// distance is what the profile records; using the mean radius keeps that arithmetic consistent.
export const DOWNRANGE_RADIUS_M = 6371008.8;

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const DEG = v => ((v % 360) + 360) % 360;
// Longitudes are reported signed, the way the launch feed publishes pad longitudes (-120.611),
// while azimuths stay in [0,360) as the astronomy layer defines them.
const LON = v => ((v + 540) % 360) - 180;

/* ---- evidence taxonomy -------------------------------------------------- */
/* The point of the levels is that they cap the output. A launch corridor is not a trajectory; a pad
   position is not a flight path. `samplingS` is the shortest time step at which the level supports a
   positional statement at all (null = not time-resolved). `permitted` and `blocked` are asserted by
   tests, so a later phase cannot quietly widen them. */

export const EVIDENCE_LEVELS = Object.freeze([
  Object.freeze({
    level: 1, code: 'verified-flight-telemetry',
    label: 'Actual flight telemetry or verified trajectory',
    definition: 'Time-indexed state vectors from the operator, a range authority or an instrumented ' +
      'tracking campaign, with a documented method and known frame.',
    provenanceKinds: Object.freeze(['flight-telemetry', 'operational-trajectory-disclosure', 'tracking-derived']),
    samplingS: 1,
    permitted: Object.freeze(['slant range', 'observer bearing', 'observer elevation', 'horizon clearance',
      'timing at the source sampling', 'solar illumination of the trajectory position']),
    blocked: Object.freeze(['brightness or magnitude', 'apparent plume size', 'probability of being seen',
      'optical detectability']),
  }),
  Object.freeze({
    level: 2, code: 'reconstructed-vehicle-profile',
    label: 'Credible mission-specific reconstructed trajectory',
    definition: 'Altitude and downrange against time recovered for one named flight from public ' +
      'telemetry overlays or a documented reconstruction, with the method and its tolerance recorded.',
    provenanceKinds: Object.freeze(['webcast-telemetry-reconstruction', 'documented-reconstruction']),
    samplingS: 10,
    permitted: Object.freeze(['approximate slant range', 'approximate observer bearing',
      'approximate observer elevation', 'horizon clearance', 'timing within the reconstruction tolerance',
      'solar illumination of the trajectory position']),
    blocked: Object.freeze(['second-scale position', 'vehicle attitude', 'apparent plume size',
      'brightness or magnitude', 'probability of being seen', 'optical detectability']),
  }),
  Object.freeze({
    level: 3, code: 'documented-mission-profile',
    label: 'Documented mission-profile approximation',
    definition: 'Published event times and altitudes (liftoff, max Q, MECO, stage separation, second ' +
      'engine start, SECO) for one named mission, without a continuous time-indexed track.',
    provenanceKinds: Object.freeze(['press-kit-timeline', 'mission-profile-document']),
    samplingS: 60,
    permitted: Object.freeze(['ascent direction as a sector', 'elevation range', 'published event times',
      'solar illumination at the published event times']),
    blocked: Object.freeze(['position between published events', 'continuous bearing',
      'horizon clearance between events', 'apparent plume size', 'brightness or magnitude',
      'probability of being seen', 'optical detectability']),
  }),
  Object.freeze({
    level: 4, code: 'launch-corridor-or-hazard-area',
    label: 'Broad geographic launch corridor or hazard area',
    definition: 'A surface polygon or sector published for aviation or maritime safety (NOTAM, TFR, ' +
      'notice to mariners, licence document). It bounds where debris may fall; it is not a path.',
    provenanceKinds: Object.freeze(['hazard-area', 'flight-corridor', 'notam', 'notice-to-mariners']),
    samplingS: null,
    permitted: Object.freeze(['directional sector containing the ascent', 'launch-window timing']),
    blocked: Object.freeze(['elevation angle', 'time-resolved position', 'horizon clearance',
      'solar illumination of the vehicle', 'visibility', 'brightness or magnitude',
      'probability of being seen']),
  }),
  Object.freeze({
    level: 5, code: 'launch-site-only',
    label: 'Launch-pad location and time only',
    definition: 'The pad coordinates and the scheduled instant, with no flight geometry at all. This ' +
      'is the level the production calendar sits at today, and it is why visibility reads unknown.',
    provenanceKinds: Object.freeze(['pad-record', 'schedule-record']),
    samplingS: null,
    permitted: Object.freeze(['pad bearing from the observer', 'sky sector around the pad at liftoff']),
    blocked: Object.freeze(['anything about the vehicle after liftoff', 'elevation angle of the vehicle',
      'horizon clearance', 'solar illumination of the vehicle', 'visibility',
      'brightness or magnitude', 'probability of being seen']),
  }),
]);

export const evidenceLevel = level => {
  const found = EVIDENCE_LEVELS.find(entry => entry.level === level);
  if (!found) throw new Error('Unknown evidence level: ' + level);
  return found;
};

// Words that must never appear as a datum in a trajectory profile or as an output key. Kept beside
// the taxonomy so the guard travels with the module rather than living only in a test.
export const FORBIDDEN_CLAIMS = Object.freeze(['brightness', 'magnitude', 'probability', 'likelihood',
  'confidence_percent', 'percent_chance', 'apparent_size', 'detectability']);

// Same 16-point convention as overhead-astro.js, restated here because that module is a browser
// global that requires the pinned Astronomy Engine at load time and this one must stand alone.
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = azimuth => COMPASS[Math.round(DEG(azimuth) / 22.5) % 16];

/* ---- geodetic and local geometry ---------------------------------------- */

// Geodetic latitude/longitude/height above the ellipsoid to Earth-centred, Earth-fixed metres.
// The prime meridian is +x, 90 degrees east is +y, the north spin axis is +z.
export function geodeticToEcef(latDeg, lonDeg, heightM = 0) {
  if (![latDeg, lonDeg, heightM].every(Number.isFinite)) throw new Error('geodeticToEcef requires finite inputs');
  if (Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 360) throw new Error('geodeticToEcef latitude/longitude out of range');
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const n = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinLat * sinLat);
  return {
    x: (n + heightM) * cosLat * Math.cos(lon),
    y: (n + heightM) * cosLat * Math.sin(lon),
    z: (n * (1 - WGS84.e2) + heightM) * sinLat,
  };
}

// Inverse of the above by fixed-point iteration. Converges to well under a millimetre for every
// point from the ellipsoid surface out to orbital altitude; the loop is bounded so a pathological
// input cannot hang a caller.
export function ecefToGeodetic(point, iterations = 12) {
  const { x, y, z } = point;
  if (![x, y, z].every(Number.isFinite)) throw new Error('ecefToGeodetic requires finite coordinates');
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  if (p === 0) return { latDeg: Math.sign(z) * 90, lonDeg: LON(lon * R2D), heightM: Math.abs(z) - WGS84.b };
  let lat = Math.atan2(z, p * (1 - WGS84.e2));
  let heightM = 0;
  for (let i = 0; i < iterations; i++) {
    const sinLat = Math.sin(lat);
    const n = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinLat * sinLat);
    heightM = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (WGS84.e2 * n) / (n + heightM)));
  }
  return { latDeg: lat * R2D, lonDeg: LON(lon * R2D), heightM };
}

// Local east/north/up unit vectors at a geodetic point: the frame an observer actually points in.
export function enuBasis(latDeg, lonDeg) {
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  return {
    east: { x: -sinLon, y: cosLon, z: 0 },
    north: { x: -sinLat * cosLon, y: -sinLat * sinLon, z: cosLat },
    up: { x: cosLat * cosLon, y: cosLat * sinLon, z: sinLat },
  };
}

export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const norm = v => Math.hypot(v.x, v.y, v.z);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

// Where an observer must look to see an Earth-fixed target, and how far away it is.
// Azimuth is from north through east; elevation is geometric (no refraction) and is negative when the
// target is below the local horizontal plane, which is exactly what happens past the curve of the
// Earth. Earth curvature needs no special case: the target carries its own altitude in the ellipsoid
// frame, so the bulge of the Earth is already inside this arithmetic.
export function look(observer, targetEcef) {
  if (!observer || !Number.isFinite(observer.latDeg) || !Number.isFinite(observer.lonDeg)) {
    throw new Error('look requires an observer with finite latDeg/lonDeg');
  }
  const from = geodeticToEcef(observer.latDeg, observer.lonDeg, observer.heightM || 0);
  const d = sub(targetEcef, from);
  const basis = enuBasis(observer.latDeg, observer.lonDeg);
  const east = dot(d, basis.east), north = dot(d, basis.north), up = dot(d, basis.up);
  const slantRangeM = norm(d);
  const azimuth = Math.atan2(east, north) * R2D;
  return {
    azimuthDeg: DEG(azimuth),
    azimuthCompass: compass(azimuth),
    elevationDeg: slantRangeM === 0 ? 90 : Math.asin(up / slantRangeM) * R2D,
    slantRangeM,
    aboveHorizon: slantRangeM > 0 && up > 0,
    // Height of the target above the observer's local horizontal plane, for horizon-clearance talk.
    tangentialHeightM: up,
    provenance: { frame: 'wgs84-ecef', refraction: 'none' },
  };
}



// Destination point reached by travelling `distanceM` along a sphere of the given radius on an
// initial bearing. This is how a downrange distance plus a launch azimuth becomes a ground position.
export function greatCirclePoint(latDeg, lonDeg, bearingDeg, distanceM, radiusM = DOWNRANGE_RADIUS_M) {
  const lat1 = latDeg * D2R, lon1 = lonDeg * D2R, bearing = bearingDeg * D2R;
  const delta = distanceM / radiusM;
  const sinLat2 = Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(bearing);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(delta) * Math.cos(lat1),
    Math.cos(delta) - Math.sin(lat1) * sinLat2);
  return { latDeg: lat2 * R2D, lonDeg: LON(lon2 * R2D) };
}

// Surface distance between two geodetic points on the same mean sphere, and the initial bearing from
// the first to the second. Used to reconcile a reported observer range with its coordinates.
export function greatCircleBetween(lat1, lon1, lat2, lon2, radiusM = DOWNRANGE_RADIUS_M) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const central = Math.acos(Math.max(-1, Math.min(1,
    Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl))));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return { distanceM: central * radiusM, bearingDeg: DEG(Math.atan2(y, x) * R2D) };
}

// Surface (arc) distance at which a target at one height is exactly on the geometric horizon of an
// observer at another height: R * (acos(R/(R+h1)) + acos(R/(R+h2))). This is an *arc*, not the tangent
// chord sqrt(2Rh), so it is directly comparable with downrange and great-circle distances; the two
// differ by about 2 % at 200 km. It is the analytic reference the tests compare the exact
// ellipsoidal look() against, and it bounds the downrange sweep for a profile without a ground track.
export function horizonDistanceM(observerHeightM, targetHeightM = 0, radiusM = SHADOW.earthRadiusM) {
  const dip = heightM => Math.acos(Math.max(-1, Math.min(1, radiusM / (radiusM + Math.max(0, heightM)))));
  return radiusM * (dip(observerHeightM) + dip(targetHeightM));
}

/* ---- launch-plane reconciliation ---------------------------------------- */
/* The relation between a launch azimuth and the orbital inclination of the plane it reaches:
   cos i = cos(lat) * sin(azimuth), for a non-retrograde ascent flown in a fixed azimuth plane from
   that latitude. Two corrections are deliberately not applied, and both are reported rather than
   hidden: Earth's rotation means the pad-fixed (relative) azimuth differs from the inertial azimuth
   by up to a few degrees for a low-latitude site, and real missions yaw-steer, so the initial pad
   azimuth is not the azimuth of the final orbital plane. The diagnostic therefore exists to expose
   disagreement between sources, never to claim precision. */

export const LAUNCH_PLANE = Object.freeze({
  // Wide enough for the corrections above on a first-stage ascent; tight enough that a yaw-steered or
  // misreported azimuth is caught instead of being absorbed.
  consistentWithinDeg: 3.0,
  neglected: Object.freeze(['earth rotation (relative vs inertial azimuth)',
    'post-liftoff yaw steering or dogleg']),
});

export function planeConsistency(padLatDeg, azimuthDeg, achievedInclinationDeg) {
  if (![padLatDeg, azimuthDeg, achievedInclinationDeg].every(Number.isFinite)) {
    throw new Error('planeConsistency requires finite pad latitude, azimuth and inclination');
  }
  const impliedInclinationDeg = Math.acos(Math.cos(padLatDeg * D2R) * Math.sin(azimuthDeg * D2R)) * R2D;
  const deltaDeg = impliedInclinationDeg - achievedInclinationDeg;
  return {
    impliedInclinationDeg, achievedInclinationDeg, deltaDeg,
    consistent: Math.abs(deltaDeg) <= LAUNCH_PLANE.consistentWithinDeg,
    neglected: LAUNCH_PLANE.neglected,
    note: Math.abs(deltaDeg) <= LAUNCH_PLANE.consistentWithinDeg
      ? 'Pad azimuth and achieved inclination agree within the neglected corrections.'
      : 'Pad azimuth and achieved inclination disagree beyond the neglected corrections: the ascent is ' +
        'not one fixed-azimuth plane (yaw steering, a dogleg, or a misreported azimuth). A ground ' +
        'track built from the pad azimuth alone cannot be trusted at this tolerance.',
  };
}

/* The two headings of an orbital plane at the pad latitude.

   cos i = cos(lat) * sin(A) has two solutions, and they are the two headings along the *same* great
   circle: one with a northerly component, one with a southerly component. The pair is what the
   inclination and the latitude determine; which of the two a launch used is a separate fact that the
   inclination alone does not contain, because it depends on where the ascending node sat at liftoff.
   Selecting a branch needs evidence about how the vehicle actually departed (a published azimuth, or a
   documented launch corridor), so this function reports both and never picks one silently.

   Validity: a fixed-azimuth, non-dogleg ascent from that latitude. A yaw-steered or dogleg ascent
   leaves the pad on one heading and reaches the plane on another, so the two headings are the plane's,
   not necessarily the pad's, and an independently documented pad azimuth may legitimately disagree -
   which is exactly what the plane-consistency gate is for. |cos i / cos lat| > 1 means the plane does
   not reach that latitude at all and there is no heading to report. */

export function planeAzimuths(padLatDeg, achievedInclinationDeg) {
  if (![padLatDeg, achievedInclinationDeg].every(Number.isFinite)) {
    throw new Error('planeAzimuths requires finite latitude and inclination');
  }
  const ratio = Math.cos(achievedInclinationDeg * D2R) / Math.cos(padLatDeg * D2R);
  if (!Number.isFinite(ratio) || Math.abs(ratio) > 1) {
    return { available: false, ratio,
      reason: 'an inclination of ' + achievedInclinationDeg + ' degrees cannot be reached from latitude ' +
        padLatDeg + ': the plane does not cross that latitude' };
  }
  const northerlyDeg = DEG(Math.asin(ratio) * R2D);
  const southerlyDeg = DEG(180 - Math.asin(ratio) * R2D);
  return {
    available: true, ratio, northerlyDeg, southerlyDeg,
    northerlyCompass: compass(northerlyDeg), southerlyCompass: compass(southerlyDeg),
    retrograde: achievedInclinationDeg > 90,
    neglected: LAUNCH_PLANE.neglected,
  };
}



/* ---- orbital anchors and the terminal-state gate ------------------------- */
/* Phase 5B validates a reconstructed ascent against an independently catalogued achieved orbit. The
   arithmetic below is deliberately textbook: a spherical geocentric radius from an altitude above the
   equatorial radius, and the vis-viva relation for the speed an object must have at that radius in the
   catalogued orbit. It owes nothing to the reconstruction under test, which is the point of the check. */

export const EARTH = Object.freeze({
  muKm3S2: 398600.4418,         // Earth's gravitational parameter, km^3/s^2 (EGM96 scale)
  equatorialRadiusKm: 6378.137, // WGS-84 semi-major axis, used as the geocentric radius datum
});

// Geocentric radius from an altitude above the equatorial radius. Kept apart from the ellipsoidal
// geodetic conversion on purpose: conflating "altitude above the equator" with "height above the local
// ellipsoid" is a classic way to smuggle a twenty-kilometre error into a validation, and the two
// quantities differ by up to the flattening (21 km at the poles).
export function orbitalRadiusKm(altitudeM) {
  if (!Number.isFinite(altitudeM)) throw new Error('orbitalRadiusKm needs a finite altitude');
  return EARTH.equatorialRadiusKm + altitudeM / 1000;
}

// Semi-major axis of an orbit described by its perigee and apogee altitudes.
export function orbitSemiMajorAxisKm(perigeeKm, apogeeKm) {
  if (![perigeeKm, apogeeKm].every(Number.isFinite)) throw new Error('orbitSemiMajorAxisKm needs finite altitudes');
  if (perigeeKm <= -EARTH.equatorialRadiusKm || apogeeKm < perigeeKm) {
    throw new Error('orbitSemiMajorAxisKm needs a physically ordered orbit');
  }
  return EARTH.equatorialRadiusKm + (perigeeKm + apogeeKm) / 2;
}

// Vis-viva: the speed along that orbit at a given geocentric radius.
export function visVivaSpeedMps(perigeeKm, apogeeKm, radiusKm) {
  const a = orbitSemiMajorAxisKm(perigeeKm, apogeeKm);
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) throw new Error('visVivaSpeedMps needs a finite radius');
  return Math.sqrt(EARTH.muKm3S2 * (2 / radiusKm - 1 / a)) * 1000;
}

// The speed the vehicle must have had at perigee: the insertion speed of the catalogued orbit.
export const insertionSpeedMps = (perigeeKm, apogeeKm) =>
  visVivaSpeedMps(perigeeKm, apogeeKm, EARTH.equatorialRadiusKm + perigeeKm);

/* ---- the terminal-state gate -------------------------------------------- */
/* Tolerances, and why they are what they are rather than something chosen to let a given profile
   through. The measured populations separate cleanly: the published profiles agree with their anchors to
   within 1.3 per cent in speed and 5 km in altitude, while every candidate that fails fails by at least
   4.8 per cent in speed or 429 km in altitude. Each tolerance sits inside that gap, and the two are
   independent: the Falcon Heavy demonstration passes on altitude at 1 km and fails on speed at 18 per
   cent. Widening either tolerance would admit an anchored profile whose own anchor contradicts it. */

export const TERMINAL_STATE = Object.freeze({
  speedRelative: 0.03,
  altitudeKm: 25,
  passingPopulation: 'within 1.3 per cent and 5 km',
  rejectedPopulation: 'at least 4.8 per cent in speed, or 429 km and beyond in altitude',
  basis: 'each tolerance falls inside the measured gap between the passing and failing populations, not inside a published error budget',
});

// Does the reconstructed end state agree with an independently catalogued orbit?
//
// Applicability comes first, because comparing against the wrong orbit is worse than not comparing at
// all: a geostationary satellite's catalogue orbit is its operational orbit after its own apogee motor
// fired, a space-station cargo run's is the station approach orbit, and a booster's last sample is a
// landing. Only a mission that reaches its catalogue orbit on the launcher's own final burn can be
// checked this way, so the anchor has to declare itself an insertion state.
export function terminalStateConsistency({ terminal, orbit }) {
  if (!terminal || !orbit) return { applicable: false, passes: null, reason: 'no terminal sample or no orbit anchor' };
  if (orbit.appliesTo !== 'insertion') {
    return { applicable: false, passes: null, anchorAppliesTo: orbit.appliesTo ?? 'unstated',
      reason: 'the catalogued orbit is ' + (orbit.appliesTo === 'operational'
        ? "the operational orbit after the payload's own manoeuvres, not the launcher insertion state"
        : 'not declared an insertion state, so the comparison would not be a check') };
  }
  if (!Number.isFinite(terminal.altitudeM) || !Number.isFinite(terminal.velocityMps)) {
    return { applicable: false, passes: null, reason: 'the terminal sample carries no altitude and speed' };
  }
  if (terminal.altitudeM < 1000) {
    return { applicable: false, passes: null,
      reason: 'the profile ends on the ground (a booster landing or an incomplete series)' };
  }
  if (terminal.phase && terminal.phase !== 'second-stage') {
    return { applicable: false, passes: null, reason: 'the last sample is ' + terminal.phase + ', not the insertion phase' };
  }
  const radiusKm = orbitalRadiusKm(terminal.altitudeM);
  const expectedSpeedMps = visVivaSpeedMps(orbit.perigeeKm, orbit.apogeeKm, radiusKm);
  const speedErrorMps = terminal.velocityMps - expectedSpeedMps;
  const speedRelativeError = speedErrorMps / expectedSpeedMps;
  // Compare against the nearer apsis: a profile ending close to either the perigee or the apogee of an
  // elliptical insertion is consistent with it, but one ending in the middle of an eccentric orbit is not.
  const altitudeErrorKm = Math.min(Math.abs(terminal.altitudeM / 1000 - orbit.perigeeKm),
    Math.abs(terminal.altitudeM / 1000 - orbit.apogeeKm));
  const failures = [];
  if (Math.abs(speedRelativeError) > TERMINAL_STATE.speedRelative) failures.push('speed');
  if (altitudeErrorKm > TERMINAL_STATE.altitudeKm) failures.push('altitude');
  return {
    applicable: true, passes: failures.length === 0, failures,
    radiusKm, expectedSpeedMps, speedErrorMps, speedRelativeError, altitudeErrorKm,
    tolerances: { speedRelative: TERMINAL_STATE.speedRelative, altitudeKm: TERMINAL_STATE.altitudeKm },
    basis: TERMINAL_STATE.basis,
    note: failures.length === 0
      ? 'The reconstructed end state agrees with the catalogued orbit within the gate tolerances.'
      : 'The reconstructed end state disagrees with the catalogued orbit in ' + failures.join(' and ') +
        '; the profile is direction-only and may not produce an elevation or a timed observing window',
  };
}


/* ---- publication permissions -------------------------------------------- */
/* The single place where the taxonomy, the two anchoring gates and what may be shown meet. The
   build-time generator and the browser adapter both call it, so a profile can never be presented more
   generously than it was validated, and no gate can be overridden further downstream. */

export function publicationPermissions(validation) {
  if (!validation) return null; // research fixtures without gates keep the Phase 5A behaviour
  const plane = validation.plane || {};
  const terminal = validation.terminal || {};
  const planeFailed = plane.applicable === true && plane.consistent === false;
  const terminalPasses = terminal.applicable === true && terminal.passes === true;
  const elevation = terminalPasses && !planeFailed;
  const reasons = [];
  if (planeFailed) {
    reasons.push('the orbital-plane check disagreed with the documented azimuth by ' +
      Math.abs(Number(plane.deltaDeg) || 0).toFixed(1) + ' degrees');
  }
  if (terminal.applicable === false) reasons.push('the terminal-state check does not apply: ' + (terminal.reason || 'no reason recorded'));
  if (terminal.applicable === true && terminal.passes === false) {
    reasons.push('the terminal-state check failed in ' + ((terminal.failures || []).join(' and ') || 'an unstated way'));
  }
  if (terminal.applicable !== true) reasons.push('no independently catalogued insertion orbit was compared');
  return {
    direction: 'sector',
    elevation,
    timedWindow: elevation,
    illumination: elevation ? 'vehicle-and-observer' : 'observer-only',
    downgraded: !elevation,
    reasons,
  };
}

// Gate results and permissions must agree wherever both are written down, so a hand-edited artifact
// cannot award itself an elevation it did not earn.
export function validateValidationBlock(validation) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!validation || typeof validation !== 'object') return ['validation must be an object'];
  for (const key of ['plane', 'terminal']) {
    if (validation[key] !== undefined && typeof validation[key] !== 'object') fail(`validation.${key} must be an object`);
  }
  if (validation.terminal && validation.terminal.applicable === true) {
    const terminal = validation.terminal;
    if (typeof terminal.passes !== 'boolean') fail('an applicable terminal check must state passes true or false');
    for (const field of ['radiusKm', 'expectedSpeedMps', 'speedErrorMps', 'speedRelativeError', 'altitudeErrorKm']) {
      if (!Number.isFinite(terminal[field])) fail(`an applicable terminal check must carry a finite ${field}`);
    }
    if (!terminal.tolerances || !Number.isFinite(terminal.tolerances.speedRelative) || !Number.isFinite(terminal.tolerances.altitudeKm)) {
      fail('an applicable terminal check must state its tolerances');
    }
    if (terminal.passes === false && !(terminal.failures || []).length) fail('a failed terminal check must name what failed');
  }
  if (validation.permissions) {
    const derived = publicationPermissions(validation);
    for (const key of ['direction', 'elevation', 'timedWindow', 'illumination', 'downgraded']) {
      if (validation.permissions[key] !== derived[key]) {
        fail(`validation.permissions.${key} disagrees with the gates: stated ${JSON.stringify(validation.permissions[key])}, derived ${JSON.stringify(derived[key])}`);
      }
    }
    if (derived.elevation === false && validation.permissions.elevation === true) {
      fail('a profile may not award itself an elevation its gates did not pass');
    }
  }
  return errors;
}


/* ---- the published artifact --------------------------------------------- */
/* A small, versioned, reviewed set of historical profiles. The generator that writes it and the browser
   that reads it run the same validation, so an artifact the build accepted cannot quietly differ at
   runtime, and a profile can never be published as a verified trajectory it is not. */

export const PROFILES_SCHEMA = 'worthlookingup.trajectory-profiles/1';

// Publication adds requirements that research fixtures do not have to meet: a named licence, a
// retrieved source, a described method, an orbit anchor with a citation, gate results, and no synthetic
// provenance whatsoever.
export function validatePublishableProfile(profile) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!profile || typeof profile !== 'object') return { ok: false, errors: ['profile must be an object'] };
  if (profile.synthetic === true) fail('a synthetic profile must never be published as a historical flight');
  const evidence = profile.evidence || {};
  for (const field of ['licence', 'retrievedUtc', 'method', 'sourceUrl']) {
    if (!evidence[field]) fail(`a published profile must state its ${field}`);
  }
  if (!profile.orbit || !profile.orbit.source) fail('a published profile must carry its achieved-orbit anchor and cite it');
  else if (!['insertion', 'operational'].includes(profile.orbit.appliesTo)) {
    fail('a published profile must declare whether its anchor is an insertion or an operational state');
  }
  if (!profile.validation) {
    fail('a published profile must carry its gate results');
  } else {
    const terminal = profile.validation.terminal || {};
    if (terminal.applicable === undefined) fail('the terminal gate must record applicability even when it does not apply');
    if (terminal.applicable === true && typeof terminal.passes !== 'boolean') fail('an applicable terminal gate must record pass or fail');
    const permissions = publicationPermissions(profile.validation);
    if (!permissions) fail('permissions could not be derived from the gate results');
    else if (permissions.downgraded && !(permissions.reasons || []).length) fail('a downgraded profile must say which gate failed');
  }
  if (Array.isArray(profile.samples) && profile.samples.length && !profile.terminal) {
    fail('a sampled profile must record the terminal sample it was checked against');
  }
  return { ok: errors.length === 0, errors };
}

export function validateProfileArtifact(artifact) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!artifact || typeof artifact !== 'object') return { ok: false, errors: ['artifact must be an object'], profiles: [] };
  if (artifact.schema !== PROFILES_SCHEMA) fail(`schema must be ${PROFILES_SCHEMA}`);
  if (!Array.isArray(artifact.profiles) || artifact.profiles.length === 0) fail('profiles must be a non-empty array');
  const ids = new Set();
  for (const profile of artifact.profiles || []) {
    const label = profile && profile.id ? profile.id : 'unnamed profile';
    for (const message of validateProfile(profile).errors) fail(`${label}: ${message}`);
    for (const message of validatePublishableProfile(profile).errors) fail(`${label}: ${message}`);
    if (ids.has(profile.id)) fail(`duplicate profile id ${label}`);
    ids.add(profile.id);
  }
  return { ok: errors.length === 0, errors, profiles: artifact.profiles || [] };
}

export function assertProfileArtifact(artifact) {
  const result = validateProfileArtifact(artifact);
  if (!result.ok) throw new Error('Invalid published trajectory-profile artifact: ' + result.errors.join('; '));
  return artifact;
}



/* ---- solar geometry ----------------------------------------------------- */

// Unit vector to a celestial direction, expressed in the Earth-fixed frame, from its geocentric
// right ascension and declination of date and Greenwich apparent sidereal time in hours. This is the
// only bridge between the pinned astronomy layer (which owns right ascension, declination and
// sidereal time) and this file's Earth-fixed geometry, so the module needs no ephemeris of its own
// and the bridge is one testable line of trigonometry.
export function sunUnitEcef(raDeg, decDeg, siderealHours) {
  if (![raDeg, decDeg, siderealHours].every(Number.isFinite)) {
    throw new Error('sunUnitEcef requires finite right ascension, declination and sidereal time');
  }
  const hourAngle = (raDeg - siderealHours * 15) * D2R;
  const dec = decDeg * D2R;
  return { x: Math.cos(dec) * Math.cos(hourAngle), y: Math.cos(dec) * Math.sin(hourAngle), z: Math.sin(dec) };
}

// Sunlit, penumbral or fully shadowed, for an Earth-fixed point, against the Earth's shadow cone.
//
// Model: the shadow is the rotationally symmetric cone swept by the lines from the Sun's limb that are
// tangent to a spherical Earth. A point at distance d behind the Earth's centre along the anti-solar
// direction sits inside a circle of radius R - d*tan(rho) for full shadow (umbra) and R + d*tan(rho)
// for full sunlight (outside the penumbra), where rho is the Sun's apparent angular radius. Between
// those two radii the point sees part of the solar disk: partial illumination.
//
// Known omissions, stated rather than glossed: sunlight refraction in the atmosphere (about half a
// degree at grazing incidence, which extends sunlit conditions slightly and widens the penumbral
// band), the Earth's oblateness and terrain, and any cloud. The geometric limb itself is sharp: at
// low Earth orbit the penumbral band is only a few kilometres wide, so the honest uncertainty here is
// atmospheric, not geometric.
export function shadowState(pointEcef, sunUnit, options = {}) {
  const radiusM = options.earthRadiusM || SHADOW.earthRadiusM;
  const rho = ((options.sunAngularRadiusDeg ?? SHADOW.sunAngularRadiusDeg)) * D2R;
  const r = norm(pointEcef), along = dot(pointEcef, sunUnit);
  if (along >= 0) return { state: 'sunlit', reason: 'point lies on the sunward side of the Earth' };
  const behindM = -along;
  if (behindM >= radiusM / Math.tan(rho)) return { state: 'sunlit', reason: 'beyond the umbral cone, no full shadow exists' };
  const perpendicularM = Math.sqrt(Math.max(0, r * r - along * along));
  const umbraRadiusM = radiusM - behindM * Math.tan(rho);
  const penumbraRadiusM = radiusM + behindM * Math.tan(rho);
  const state = perpendicularM <= umbraRadiusM ? 'umbra' : (perpendicularM <= penumbraRadiusM ? 'penumbra' : 'sunlit');
  return { state, behindM, perpendicularM, umbraRadiusM, penumbraRadiusM,
    reason: state === 'umbra' ? 'inside the umbra: no part of the solar disk is visible'
      : state === 'penumbra' ? 'inside the penumbra: part of the solar disk is visible'
        : 'outside the penumbra: the whole solar disk is visible' };
}

// Local solar elevation at an Earth-fixed point, in degrees, from the Earth-fixed Sun direction.
// Kept here so the tests can compare it with the pinned library's own solar altitude without the
// module importing anything.
export function solarElevationDeg(pointEcef, sunUnit) {
  const r = norm(pointEcef);
  return Math.asin(dot(pointEcef, sunUnit) / r) * R2D;
}

// Twilight band for a solar elevation, using the same thresholds as overhead-astro.js RULES.twilight
// so the launch work cannot drift from the astronomy layer's definition of darkness.
export function twilightBand(sunAltitudeDeg) {
  if (sunAltitudeDeg >= 0) return 'daylight';
  if (sunAltitudeDeg > -6) return 'civil';
  if (sunAltitudeDeg > -12) return 'nautical';
  if (sunAltitudeDeg > -18) return 'astronomical';
  return 'deep-night';
}


/* ---- profile validation -------------------------------------------------- */
/* Validation is where the honesty rules are enforced mechanically. A profile that cannot say where
   it came from, what its uncertainty is, or which source data it could not reconcile is rejected
   outright rather than being used with an implied caveat. */

export const PROFILE_SCHEMA = 'worthlookingup.trajectory-profile/1';
const AZIMUTH_KINDS = Object.freeze(['documented', 'derived-from-achieved-inclination', 'corridor-derived']);
const PRECISIONS = Object.freeze(['second', 'minute', 'hour', 'day']);
// An instant with an explicit offset: a bare "2018-10-08 02:21" would be read as local time.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}t?\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:\d{2})$/i;

function scanForbiddenKeys(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_CLAIMS.some(word => key.toLowerCase().includes(word))) {
      errors.push(`${path}${key} is a claim this module is not allowed to carry`);
    }
    scanForbiddenKeys(child, `${path}${key}.`, errors);
  }
}

export function validateProfile(profile) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!profile || typeof profile !== 'object') return { ok: false, errors: ['profile must be an object'], level: null };
  if (profile.schema !== PROFILE_SCHEMA) fail(`schema must be ${PROFILE_SCHEMA}`);
  for (const field of ['id', 'mission', 'vehicle']) {
    if (typeof profile[field] !== 'string' || !profile[field]) fail(`${field} is required`);
  }
  const evidence = profile.evidence || {};
  const synthetic = profile.synthetic === true;
  let level = null;
  try { level = evidenceLevel(evidence.level); } catch { fail(`evidence.level must be 1..5 (got ${evidence.level})`); }
  if (level && !synthetic) {
    if (evidence.code !== level.code) fail(`evidence.code must be ${level.code} for level ${level.level}`);
    if (!level.provenanceKinds.includes(evidence.provenanceKind)) {
      fail(`evidence.provenanceKind ${evidence.provenanceKind} cannot support level ${level.level}`);
    }
  } else if (level && evidence.code !== level.code) {
    fail(`evidence.code must be ${level.code} for level ${level.level}`);
  }
  if (synthetic && evidence.provenanceKind !== 'synthetic-fixture') {
    fail('a synthetic profile must declare evidence.provenanceKind = synthetic-fixture');
  }
  if (!synthetic && !evidence.provenanceKind) fail('a non-synthetic profile must declare a provenance kind');
  if (!synthetic && !evidence.source) fail('a non-synthetic profile must name its source');
  if (!synthetic && level && level.level <= 3 && !evidence.sourceUrl) {
    fail('a time-resolved profile must cite a source URL so the derivation can be checked');
  }
  if (!synthetic && level && level.level <= 3 && !evidence.retrievedUtc) {
    fail('a time-resolved profile must record when its source was retrieved');
  }
  const site = profile.site || {};
  if (!Number.isFinite(site.latDeg) || Math.abs(site.latDeg) > 90) fail('site.latDeg must be a finite latitude');
  if (!Number.isFinite(site.lonDeg) || Math.abs(site.lonDeg) > 360) fail('site.lonDeg must be a finite longitude');
  if (typeof site.pad !== 'string' || !site.pad) fail('site.pad is required');
  const launch = profile.launch || {};
  // A launch instant must be an unambiguous UTC-ish ISO instant: a string without an offset would be
  // read as local time by Date.parse, which is exactly the class of bug this project cannot afford.
  if (!ISO_INSTANT.test(String(launch.utc)) || !Number.isFinite(Date.parse(launch.utc))) {
    fail('launch.utc must be an ISO instant carrying an offset or Z (got ' + launch.utc + ')');
  }
  if (!PRECISIONS.includes(launch.precision)) fail('launch.precision must be one of ' + PRECISIONS.join('/'));
  const azimuth = profile.azimuth || {};
  // Levels 1 to 4 all need some statement of which way the vehicle goes; level 5 (pad and time only)
  // has none, and inventing one there would be exactly the failure this phase exists to prevent.
  if (level && level.level <= 4) {
    if (!Number.isFinite(azimuth.deg) || azimuth.deg < 0 || azimuth.deg >= 360) fail('azimuth.deg must be in [0,360)');
    if (!AZIMUTH_KINDS.includes(azimuth.kind)) fail('azimuth.kind must be ' + AZIMUTH_KINDS.join(' or '));
    if (!Number.isFinite(azimuth.uncertaintyDeg) || azimuth.uncertaintyDeg < 0) fail('azimuth.uncertaintyDeg is required');
    if (typeof azimuth.source !== 'string' || !azimuth.source) fail('azimuth.source is required');
    if (level.level === 4 && azimuth.kind !== 'corridor-derived') {
      fail('a level 4 corridor must mark its bearing as corridor-derived, not as a measured launch azimuth');
    }
    if (level.level <= 3 && azimuth.kind === 'corridor-derived') {
      fail('a corridor bearing cannot support a time-resolved or documented ascent profile');
    }
  } else if (profile.azimuth != null) {
    fail('level 5 evidence is a pad and a time; it carries no ascent azimuth');
  }
  // Phase 5B blocks are checked only when they are present, so every Phase 5A research fixture keeps
  // validating unchanged while a published profile cannot be sloppy about its anchors or its gates.
  if (profile.validation !== undefined) {
    for (const message of validateValidationBlock(profile.validation)) fail(message);
  }
  const orbit = profile.orbit;
  if (orbit !== undefined) {
    if (!orbit || typeof orbit !== 'object') fail('orbit must be an object');
    else if (!Number.isFinite(orbit.perigeeKm) || !Number.isFinite(orbit.apogeeKm) || !Number.isFinite(orbit.inclinationDeg)) {
      fail('orbit needs finite perigeeKm, apogeeKm and inclinationDeg');
    } else {
      if (orbit.perigeeKm > orbit.apogeeKm) fail('orbit perigee must not exceed apogee');
      if (orbit.perigeeKm <= -EARTH.equatorialRadiusKm) fail('orbit perigee is below the centre of the Earth');
      // Declaration is optional here so the Phase 5A research fixtures keep validating, but a missing
      // declaration can only ever withhold output: the gate treats an undeclared anchor as uncheckable.
      if (orbit.appliesTo !== undefined && !['insertion', 'operational'].includes(orbit.appliesTo)) {
        fail('orbit.appliesTo must be insertion or operational');
      }
      if (typeof orbit.source !== 'string' || !orbit.source) fail('orbit.source is required so the anchor can be checked');
    }
  }
  if (profile.terminal !== undefined) {
    const terminal = profile.terminal;
    if (!terminal || typeof terminal !== 'object') fail('terminal must be an object');
    else {
      if (!Number.isFinite(terminal.altitudeM) || !Number.isFinite(terminal.velocityMps)) {
        fail('terminal needs a finite altitudeM and velocityMps');
      }
      if (terminal.phase !== undefined && typeof terminal.phase !== 'string') fail('terminal.phase must be a string');
    }
  }
  if (azimuth.branch !== undefined) {
    if (!['northerly', 'southerly'].includes(azimuth.branch)) fail('azimuth.branch must be northerly or southerly');
    if (!Number.isFinite(azimuth.alternateDeg)) {
      fail('choosing one plane heading must record the alternate heading rather than hiding the ambiguity');
    }
  }
  return finishProfileValidation(profile, errors, level, synthetic);
}

function finishProfileValidation(profile, errors, level, synthetic) {
  const fail = message => errors.push(message);
  const gaps = Array.isArray(profile.gaps) ? profile.gaps : [];
  const samples = Array.isArray(profile.samples) ? profile.samples : [];
  if (level && level.level === 3) {
    // A documented mission profile is a list of published events, not a continuous track. Keeping the
    // two shapes apart is what stops a press-kit timeline from being walked as if it were telemetry.
    const events = Array.isArray(profile.events) ? profile.events : [];
    if (events.length < 2) fail('level 3 needs at least two published events');
    if (samples.length) fail('level 3 evidence is not a continuous track and must not carry samples');
    for (const event of events) {
      if (typeof event.name !== 'string' || !event.name) fail('each event needs a name');
      if (!Number.isFinite(event.t) || event.t < 0) fail(`event ${event.name} needs a finite t >= 0`);
      if (!Number.isFinite(event.altitudeM) || event.altitudeM < 0) fail(`event ${event.name} needs a finite altitudeM >= 0`);
      if (typeof event.source !== 'string' || !event.source) fail(`event ${event.name} must name its source`);
    }
  } else if (level && level.samplingS === null) {
    if (samples.length) fail(`level ${level.level} evidence is not time-resolved and must not carry samples`);
  } else if (samples.length < 2) {
    fail('a time-resolved profile needs at least two samples');
  }
  let previous = -Infinity;
  for (const sample of samples) {
    if (!Number.isFinite(sample.t) || sample.t < 0) { fail('sample time must be a finite t >= 0'); continue; }
    if (sample.t <= previous) fail(`sample times must increase strictly (broken at t=${sample.t})`);
    previous = sample.t;
    if (!Number.isFinite(sample.altitudeM) || sample.altitudeM < 0) fail(`sample altitude at t=${sample.t} must be >= 0`);
    if (!Number.isFinite(sample.downrangeM) || sample.downrangeM < 0) fail(`sample downrange at t=${sample.t} must be >= 0`);
    for (const gap of gaps) {
      if (sample.t > gap.fromT && sample.t < gap.toT) fail(`sample t=${sample.t} lies inside declared gap ${gap.fromT}..${gap.toT}`);
    }
  }
  for (const gap of gaps) {
    if (!Number.isFinite(gap.fromT) || !Number.isFinite(gap.toT) || gap.fromT >= gap.toT) fail('each gap needs increasing from/to');
    if (typeof gap.reason !== 'string' || !gap.reason) fail('each gap must carry a reason');
  }
  if (Number.isFinite(profile.samplingS) && level && Number.isFinite(level.samplingS) && profile.samplingS < level.samplingS) {
    fail(`profile sampling ${profile.samplingS}s is finer than level ${level.level} supports (${level.samplingS}s)`);
  }
  if (level && level.level <= 2 && !Number.isFinite(profile.samplingS)) {
    fail('a time-resolved profile must declare its samplingS');
  }
  for (const disagreement of (profile.disagreements || [])) {
    if (typeof disagreement.field !== 'string' || !disagreement.field) fail('each disagreement needs a field');
    if (!Array.isArray(disagreement.values) || disagreement.values.length < 2) {
      fail('a disagreement needs at least two competing values');
    } else if (disagreement.values.some(entry => entry.source === undefined)) {
      fail('every competing value must name its source');
    }
    if (!['unresolved', 'reported', 'resolved'].includes(disagreement.resolution)) {
      fail('a disagreement must be marked unresolved, reported or resolved');
    }
  }
  scanForbiddenKeys(profile, '', errors);
  return { ok: errors.length === 0, errors, level, synthetic };
}

export function assertValidProfile(profile) {
  const result = validateProfile(profile);
  if (!result.ok) throw new Error('Invalid trajectory profile: ' + result.errors.join('; '));
  return profile;
}


/* ---- position from a profile -------------------------------------------- */

// Position at a time in seconds after liftoff, interpolated linearly between samples along the
// downrange arc. Every outcome that is not a real interpolated sample is reported as a refusal:
// before the first sample, after the last one (a second-stage profile ends at SECO and nothing may be
// extrapolated past it) and inside a declared gap. No invented positions, ever.
export function profilePosition(profile, tSeconds) {
  const samples = profile.samples || [];
  const level = evidenceLevel(profile.evidence.level);
  if (level.samplingS === null) {
    return { ok: false, state: 'not-time-resolved',
      reason: `level ${level.level} (${level.code}) supplies no time-resolved position` };
  }
  if (!samples.length) {
    return { ok: false, state: 'events-only',
      reason: 'this profile carries published events, not a continuous track, so no position exists between events' };
  }
  if (!Number.isFinite(tSeconds)) return { ok: false, state: 'invalid-time', reason: 'time must be finite' };
  const first = samples[0], last = samples[samples.length - 1];
  if (tSeconds < first.t) return { ok: false, state: 'before', reason: `t=${tSeconds}s precedes the first sample at ${first.t}s` };
  if (tSeconds > last.t) return { ok: false, state: 'after', reason: `t=${tSeconds}s is after the last sample at ${last.t}s; nothing is extrapolated` };
  for (const gap of (profile.gaps || [])) {
    if (tSeconds > gap.fromT && tSeconds < gap.toT) {
      return { ok: false, state: 'gap', reason: `t=${tSeconds}s falls inside the ${gap.fromT}-${gap.toT}s gap: ${gap.reason}`, gap };
    }
  }
  let index = 0;
  while (index < samples.length - 2 && samples[index + 1].t < tSeconds) index++;
  const a = samples[index], b = samples[index + 1];
  const span = b.t - a.t;
  const fraction = span === 0 ? 0 : (tSeconds - a.t) / span;
  const altitudeM = a.altitudeM + (b.altitudeM - a.altitudeM) * fraction;
  const downrangeM = a.downrangeM + (b.downrangeM - a.downrangeM) * fraction;
  return { ok: true, state: 'interpolated', t: tSeconds, altitudeM, downrangeM,
    interpolated: tSeconds !== a.t && tSeconds !== b.t, bracket: [a.t, b.t] };
}

// One sampled state of the ascent: geodetic ground position, Earth-fixed vector, and what the observer
// sees. The ground position comes from the pad plus the profile's own downrange along the launch
// azimuth, and the altitude is the profile's own altitude, so the line-of-sight geometry is exact
// even though the ground track is an approximation (see planeConsistency and the feasibility report).
export function ascentState(profile, observer, tSeconds) {
  const position = profilePosition(profile, tSeconds);
  if (!position.ok) return position;
  const launchMs = Date.parse(profile.launch.utc);
  const ground = greatCirclePoint(profile.site.latDeg, profile.site.lonDeg, profile.azimuth.deg, position.downrangeM);
  const ecef = geodeticToEcef(ground.latDeg, ground.lonDeg, position.altitudeM);
  const sight = look(observer, ecef);
  return {
    ok: true, state: 'observed', t: tSeconds, utc: new Date(launchMs + tSeconds * 1000).toISOString(),
    altitudeM: position.altitudeM, downrangeM: position.downrangeM,
    latDeg: ground.latDeg, lonDeg: ground.lonDeg, ecef,
    azimuthDeg: sight.azimuthDeg, azimuthCompass: sight.azimuthCompass,
    elevationDeg: sight.elevationDeg, slantRangeM: sight.slantRangeM, aboveHorizon: sight.aboveHorizon,
  };
}


/* ---- knowledge grading --------------------------------------------------- */
/* Three separate claims, each graded in words and never merged into one number: what the schedule
   says, what the flight geometry rests on, and what the observation conditions rest on. */

export const GRADES = Object.freeze({
  schedule: Object.freeze({
    second: 'published to the second', minute: 'published to the minute',
    hour: 'published to the hour', day: 'published to the day',
  }),
  geometry: Object.freeze({
    1: 'measured flight trajectory with a documented frame',
    2: 'mission-specific reconstruction, tolerance limited',
    3: 'direction and altitude only; ground position unknown',
    4: 'directional sector from a safety area, not a path',
    5: 'launch site only; no flight geometry',
  }),
});

// The longest refusal list still worth printing to a user; anything longer is a sign the evidence
// level is being pushed past what it can support and the caller should not be showing a card at all.
export const REFUSAL_LIMIT = 12;

/* ---- the assessment ------------------------------------------------------ */

// What can honestly be said about one launch, from one observer, at the evidence level the data
// supports. `sun` is injected rather than imported: the pinned astronomy layer owns solar position,
// and the caller supplies { sunUnitEcefAt(ms), solarElevationAt(ms, latDeg, lonDeg) }. Without it the
// illumination section is explicitly unavailable instead of silently assumed.
//
// The returned object always carries permitted outputs, the list of things that remain unknown, and
// explicit refusals with reasons. It never carries brightness, apparent size or any probability.
export function assess({ profile, observer, sun = null, stepS = null, allowSynthetic = false }) {
  const validation = validateProfile(profile);
  if (!validation.ok) {
    return { available: false, refusals: validation.errors, unknown: ['everything: the profile failed validation'],
      permitted: [], evidence: null, profile: null };
  }
  const level = validation.level;
  const synthetic = profile.synthetic === true;
  if (synthetic && !allowSynthetic) {
    return { available: false, evidence: { level: level.level, code: level.code, label: level.label },
      profile: { id: profile.id, mission: profile.mission, synthetic: true },
      refusals: ['this is a synthetic fixture: it must never be presented as a prediction for a real launch'],
      unknown: ['everything about any real event'], permitted: [] };
  }
  const refusals = [];
  const unknown = ['whether anything can actually be seen (no optics, no weather, no brightness data)',
    'cloud, haze and local obstruction at the observer', "the observer's own horizon and light pollution"];
  const launchMs = Date.parse(profile.launch.utc);
  const padEcef = geodeticToEcef(profile.site.latDeg, profile.site.lonDeg, Number.isFinite(profile.site.heightM) ? profile.site.heightM : 0);
  const padSight = look(observer, padEcef);
  const plane = Number.isFinite(profile.plane && profile.plane.achievedInclinationDeg)
    ? planeConsistency(profile.site.latDeg, profile.azimuth.deg, profile.plane.achievedInclinationDeg) : null;
  if (plane && !plane.consistent) {
    refusals.push('launch azimuth and achieved inclination disagree by ' +
      Math.abs(plane.deltaDeg).toFixed(1) + ' degrees: the ground track is only a directional approximation');
  }
  for (const disagreement of (profile.disagreements || [])) {
    if (disagreement.resolution === 'unresolved') {
      refusals.push(`sources disagree about ${disagreement.field} and the conflict is unresolved: ` +
        disagreement.values.map(entry => `${entry.value} (${entry.source})`).join(' vs '));
    }
  }
  const base = {
    available: true,
    synthetic,
    profile: { id: profile.id, mission: profile.mission, vehicle: profile.vehicle, stage: profile.stage ?? null,
      synthetic, samplingS: profile.samplingS ?? null },
    evidence: { level: level.level, code: level.code, label: level.label, provenanceKind: profile.evidence.provenanceKind,
      source: profile.evidence.source ?? null, sourceUrl: profile.evidence.sourceUrl ?? null, licence: profile.evidence.licence ?? null },
    schedule: { launchUtc: profile.launch.utc, precision: profile.launch.precision,
      grade: GRADES.schedule[profile.launch.precision],
      basis: profile.evidence.provenanceKind === 'synthetic-fixture' ? 'synthetic fixture' : (profile.evidence.source || 'unknown') },
    observer: { latDeg: observer.latDeg, lonDeg: observer.lonDeg, heightM: observer.heightM || 0 },
    pad: { site: profile.site.pad, azimuthDeg: padSight.azimuthDeg, azimuthCompass: padSight.azimuthCompass,
      elevationDeg: padSight.elevationDeg, slantRangeM: padSight.slantRangeM, aboveHorizon: padSight.aboveHorizon },
    launchAzimuth: profile.azimuth
      ? { deg: profile.azimuth.deg, compass: compass(profile.azimuth.deg), kind: profile.azimuth.kind,
        uncertaintyDeg: profile.azimuth.uncertaintyDeg, source: profile.azimuth.source }
      : null,
    plane,
    confidence: {
      schedule: { grade: GRADES.schedule[profile.launch.precision] },
      geometry: { grade: GRADES.geometry[level.level] },
      observation: { grade: sun ? 'geometric illumination only; optics, weather and the local horizon are unknown'
        : 'not established: no solar geometry was supplied',
        inputs: sun ? ['solar position from the supplied source', 'observer coordinates'] : [] },
    },
    permitted: level.permitted.slice(),
    // What this evidence level is not allowed to produce, straight from the taxonomy so a later
    // caller cannot re-enable a blocked output by accident.
    notProvided: level.blocked.slice(),
    unknown,
    refusals,
  };
  // Gate-derived permissions, when the profile carries gate results. A profile whose gates did not
  // both pass keeps its direction and loses its elevation and timed window, whatever its evidence
  // level would otherwise allow.
  const permissions = publicationPermissions(profile.validation);
  if (permissions) base.permissions = permissions;
  if (level.samplingS === null) return assessWithoutTrack({ ...base, profile: { ...base.profile }, level, refusals, unknown });
  if (permissions && permissions.elevation === false) {
    return assessDirectionOnly({ ...base, permissions }, profile, observer, sun, refusals, launchMs);
  }
  if (level.level === 3) return assessDocumentedProfile(base, profile, observer, level, sun, refusals);
  return assessTimeResolved(base, profile, observer, level, sun, refusals, launchMs, stepS);
}

/* ---- gate-downgraded profiles: direction only --------------------------- */

// A profile whose gates did not both pass. The evidence still supports a direction, and nothing more.
// The reconstruction's own track is deliberately not walked: its altitude and downrange are exactly
// what failed validation, so no bearing-versus-time, no elevation and no timed window may be derived
// from it. The direction comes from the independent evidence instead — a published azimuth, or the
// heading of the catalogued orbital plane at the pad latitude — and it carries its uncertainty and the
// alternate branch with it.
function assessDirectionOnly(base, profile, observer, sun, refusals, launchMs) {
  const permissions = base.permissions;
  const azimuth = profile.azimuth || {};
  const half = Number.isFinite(azimuth.uncertaintyDeg) ? azimuth.uncertaintyDeg : 10;
  const direction = {
    centreDeg: azimuth.deg, compass: compass(azimuth.deg),
    fromDeg: DEG(azimuth.deg - half), toDeg: DEG(azimuth.deg + half), uncertaintyDeg: half,
    kind: azimuth.kind, source: azimuth.source,
    branch: azimuth.branch ?? null,
    alternateDeg: Number.isFinite(azimuth.alternateDeg) ? azimuth.alternateDeg : null,
    alternateCompass: Number.isFinite(azimuth.alternateDeg) ? compass(azimuth.alternateDeg) : null,
    basis: azimuth.kind === 'documented'
      ? 'a published ascent azimuth, with the plane check reported separately'
      : 'the heading of the orbital plane at the pad latitude, derived from the catalogued achieved orbit',
  };
  for (const reason of permissions.reasons) refusals.push('elevation and timed window withheld: ' + reason);
  refusals.push("this reconstruction's own altitude and downrange series is what failed validation, so no " +
    'bearing, elevation or timed window is derived from it');
  const illumination = sun
    ? { available: false, scope: 'observer-only', reason: 'the vehicle position along the track is not validated' }
    : { available: false, reason: 'no solar geometry was supplied' };
  if (sun) {
    const unit = sun.sunUnitEcefAt(launchMs);
    illumination.observerSunElevationDeg = solarElevationDeg(geodeticToEcef(observer.latDeg, observer.lonDeg, observer.heightM || 0), unit);
    illumination.observerTwilight = twilightBand(illumination.observerSunElevationDeg);
  }
  const claims = ['Ascent direction ' + compass(azimuth.deg) + ' (' + azimuth.deg.toFixed(1) +
    ' degrees) plus or minus ' + half.toFixed(1) + ' degrees, from ' + direction.basis + '.'];
  if (direction.alternateDeg !== null) {
    claims.push('The plane reaches that latitude on two headings; the other is ' + compass(direction.alternateDeg) +
      ' (' + direction.alternateDeg.toFixed(1) + ' degrees), and the branch used here is ' + (direction.branch ?? 'unstated') + '.');
  }
  if (Number.isFinite(base.pad.slantRangeM)) {
    claims.push('The launch site lies ' + compass(base.pad.azimuthDeg) + ' at ' + (base.pad.slantRangeM / 1000).toFixed(0) +
      ' km; the ascent direction is not the direction of the launch site.');
  }
  if (Number.isFinite(illumination.observerSunElevationDeg)) {
    claims.push('Your own sky at liftoff: solar elevation ' + illumination.observerSunElevationDeg.toFixed(1) +
      ' degrees (' + illumination.observerTwilight + ').');
  }
  return { ...base,
    geometry: { available: false, samples: [], summary: null, direction,
      reason: 'the profile did not pass both anchoring gates, so only its direction is published' },
    illumination, claims, refusals: refusals.slice(0, REFUSAL_LIMIT) };
}


/* ---- level 4 and 5: no track to walk ------------------------------------ */

function assessWithoutTrack(base) {
  const levelNumber = base.evidence.level;
  const level = evidenceLevel(levelNumber);
  const refusals = base.refusals.slice();
  if (levelNumber === 4) {
    refusals.push('a hazard area or corridor bounds where debris may fall; it is not a flight path, so ' +
      'no elevation, timing or illumination can be derived from it');
  } else {
    refusals.push('with the pad position only there is no flight geometry at all; only the direction of ' +
      'the pad and the sky sector around it can be stated');
  }
  refusals.push('nothing here may be shown as a visibility statement: the production calendar keeps ' +
    'local visibility unknown, and this level cannot change that');
  return { ...base, geometry: { available: false, samples: [], summary: null,
      reason: 'evidence level ' + levelNumber + ' supplies no time-resolved trajectory' },
    illumination: { available: false, reason: 'no vehicle position is known, so no shadow geometry applies' },
    claims: level.permitted.map(item => 'permitted at this level: ' + item),
    refusals: refusals.slice(0, REFUSAL_LIMIT) };
}

/* ---- levels 1 and 2: walk the profile ----------------------------------- */

// Azimuths are unwrapped onto a continuous scale before range arithmetic so a track crossing north
// (359 to 1 degrees) does not report a 358-degree sweep.
export function azimuthRange(values) {
  if (!values.length) return null;
  const unwrapped = [values[0]];
  for (let i = 1; i < values.length; i++) {
    let next = values[i];
    while (next - unwrapped[i - 1] > 180) next -= 360;
    while (next - unwrapped[i - 1] < -180) next += 360;
    unwrapped.push(next);
  }
  const low = Math.min(...unwrapped), high = Math.max(...unwrapped);
  return { fromDeg: DEG(low), toDeg: DEG(high), spanDeg: high - low };
}

export function runsOf(samples, predicate) {
  const runs = [];
  let open = null;
  for (const sample of samples) {
    if (predicate(sample)) { if (!open) open = { fromT: sample.t, toT: sample.t }; else open.toT = sample.t; }
    else if (open) { runs.push(open); open = null; }
  }
  if (open) runs.push(open);
  return runs;
}


function assessTimeResolved(base, profile, observer, level, sun, refusals, launchMs, stepS) {
  const cadence = Number.isFinite(stepS) ? stepS : Math.max(level.samplingS, profile.samplingS || level.samplingS);
  const first = profile.samples[0].t, last = profile.samples[profile.samples.length - 1].t;
  const samples = [], skipped = [];
  for (let t = first; t <= last + 1e-9; t = Math.round((t + cadence) * 1000) / 1000) {
    const state = ascentState(profile, observer, t);
    if (state.ok) samples.push(state); else skipped.push({ t, state: state.state, reason: state.reason });
  }
  if (!samples.some(sample => sample.t === last)) {
    const state = ascentState(profile, observer, last);
    if (state.ok) samples.push(state);
  }
  const observerEcef = geodeticToEcef(observer.latDeg, observer.lonDeg, observer.heightM || 0);
  let illumination = { available: false,
    reason: 'no solar geometry was supplied; the caller must inject a solar source before any illumination claim' };
  if (sun) {
    for (const sample of samples) {
      const unit = sun.sunUnitEcefAt(launchMs + sample.t * 1000);
      sample.shadow = shadowState(sample.ecef, unit).state;
      sample.localSolarElevationDeg = solarElevationDeg(sample.ecef, unit);
      sample.observerSolarElevationDeg = solarElevationDeg(observerEcef, unit);
      sample.observerTwilight = twilightBand(sample.observerSolarElevationDeg);
    }
    const sunlitRuns = runsOf(samples, sample => sample.shadow === 'sunlit');
    const darkAt = run => {
      const sample = samples.find(entry => entry.t >= run.fromT);
      return !!sample && sample.observerTwilight !== 'daylight';
    };
    illumination = {
      available: true,
      observerSunElevationDeg: solarElevationDeg(observerEcef, sun.sunUnitEcefAt(launchMs)),
      observerTwilight: twilightBand(solarElevationDeg(observerEcef, sun.sunUnitEcefAt(launchMs))),
      sunlitRuns,
      penumbraTimes: samples.filter(sample => sample.shadow === 'penumbra').map(sample => sample.t),
      // Two separate facts, deliberately not combined into a chance of seeing anything.
      darkObserverWhileVehicleSunlit: sunlitRuns.filter(darkAt).map(run => ({ fromT: run.fromT, toT: run.toT })),
      method: 'conical Earth-shadow test against the supplied solar direction; refraction of grazing ' +
        'sunlight and cloud are not modelled',
    };
  }
  const above = samples.filter(sample => sample.aboveHorizon);
  const summary = {
    sampledS: cadence, sampleCount: samples.length, refusedSamples: skipped.length,
    aboveHorizon: above.length ? {
      fromT: above[0].t, toT: above[above.length - 1].t,
      azimuth: azimuthRange(above.map(sample => sample.azimuthDeg)),
      maxElevationDeg: Math.max(...above.map(sample => sample.elevationDeg)),
      maxElevationT: above.reduce((best, sample) => sample.elevationDeg > best.elevationDeg ? sample : best).t,
      closestSlantRangeM: Math.min(...above.map(sample => sample.slantRangeM)),
    } : null,
    maxAltitudeM: Math.max(...samples.map(sample => sample.altitudeM)),
    maxDownrangeM: Math.max(...samples.map(sample => sample.downrangeM)),
  };
  return { ...base,
    geometry: { available: true, samples, summary,
      groundTrack: { kind: 'fixed-azimuth great-circle approximation',
        assumption: `downrange is laid off from the pad along ${profile.azimuth.deg.toFixed(1)} degrees`,
        caveat: 'a real ascent yaw-steers, so cross-track position degrades with downrange' } },
    illumination, skipped,
    claims: buildTrackClaims(profile, summary, illumination),
    unknown: base.unknown.concat(['the vehicle position to better than this profile\'s own tolerance',
      'the size and shape of any plume, which these data do not contain']),
    refusals: refusals.slice(0, REFUSAL_LIMIT) };
}

function buildTrackClaims(profile, summary, illumination) {
  const claims = [];
  claims.push(`Ascent azimuth from the pad ${profile.azimuth.deg.toFixed(1)} degrees ` +
    `(${compass(profile.azimuth.deg)}), uncertainty ${profile.azimuth.uncertaintyDeg.toFixed(1)} degrees, ` +
    `source: ${profile.azimuth.kind} from ${profile.azimuth.source}.`);
  if (summary.aboveHorizon) {
    const h = summary.aboveHorizon;
    claims.push(`From this observer the vehicle is above the horizon from T+${h.fromT.toFixed(0)}s to ` +
      `T+${h.toT.toFixed(0)}s, between azimuth ${h.azimuth.fromDeg.toFixed(0)} and ${h.azimuth.toDeg.toFixed(0)} ` +
      `degrees (${compass(h.azimuth.fromDeg)} to ${compass(h.azimuth.toDeg)}), reaching ` +
      `${h.maxElevationDeg.toFixed(1)} degrees elevation at T+${h.maxElevationT.toFixed(0)}s.`);
  } else {
    claims.push("On this reconstruction the whole ascent stays below this observer's horizon.");
  }
  if (illumination.available) {
    claims.push(`Observer solar elevation ${illumination.observerSunElevationDeg.toFixed(1)} degrees at liftoff ` +
      `(${illumination.observerTwilight}).`);
    claims.push(illumination.sunlitRuns.length
      ? 'Vehicle in full sunlight T+' + illumination.sunlitRuns.map(run => `${run.fromT.toFixed(0)}-${run.toT.toFixed(0)}s`).join(', T+') + '.'
      : 'The reconstructed ascent is never in full sunlight over the sampled interval.');
  }
  return claims;
}


/* ---- level 3: published events with an unknown ground position ---------- */
/* A press-kit timeline gives times and altitudes but says nothing about how far downrange the vehicle
   is, and that is exactly the quantity that fixes the bearing and elevation from a distant observer.
   Rather than invent a downrange, every geometrically possible one is swept and the result is reported
   as a range with the sweep stated. Where a conclusion is the same for every swept position the claim
   is strong; where it is not, the split is reported instead of a midpoint. */

export function sensitivityOverDownrange(profile, observer, altitudeM, tSeconds, sun, launchMs, options = {}) {
  const steps = options.steps || 24;
  // Upper bound: the sub-point must remain in line of sight of the launch site for a ground-based
  // record to exist at all. This is a geometric bound, not an assumed flight profile.
  const limitM = options.maxDownrangeM || horizonDistanceM(0, altitudeM);
  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const downrangeM = (limitM * i) / steps;
    const ground = greatCirclePoint(profile.site.latDeg, profile.site.lonDeg, profile.azimuth.deg, downrangeM);
    const ecef = geodeticToEcef(ground.latDeg, ground.lonDeg, altitudeM);
    const sight = look(observer, ecef);
    const row = { downrangeM, latDeg: ground.latDeg, lonDeg: ground.lonDeg, azimuthDeg: sight.azimuthDeg,
      elevationDeg: sight.elevationDeg, slantRangeM: sight.slantRangeM, aboveHorizon: sight.aboveHorizon };
    if (sun) {
      const unit = sun.sunUnitEcefAt(launchMs + tSeconds * 1000);
      row.shadow = shadowState(ecef, unit).state;
      row.localSolarElevationDeg = solarElevationDeg(ecef, unit);
    }
    rows.push(row);
  }
  const elevations = rows.map(row => row.elevationDeg);
  const shadows = rows.map(row => row.shadow);
  return {
    altitudeM, t: tSeconds, downrangeSweepM: [0, limitM], steps,
    azimuth: azimuthRange(rows.map(row => row.azimuthDeg)),
    elevationRangeDeg: [Math.min(...elevations), Math.max(...elevations)],
    aboveHorizonCount: rows.filter(row => row.aboveHorizon).length,
    shadowStates: sun ? Array.from(new Set(shadows)) : null,
    shadowInvariant: sun ? new Set(shadows).size === 1 : null,
    rows,
  };
}

function assessDocumentedProfile(base, profile, observer, level, sun, refusals) {
  const launchMs = Date.parse(profile.launch.utc);
  const events = profile.events || [];
  const rows = events.map(event => ({
    name: event.name, t: event.t, altitudeM: event.altitudeM, source: event.source,
    utc: new Date(launchMs + event.t * 1000).toISOString(),
    sensitivity: sensitivityOverDownrange(profile, observer, event.altitudeM, event.t, sun, launchMs),
  }));
  const claims = [];
  claims.push(`Ascent azimuth from the pad ${profile.azimuth.deg.toFixed(1)} degrees ` +
    `(${compass(profile.azimuth.deg)}), uncertainty ${profile.azimuth.uncertaintyDeg.toFixed(1)} degrees, ` +
    `source: ${profile.azimuth.kind} from ${profile.azimuth.source}.`);
  for (const row of rows) {
    const range = row.sensitivity;
    claims.push(`Published event ${row.name} at T+${row.t.toFixed(0)}s (${row.altitudeM / 1000} km, ` +
      `${row.source}): the direction is within azimuth ${range.azimuth.fromDeg.toFixed(0)}-${range.azimuth.toDeg.toFixed(0)} ` +
      `degrees and elevation ${range.elevationRangeDeg[0].toFixed(1)}-${range.elevationRangeDeg[1].toFixed(1)} degrees, ` +
      'depending on a downrange the source does not publish.');
    if (range.shadowInvariant) {
      claims.push(`  At that altitude the illumination is the same everywhere on the possible track: ${range.shadowStates[0]}.`);
    } else if (sun) {
      claims.push(`  At that altitude the illumination depends on the unpublished downrange: ${range.shadowStates.join('/')}.`);
    }
  }
  refusals.push('a documented mission profile cannot give a bearing or elevation at a chosen instant: the ' +
    'ground position between published events is unknown, so only ranges and sectors are reported');
  const unknown = base.unknown.concat([
    'the downrange at each event, which the published timeline does not contain',
    'any continuous position between the published events',
  ]);
  return { ...base,
    geometry: { available: true, samples: [], events: rows, summary: null,
      groundTrack: { kind: 'fixed-azimuth great-circle approximation',
        assumption: `downrange is laid off from the pad along ${profile.azimuth.deg.toFixed(1)} degrees`,
        caveat: 'a real ascent yaw-steers, so cross-track position degrades with downrange' } },
    illumination: sun ? { available: true, method: 'shadow state swept over the possible downranges at each published altitude' }
      : { available: false, reason: 'no solar geometry was supplied' },
    claims, unknown, refusals: refusals.slice(0, REFUSAL_LIMIT) };
}

/* ---- the presentation contract for the historical explorer -------------- */

// One call that returns exactly what may be shown for one reviewed historical profile from one
// observer, with the historical labelling and the gate permissions already applied. The browser module
// renders this object and adds nothing to it: no number reaches the interface that did not come out of
// an assessment, so the two gate results cannot be contradicted by the presentation layer.
export function exploreHistorical({ profile, observer, sun = null, stepS = null, allowSynthetic = false }) {
  const assessment = assess({ profile, observer, sun, stepS, allowSynthetic });
  const permissions = assessment.permissions || publicationPermissions(profile.validation) || null;
  const elevationPermitted = !!(permissions && permissions.elevation === true);
  const launchMs = Date.parse(profile.launch.utc);
  const out = {
    historical: true,
    notAPrediction: 'A reconstruction of a past flight, not a prediction for this or any future launch.',
    available: assessment.available,
    profile: assessment.profile,
    evidence: assessment.evidence,
    schedule: assessment.schedule,
    observer: assessment.observer,
    pad: assessment.pad,
    launchAzimuth: assessment.launchAzimuth,
    direction: (assessment.geometry && assessment.geometry.direction) || null,
    permissions,
    validation: profile.validation || null,
    orbit: profile.orbit || null,
    provenance: {
      source: profile.evidence.source ?? null, sourceUrl: profile.evidence.sourceUrl ?? null,
      licence: profile.evidence.licence ?? null, retrievedUtc: profile.evidence.retrievedUtc ?? null,
      method: profile.evidence.method ?? null, anchor: profile.orbit ? profile.orbit.source : null,
      anchorUrl: profile.orbit && profile.orbit.sourceUrl ? profile.orbit.sourceUrl : null,
    },
    disagreements: (profile.disagreements || []).map(entry => ({
      field: entry.field, resolution: entry.resolution,
      values: (entry.values || []).map(value => ({ value: value.value, source: value.source })),
      note: entry.note ?? null,
    })),
    limits: (profile.limits || []).slice(),
    series: null, summary: null, illuminationInvariance: null,
    illumination: assessment.illumination,
    permitted: assessment.permitted, notProvided: assessment.notProvided,
    unknown: assessment.unknown, refusals: assessment.refusals, claims: assessment.claims,
  };
  if (elevationPermitted && assessment.geometry && Array.isArray(assessment.geometry.samples)) {
    const trackAzimuth = azimuthRange(assessment.geometry.samples.map(sample => sample.azimuthDeg));
    // The direction of an anchored reconstruction is its own walked track: the full azimuth span the
    // reconstruction covers, bounded by the published uncertainty on the heading it was flown along.
    out.direction = {
      fromDeg: trackAzimuth.fromDeg, toDeg: trackAzimuth.toDeg, spanDeg: trackAzimuth.spanDeg,
      centreDeg: profile.azimuth.deg, compass: compass(profile.azimuth.deg),
      uncertaintyDeg: profile.azimuth.uncertaintyDeg, kind: profile.azimuth.kind,
      source: profile.azimuth.source,
      branch: profile.azimuth.branch ?? null,
      alternateDeg: Number.isFinite(profile.azimuth.alternateDeg) ? profile.azimuth.alternateDeg : null,
      alternateCompass: Number.isFinite(profile.azimuth.alternateDeg) ? compass(profile.azimuth.alternateDeg) : null,
      basis: 'the heading the validated reconstruction was flown along, and the azimuth span it covers',
    };
    out.series = assessment.geometry.samples.map(sample => ({
      t: sample.t, utc: sample.utc, altitudeM: sample.altitudeM, downrangeM: sample.downrangeM,
      azimuthDeg: sample.azimuthDeg, azimuthCompass: sample.azimuthCompass,
      elevationDeg: sample.elevationDeg, slantRangeM: sample.slantRangeM,
      aboveHorizon: sample.aboveHorizon, shadow: sample.shadow ?? null,
      observerTwilight: sample.observerTwilight ?? null,
    }));
    out.summary = assessment.geometry.summary;
    // Vehicle illumination is only ever stated as a bounded fact: whether the whole plausible track at
    // the final sampled altitude shares one shadow state. When it does not, no vehicle-illumination
    // claim is made at all.
    const top = (profile.samples || [])[(profile.samples || []).length - 1];
    if (sun && top) {
      const sweep = sensitivityOverDownrange(profile, observer, top.altitudeM, top.t, sun, launchMs, { steps: 12 });
      out.illuminationInvariance = {
        t: top.t, altitudeM: top.altitudeM, invariant: sweep.shadowInvariant,
        states: sweep.shadowStates, downrangeSweepM: sweep.downrangeSweepM,
        elevationRangeDeg: sweep.elevationRangeDeg,
      };
    }
  }
  return out;
}


