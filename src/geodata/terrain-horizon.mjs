/* The terrain horizon: what a bare-earth elevation model says about the ground along a viewing direction,
   and whether the Galactic core clears it.

   What this models: the apparent elevation angle of the highest terrain sample inside the search radius,
   with Earth curvature and standard refraction, from an observer standing `observerHeightM` above the
   modelled ground (eye height for a person, or the camera on a tripod).
   What this does not model: trees, hedgerows, buildings, fences, crops, embankments or vehicles. A low
   terrain profile is therefore reported as "no modelled terrain obstruction", never as a clear view. */

import { destinationPoint } from './geo-geometry.mjs';
import { apparentElevationDeg } from './geo-horizon-math.mjs';

export const HORIZON_DEFAULTS = Object.freeze({
  maxDistanceM: 16000,        // beyond this a 1 m rise is under 0.05 degree; longer rays only add haze
  stepM: 60,                  // sample spacing along each ray
  observerHeightM: 1.6,       // standing eye height; a tripod is lower, a vehicle roof higher
  azimuthCount: 16,           // 22.5 degree spacing, enough to catch a valley wall or a levee
  minimumCoverage: 0.9,       // below this the profile is reported as incomplete, not as clear
});

/* The largest step-to-step elevation change within a couple of samples of the ground that sets the horizon.
   Roughness elsewhere on the ray is real but irrelevant to this angle, and using it would inflate the
   uncertainty of a horizon set by flat ground with a distant bluff in the same direction. */
function roughnessNear(rays, atM, stepM) {
  if (!Number.isFinite(atM) || rays.length < 2) return 0;
  const from = atM - 2 * stepM, to = atM + 2 * stepM;
  let previous = null, roughness = 0;
  for (const sample of rays) {
    if (sample.distanceM < from || sample.distanceM > to) { previous = null; continue; }
    if (previous !== null) roughness = Math.max(roughness, Math.abs(sample.elevationM - previous));
    previous = sample.elevationM;
  }
  return roughness;
}

/* Build a horizon profile. `sampler` is any object with `sample({lat, lon})` returning `{ value, reason }`,
   so a raster, a tile reader or a test fixture all work unchanged. */
export function horizonProfile({ origin, sampler, azimuths = null, maxDistanceM = HORIZON_DEFAULTS.maxDistanceM,
  stepM = HORIZON_DEFAULTS.stepM, eyeHeightM = HORIZON_DEFAULTS.observerHeightM,
  azimuthCount = HORIZON_DEFAULTS.azimuthCount, refraction } = {}) {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) throw new Error('horizon: an origin coordinate is required');
  if (!sampler || typeof sampler.sample !== 'function') throw new Error('horizon: a sampler with sample({lat, lon}) is required');
  if (!(maxDistanceM > 0) || !(stepM > 0)) throw new Error('horizon: maxDistanceM and stepM must be positive');
  if (!(eyeHeightM >= 0)) throw new Error('horizon: eyeHeightM must be non-negative');
  const dirs = azimuths || Array.from({ length: azimuthCount }, (_, i) => i * 360 / azimuthCount);
  const originSample = sampler.sample(origin);
  if (originSample.value === null || !Number.isFinite(originSample.value)) {
    // Without the ground under the observer there is no datum to measure a height above, so nothing here
    // can be computed: refuse rather than assume sea level.
    throw new Error('horizon: no elevation value at the origin, so the observer height above ground is unknown');
  }
  // Heights above the ellipsoid, which is what the elevation model reports: the eye is the ground plus the
  // eye height. Getting this wrong (using the eye height as an absolute elevation) turns every 150 m rise
  // into a 60 degree wall, which is exactly the kind of error a reference test has to catch.
  const observerHeightM = originSample.value + eyeHeightM;
  const results = dirs.map(azimuth => {
    const rays = [];
    let best = { angleDeg: -90, atM: null, elevationM: null };
    let valid = 0, total = 0, gapStart = null, previous = null, roughnessM = 0;
    const gaps = [];
    for (let d = stepM; d <= maxDistanceM; d += stepM) {
      total++;
      const sampled = sampler.sample(destinationPoint(origin, azimuth, d));
      if (sampled.value === null || !Number.isFinite(sampled.value)) {
        if (gapStart === null) gapStart = d;
        continue;
      }
      if (gapStart !== null) { gaps.push([gapStart, d - stepM]); gapStart = null; }
      valid++;
      if (previous !== null) roughnessM = Math.max(roughnessM, Math.abs(sampled.value - previous));
      previous = sampled.value;
      const angle = apparentElevationDeg({ observerHeightM, targetHeightM: sampled.value, distanceM: d, refraction });
      if (angle > best.angleDeg) best = { angleDeg: angle, atM: d, elevationM: sampled.value };
      rays.push({ distanceM: d, elevationM: sampled.value, angleDeg: angle });
    }
    if (gapStart !== null) gaps.push([gapStart, maxDistanceM]);
    const coverage = total ? valid / total : 0;
    return { azimuthDeg: azimuth, coverage, gaps, samples: total,
      groundElevationM: originSample.value === null ? null : originSample.value,
      maxAngleDeg: best.angleDeg, maxAtM: best.atM, maxElevationM: best.elevationM,
      status: coverage === 0 ? 'no-data' : coverage < HORIZON_DEFAULTS.minimumCoverage ? 'partial' : 'ok',
      roughnessM: roughnessNear(rays, best.atM, stepM), ray: rays };
  });
  return { origin: { lat: origin.lat, lon: origin.lon }, eyeHeightM, observerHeightM,
    groundElevationM: originSample.value, maxDistanceM, stepM, azimuths: results };
}

