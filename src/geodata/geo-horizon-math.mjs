/* Apparent elevation over a curved Earth, and the horizon angle a terrain profile presents.

   Two things are kept carefully apart here:
     * the *geometric* elevation angle of a point at a known height and distance, corrected for curvature
       and standard atmospheric refraction, which is physics and can be computed exactly enough to state;
     * the *terrain horizon*, which is what a bare-earth elevation model says about the ground, and says
       nothing about trees, buildings, fences, crops or vehicles.
   A DEM profile that is low is therefore "no modelled terrain obstruction", never "a clear view". */

import { EARTH_RADIUS_M } from './geo-geometry.mjs';

// Standard refraction coefficient for near-horizon sights: the apparent horizon is lifted by about 13% of
// the curvature drop. This is the value used for horizon and dip calculations, and it is an average — the
// real refraction varies with temperature gradient and can be twice as strong over water at dawn.
export const REFRACTION_COEFFICIENT = 0.13;

export function curvatureDropMetres(distanceM, refraction = REFRACTION_COEFFICIENT) {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new Error('curvature: distance must be a finite, non-negative number');
  if (!Number.isFinite(refraction) || refraction < 0 || refraction > 1) throw new Error('curvature: refraction must be within [0, 1]');
  return (1 - refraction) * distanceM * distanceM / (2 * EARTH_RADIUS_M);
}

/* The angle at which a target at `targetHeightM` above the ellipsoid appears from an observer at
   `observerHeightM`, over `distanceM` of curved, refracting Earth. Positive is above the horizontal. */
export function apparentElevationDeg({ observerHeightM, targetHeightM, distanceM, refraction = REFRACTION_COEFFICIENT }) {
  if (![observerHeightM, targetHeightM, distanceM].every(Number.isFinite)) {
    throw new Error('elevation: observer height, target height and distance must be finite');
  }
  if (distanceM <= 0) throw new Error('elevation: distance must be positive');
  const drop = curvatureDropMetres(distanceM, refraction);
  return Math.atan2(targetHeightM + drop - observerHeightM, distanceM) * 180 / Math.PI;
}

/* The dip of the horizon itself from a height above the ground — the angle below horizontal at which the
   sea horizon (or a perfectly flat plain) sits. Useful as a sanity floor for a computed profile. */
export function horizonDipDeg(observerHeightM, refraction = REFRACTION_COEFFICIENT) {
  if (!Number.isFinite(observerHeightM) || observerHeightM < 0) throw new Error('dip: height must be finite and non-negative');
  return -Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + observerHeightM)) * 180 / Math.PI * (1 - refraction);
}
