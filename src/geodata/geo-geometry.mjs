/* Spherical and planar geometry for geographic evaluation: coordinates, study areas, distances and the
   apparent elevation of a distant point over a curved Earth.

   Everything here is a pure function of its arguments. The sphere is the mean Earth (R = 6 371 008.8 m),
   which is the same approximation every great-circle distance in the product already uses; nothing here
   is a substitute for a projection library, and nothing here claims a precision better than the sphere. */

export const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180, RAD = 180 / Math.PI;

/* A coordinate is normalised, never silently "fixed" into something else: latitude out of range is an
   error (it cannot be wrapped), longitude is wrapped to [-180, 180) because that is unambiguous. */
export function normaliseCoordinate(input) {
  if (!input || typeof input !== 'object') throw new Error('coordinate: expected an object with lat and lon');
  const lat = Number(input.lat), lon = Number(input.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('coordinate: lat and lon must be finite numbers');
  if (lat < -90 || lat > 90) throw new Error('coordinate: latitude ' + lat + ' is outside [-90, 90]');
  let wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180 && lon > 0) wrapped = 180;
  return { lat, lon: wrapped };
}

/* A study area is a bounding box or a polygon ring; both are inclusive, and both handle the antimeridian by
   comparing longitudes as offsets from the box's west edge rather than as numbers. */
export function normaliseStudyArea(area) {
  if (!area || typeof area !== 'object') throw new Error('study area: expected a box or a polygon');
  if (area.type === 'Polygon' && Array.isArray(area.ring) && area.ring.length >= 3) {
    const ring = area.ring.map(normaliseCoordinate);
    return { type: 'Polygon', ring, label: area.label || null };
  }
  const west = Number(area.west), east = Number(area.east), south = Number(area.south), north = Number(area.north);
  if (![west, east, south, north].every(Number.isFinite)) throw new Error('study area: box needs finite west, east, south, north');
  if (south > north) throw new Error('study area: south edge ' + south + ' is north of north edge ' + north);
  if (south < -90 || north > 90) throw new Error('study area: box leaves the globe');
  return { type: 'Box', west, east, south, north, label: area.label || null };
}

export function withinStudyArea(area, point) {
  const { lat, lon } = normaliseCoordinate(point);
  if (area.type === 'Box') {
    if (lat < area.south || lat > area.north) return false;
    const span = ((area.east - area.west) % 360 + 360) % 360 || 360;
    const offset = ((lon - area.west) % 360 + 360) % 360;
    return offset <= span;
  }
  // Ray casting in lon/lat. Adequate for a study area that is small compared with a hemisphere, which is
  // the only kind this module is used for; it is not a geodesic polygon test.
  let inside = false;
  const ring = area.ring;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const crosses = (a.lat > lat) !== (b.lat > lat) &&
      lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function distanceMetres(a, b) {
  const p = normaliseCoordinate(a), q = normaliseCoordinate(b);
  const φ1 = p.lat * DEG, φ2 = q.lat * DEG, dφ = (q.lat - p.lat) * DEG, dλ = (q.lon - p.lon) * DEG;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function initialBearingDeg(a, b) {
  const p = normaliseCoordinate(a), q = normaliseCoordinate(b);
  const φ1 = p.lat * DEG, φ2 = q.lat * DEG, dλ = (q.lon - p.lon) * DEG;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (Math.atan2(y, x) * RAD + 360) % 360;
}

export function destinationPoint(origin, bearingDeg, metres) {
  const p = normaliseCoordinate(origin);
  const δ = metres / EARTH_RADIUS_M, θ = bearingDeg * DEG, φ1 = p.lat * DEG, λ1 = p.lon * DEG;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * sinφ2);
  return normaliseCoordinate({ lat: φ2 * RAD, lon: λ2 * RAD });
}
