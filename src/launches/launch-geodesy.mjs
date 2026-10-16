/* Observer-facing geodesy for launch geometry (extracted verbatim from launch-trajectory.mjs).

   This file exists so the launch calendar can draw one honest line — the direction of a launch pad from
   the observer — without downloading the whole evidence and validation machinery. It is the *same* code
   the trajectory module uses: that module imports these functions and re-exports them, so there is one
   implementation of every rule here and no second geometry model anywhere in the product.

   Pure computation: no DOM, no storage, no network, no library import, no import from the schedule
   engine or from any other part of the product.

   Time is UTC epoch milliseconds; angles are degrees; azimuth is measured from north through east,
   exactly as overhead-astro.js defines horizontal coordinates. */

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

export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const DEG = v => ((v % 360) + 360) % 360;
// Longitudes are reported signed, the way the launch feed publishes pad longitudes (-120.611),
// while azimuths stay in [0,360) as the astronomy layer defines them.
export const LON = v => ((v + 540) % 360) - 180;

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
// differ by about 2 % at 200 km. It is the analytic reference the tests compare the exact ellipsoidal
// look() against, and it bounds the downrange sweep for a profile without a ground track.
export function horizonDistanceM(observerHeightM, targetHeightM = 0, radiusM = SHADOW.earthRadiusM) {
  const dip = heightM => Math.acos(Math.max(-1, Math.min(1, radiusM / (radiusM + Math.max(0, heightM)))));
  return radiusM * (dip(observerHeightM) + dip(targetHeightM));
}