/* How uncertain a horizon angle is, in degrees.

   Two height terms over the distance of the terrain that sets the angle: twice the elevation model's
   vertical RMSE (a ridge is an upper envelope of noisy samples) and half the *measured* step-to-step rise
   along the ray, which is the data's own proxy for what could hide between two samples. The proxy is
   stated as a proxy: a spike narrower than one sample distance is not detectable and not bounded here.
   The result has a small floor, and it is meant to be read as "not a survey", never as a tolerance. */
export function horizonUncertaintyDeg({ verticalRmseM = 1.55, distanceM, roughnessM = 0 }) {
  if (![verticalRmseM, distanceM, roughnessM].every(Number.isFinite)) throw new Error('uncertainty: all inputs must be finite');
  if (distanceM <= 0) throw new Error('uncertainty: distance must be positive');
  const heightM = verticalRmseM * 2 + Math.max(0, roughnessM) / 2;
  return Math.max(0.5, Math.atan2(heightM, distanceM) * 180 / Math.PI);
}

/* The horizon a viewer at `azimuthDeg` actually faces, interpolated between the two neighbouring profile
   azimuths. Interpolating by angle is right when the profile is smooth, which is when this method is any
   good at all; a knife-edge ridge between two samples is exactly the case the uncertainty covers. */
export function horizonAtAzimuth(profile, azimuthDeg) {
  const list = profile.azimuths.slice().sort((a, b) => a.azimuthDeg - b.azimuthDeg);
  if (!list.length) throw new Error('horizon: empty profile');
  const target = ((azimuthDeg % 360) + 360) % 360;
  let lower = list[list.length - 1], upper = null;
  for (const entry of list) {
    if (entry.azimuthDeg <= target) lower = entry;
    if (entry.azimuthDeg >= target) { upper = entry; break; }
  }
  if (!upper) upper = list[0];
  const span = ((upper.azimuthDeg - lower.azimuthDeg) % 360 + 360) % 360 || 360;
  const offset = ((target - lower.azimuthDeg) % 360 + 360) % 360;
  const weight = span ? offset / span : 0;
  const angle = lower.maxAngleDeg + (upper.maxAngleDeg - lower.maxAngleDeg) * weight;
  const coverage = Math.min(lower.coverage, upper.coverage);
  const status = lower.status === 'ok' && upper.status === 'ok' ? 'ok' : coverage === 0 ? 'no-data' : 'partial';
  const control = lower.maxAngleDeg >= upper.maxAngleDeg ? lower : upper;
  return { azimuthDeg: target, horizonAngleDeg: angle, coverage, status, atM: control.maxAtM,
    roughnessM: Math.max(lower.roughnessM || 0, upper.roughnessM || 0),
    betweenAzimuths: [lower.azimuthDeg, upper.azimuthDeg] };
}

/* Does the core clear the modelled terrain horizon? `marginDeg` is the clearance we insist on before
   calling it clear, so a 0.4 degree margin against a 0.6 degree uncertainty is reported as unknown. */
export function clearanceFor(profile, { azimuthDeg, altitudeDeg, marginDeg = 2, uncertaintyDeg = null }) {
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(altitudeDeg)) throw new Error('clearance: azimuth and altitude are required');
  const horizon = horizonAtAzimuth(profile, azimuthDeg);
  const effectiveMargin = Math.max(marginDeg, Number.isFinite(uncertaintyDeg) ? uncertaintyDeg : 0);
  if (horizon.status === 'no-data') {
    return { status: 'unknown', reason: 'no elevation coverage in this direction', horizon, marginDeg: effectiveMargin };
  }
  if (horizon.status === 'partial') {
    return { status: 'unknown', reason: 'elevation coverage is incomplete in this direction (' +
      Math.round(horizon.coverage * 100) + '% of the ray)', horizon, marginDeg: effectiveMargin };
  }
  const difference = altitudeDeg - horizon.horizonAngleDeg;
  if (difference > effectiveMargin) return { status: 'clear', differenceDeg: difference, horizon, marginDeg: effectiveMargin };
  if (difference < -effectiveMargin) return { status: 'obstructed', differenceDeg: difference, horizon, marginDeg: effectiveMargin };
  return { status: 'unknown', differenceDeg: difference,
    reason: 'the difference is inside the stated uncertainty (' + difference.toFixed(1) +
      ' degrees, margin ' + effectiveMargin.toFixed(1) + ')', horizon, marginDeg: effectiveMargin };
}
