/* Geographic geometry and the terrain horizon, against analytic references and a real 3DEP extract.

   Every number here is either exact by construction (a plane, a single ridge, a known great-circle pair) or
   reproduced from the committed fixture, which is a genuine USGS extract. Nothing fetches the network, so the
   suite runs with the same result offline and in CI. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); }
  catch (error) { failures++; console.log('FAIL ' + name + '\n     ' + String(error && error.message || error)); } };

(async () => {
  const geo = await import('../src/geodata/geo-geometry.mjs');
  const horizonMath = await import('../src/geodata/geo-horizon-math.mjs');
  const raster = await import('../src/geodata/geo-raster.mjs');
  const terrain = await import('../src/geodata/terrain-horizon.mjs');

  test('coordinates are normalised, and an impossible latitude is refused rather than wrapped', () => {
    assert.deepStrictEqual(geo.normaliseCoordinate({ lat: 38.3, lon: -87.5 }), { lat: 38.3, lon: -87.5 });
    assert.strictEqual(geo.normaliseCoordinate({ lat: 0, lon: 190 }).lon, -170);
    assert.strictEqual(geo.normaliseCoordinate({ lat: 0, lon: -180 }).lon, -180);
    assert.throws(() => geo.normaliseCoordinate({ lat: 91, lon: 0 }), /outside/);
    assert.throws(() => geo.normaliseCoordinate({ lat: 'x', lon: 0 }), /finite/);
    assert.throws(() => geo.normaliseCoordinate(null), /object/);
  });

  test('a study area is a box or a polygon, and both cross the antimeridian correctly', () => {
    const box = geo.normaliseStudyArea({ west: 179, east: -179, south: -10, north: 10 });
    assert.ok(geo.withinStudyArea(box, { lat: 0, lon: 180 }));
    assert.ok(geo.withinStudyArea(box, { lat: 0, lon: -179.5 }));
    assert.ok(!geo.withinStudyArea(box, { lat: 0, lon: 170 }));
    assert.throws(() => geo.normaliseStudyArea({ west: 0, east: 1, south: 10, north: -10 }), /south edge/);
    const triangle = geo.normaliseStudyArea({ type: 'Polygon', ring: [
      { lat: 0, lon: 0 }, { lat: 0, lon: 2 }, { lat: 2, lon: 0 }] });
    assert.ok(geo.withinStudyArea(triangle, { lat: 0.4, lon: 0.4 }));
    assert.ok(!geo.withinStudyArea(triangle, { lat: 1.8, lon: 1.8 }));
  });

  test('great-circle distance agrees with a different formula, and the bearing round-trips', () => {
    const princeton = { lat: 38.3553, lon: -87.5675 };
    const capeTown = { lat: -33.9249, lon: 18.4241 };
    const haversine = geo.distanceMetres(princeton, capeTown);
    // Spherical law of cosines, computed independently here.
    const rad = Math.PI / 180;
    const cosine = Math.sin(princeton.lat * rad) * Math.sin(capeTown.lat * rad) +
      Math.cos(princeton.lat * rad) * Math.cos(capeTown.lat * rad) * Math.cos((capeTown.lon - princeton.lon) * rad);
    const reference = 6371008.8 * Math.acos(cosine);
    assert.ok(Math.abs(haversine - reference) < reference * 0.001, 'within 0.1%: ' + haversine + ' vs ' + reference);
    assert.ok(Math.abs(haversine / 1000 - 13530) < 40, 'about 13 530 km: ' + (haversine / 1000).toFixed(0));
    const going = geo.destinationPoint(princeton, 45, 10000);
    assert.ok(Math.abs(geo.distanceMetres(princeton, going) - 10000) < 1, 'round-trip distance within a metre');
    assert.ok(Math.abs(geo.initialBearingDeg(princeton, going) - 45) < 0.5, 'bearing preserved');
    assert.ok(Math.abs(geo.distanceMetres(princeton, { lat: 38.3653, lon: -87.5675 }) - 1112) < 5, 'one hundredth of a degree of latitude is about 1.11 km');
  });

  test('curvature, apparent elevation and horizon dip match their analytic values', () => {
    assert.ok(Math.abs(horizonMath.curvatureDropMetres(1000) - 0.87 * 1e6 / (2 * 6371008.8)) < 1e-9);
    // A target at sea level seen from 2 m up at one kilometre is below the horizontal by about 0.11 degrees.
    const angle = horizonMath.apparentElevationDeg({ observerHeightM: 2, targetHeightM: 0, distanceM: 1000 });
    assert.ok(Math.abs(angle - (-0.1106)) < 0.01, 'got ' + angle.toFixed(4));
    // 50 m above the observer at 500 m is atan(48.4/500) = 5.53 degrees, plus a thousandth from curvature.
    const ridge = horizonMath.apparentElevationDeg({ observerHeightM: 1.6, targetHeightM: 51.6, distanceM: 500 });
    assert.ok(Math.abs(ridge - 5.72) < 0.03, 'atan(50/500) plus curvature: ' + ridge.toFixed(3));
    assert.ok(Math.abs(horizonMath.horizonDipDeg(1.6)) < 0.05, 'dip from eye height is a few hundredths of a degree');
    assert.throws(() => horizonMath.apparentElevationDeg({ observerHeightM: 1, targetHeightM: 0, distanceM: 0 }), /positive/);
  });

  test('a raster refuses inconsistency and never turns missing data into zero', () => {
    const grid = raster.makeRaster({ width: 2, height: 2, values: [1, 2, 3, 4], bbox: [0, 0, 2, 2] });
    assert.strictEqual(raster.sampleRaster(grid, { lat: 1.5, lon: 0.5 }).value, 1);
    assert.strictEqual(raster.sampleRaster(grid, { lat: 1, lon: 1 }).value, 2.5, 'bilinear centre of four corners');
    assert.strictEqual(raster.sampleRaster(grid, { lat: 1, lon: 5 }).reason, 'outside-coverage');
    assert.throws(() => raster.makeRaster({ width: 2, height: 2, values: [1, 2], bbox: [0, 0, 2, 2] }), /expected 4/);
    assert.throws(() => raster.makeRaster({ width: 2, height: 2, values: [1, 2, 3, 4], bbox: [2, 2, 0, 0] }), /empty/);
    const holed = raster.makeRaster({ width: 2, height: 2, values: [1, NaN, 3, 4], bbox: [0, 0, 2, 2] });
    const sample = raster.sampleRaster(holed, { lat: 1.5, lon: 0.5 });
    assert.strictEqual(sample.value, null, 'a hole is missing, not zero');
    assert.strictEqual(sample.reason, 'nodata');
  });

  // A constant-elevation surface: the horizon angle is then exactly the geometry of a plane, and a single
  // raised row is exactly one ridge. These are the cases where the answer can be written down by hand.
  const planeSampler = (elevation, ridge) => ({
    sample: (point) => {
      if (ridge && Math.abs(point.lat - ridge.lat) < ridge.halfLat) return { value: elevation + ridge.heightM };
      return { value: elevation };
    },
  });

  test('flat ground gives a horizon below the horizontal, and a ridge gives its analytic angle', () => {
    const flat = terrain.horizonProfile({ origin: { lat: 38, lon: -87 }, sampler: planeSampler(150),
      azimuths: [0, 90, 180, 270], maxDistanceM: 4000, stepM: 60, eyeHeightM: 1.6 });
    for (const entry of flat.azimuths) {
      assert.ok(entry.maxAngleDeg < 0, 'a flat plain sits below the horizontal: ' + entry.maxAngleDeg.toFixed(2));
      assert.ok(entry.maxAngleDeg > -2, 'and not far below it at eye height');
      assert.strictEqual(entry.coverage, 1);
      assert.strictEqual(entry.status, 'ok');
      assert.strictEqual(entry.groundElevationM, 150);
    }
    // One ridge 500 m to the north, 50 m above the observer's ground.
    const ridge = terrain.horizonProfile({ origin: { lat: 38, lon: -87 },
      sampler: planeSampler(150, { lat: 38 + 500 / 111320, halfLat: 0.0004, heightM: 50 }),
      azimuths: [0, 180], maxDistanceM: 4000, stepM: 20, eyeHeightM: 1.6 });
    const north = ridge.azimuths.find(entry => entry.azimuthDeg === 0);
    const south = ridge.azimuths.find(entry => entry.azimuthDeg === 180);
    assert.ok(north.maxAngleDeg > 5.7 && north.maxAngleDeg < 6.3, 'the ridge is about six degrees: ' + north.maxAngleDeg.toFixed(2));
    assert.ok(north.maxAtM >= 460 && north.maxAtM <= 540, 'found at about 500 m: ' + north.maxAtM);
    assert.strictEqual(north.maxElevationM, 200);
    assert.ok(south.maxAngleDeg < 0, 'and the opposite direction is unchanged');
  });

  test('the observer height is measured above the ground, not above the sea', () => {
    // A 1 000 m plateau with a 1.6 m eye: the horizon must be the same as at sea level, because only the
    // height above the ground matters. Getting this wrong turns every plateau into a wall.
    const high = terrain.horizonProfile({ origin: { lat: 38, lon: -87 }, sampler: planeSampler(1000),
      azimuths: [90], maxDistanceM: 2000, stepM: 100, eyeHeightM: 1.6 });
    const entry = high.azimuths[0];
    assert.strictEqual(high.observerHeightM, 1001.6);
    assert.ok(entry.maxAngleDeg > -2 && entry.maxAngleDeg < 0, 'plateau horizon ' + entry.maxAngleDeg.toFixed(2));
    // And a taller eye height lifts the horizon a little, monotonically.
    const tall = terrain.horizonProfile({ origin: { lat: 38, lon: -87 }, sampler: planeSampler(1000),
      azimuths: [90], maxDistanceM: 2000, stepM: 100, eyeHeightM: 6 });
    assert.ok(tall.azimuths[0].maxAngleDeg < entry.maxAngleDeg, 'a higher eye stands further above the near ground, so its maximum is lower');
  });

  test('missing elevation is reported as missing, and never as a clear horizon', () => {
    const holed = { sample: (point) => (point.lon > -86.99 ? { value: null, reason: 'nodata' } : { value: 140 }) };
    const profile = terrain.horizonProfile({ origin: { lat: 38, lon: -87 }, sampler: holed,
      azimuths: [90], maxDistanceM: 4000, stepM: 100, eyeHeightM: 1.6 });
    const entry = profile.azimuths[0];
    assert.ok(entry.coverage < 1, 'coverage below one: ' + entry.coverage);
    assert.strictEqual(entry.status, 'partial');
    const clearance = terrain.clearanceFor(profile, { azimuthDeg: 90, altitudeDeg: 25 });
    assert.strictEqual(clearance.status, 'unknown', 'incomplete coverage cannot be called clear');
    assert.match(clearance.reason, /incomplete/);
    // An origin with no elevation at all is refused, because there is no datum for the eye height.
    assert.throws(() => terrain.horizonProfile({ origin: { lat: 38, lon: -87 },
      sampler: { sample: () => ({ value: null, reason: 'nodata' }) }, azimuths: [0] }), /no elevation value at the origin/);
  });

  test('clearance distinguishes clear, blocked and inside-the-uncertainty', () => {
    const sampler = planeSampler(150, { lat: 38 + 2000 / 111320, halfLat: 0.0004, heightM: 120 });
    const profile = terrain.horizonProfile({ origin: { lat: 38, lon: -87 }, sampler,
      azimuths: [0], maxDistanceM: 6000, stepM: 50, eyeHeightM: 1.6 });
    const horizonAngle = profile.azimuths[0].maxAngleDeg;
    assert.ok(horizonAngle > 3, 'the ridge is about 3.4 degrees: ' + horizonAngle.toFixed(2));
    assert.strictEqual(terrain.clearanceFor(profile, { azimuthDeg: 0, altitudeDeg: 25, uncertaintyDeg: 1 }).status, 'clear');
    assert.strictEqual(terrain.clearanceFor(profile, { azimuthDeg: 0, altitudeDeg: 1, uncertaintyDeg: 1 }).status, 'obstructed');
    const marginal = terrain.clearanceFor(profile, { azimuthDeg: 0,
      altitudeDeg: horizonAngle + 0.4, uncertaintyDeg: 1 });
    assert.strictEqual(marginal.status, 'unknown', 'inside the margin is not a clear view');
    assert.match(marginal.reason, /uncertainty/);
    // The default margin is not zero: nothing is called clear at the boundary.
    assert.strictEqual(terrain.clearanceFor(profile, { azimuthDeg: 0, altitudeDeg: horizonAngle + 0.5 }).status, 'unknown');
  });

  test('uncertainty grows for close obstructions and shrinks with distance and quality', () => {
    const near = terrain.horizonUncertaintyDeg({ distanceM: 200, roughnessM: 2 });
    const far = terrain.horizonUncertaintyDeg({ distanceM: 4000, roughnessM: 2 });
    assert.ok(near > far, 'close terrain is less certain: ' + near.toFixed(2) + ' vs ' + far.toFixed(2));
    assert.ok(terrain.horizonUncertaintyDeg({ distanceM: 500, roughnessM: 8 }) >
      terrain.horizonUncertaintyDeg({ distanceM: 500, roughnessM: 2 }), 'rougher ground is less certain where the angle is set');
    assert.ok(terrain.horizonUncertaintyDeg({ distanceM: 100000, roughnessM: 0 }) >= 0.5, 'there is a floor');
    assert.throws(() => terrain.horizonUncertaintyDeg({ distanceM: 0 }), /positive/);
  });

  test('the azimuth between two profile directions is interpolated, and a hole stays a hole', () => {
    const profile = { azimuths: [
      { azimuthDeg: 0, maxAngleDeg: 2, coverage: 1, status: 'ok', maxAtM: 500, roughnessM: 1 },
      { azimuthDeg: 90, maxAngleDeg: 6, coverage: 1, status: 'ok', maxAtM: 300, roughnessM: 2 },
      { azimuthDeg: 180, maxAngleDeg: 0, coverage: 0, status: 'no-data', maxAtM: null, roughnessM: 0 },
      { azimuthDeg: 270, maxAngleDeg: 4, coverage: 1, status: 'ok', maxAtM: 700, roughnessM: 1 }] };
    assert.ok(Math.abs(terrain.horizonAtAzimuth(profile, 45).horizonAngleDeg - 4) < 1e-9);
    assert.ok(Math.abs(terrain.horizonAtAzimuth(profile, 315).horizonAngleDeg - 3) < 1e-9, 'wraps through 360');
    assert.strictEqual(terrain.horizonAtAzimuth(profile, 180).status, 'no-data');
    assert.strictEqual(terrain.clearanceFor(profile, { azimuthDeg: 180, altitudeDeg: 30 }).status, 'unknown');
  });

  test('the committed fixture is real 3DEP data, and the pipeline reproduces its profile', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research', 'geodata', 'fixtures',
      'shawnee-ridge-dem.json'), 'utf8'));
    assert.strictEqual(fixture.source, 'usgs-3dep');
    assert.strictEqual(fixture.values.length, fixture.width * fixture.height);
    const finite = fixture.values.filter(value => value !== null);
    assert.ok(finite.length > fixture.values.length * 0.95, 'the extract is essentially complete');
    assert.ok(Math.max(...finite) - Math.min(...finite) > 100, 'and it has real relief: ' +
      (Math.max(...finite) - Math.min(...finite)) + ' m');
    const grid = raster.makeRaster({ width: fixture.width, height: fixture.height,
      values: Float64Array.from(fixture.values, value => value === null ? NaN : value),
      bbox: fixture.bbox, source: 'usgs-3dep', units: 'm', resolutionM: 70 });
    // A point inside the extract, chosen at the highest ground so the fixture exercises relief.
    let highest = 0, index = 0;
    for (let i = 0; i < fixture.values.length; i++) {
      if (Number.isFinite(fixture.values[i]) && fixture.values[i] > highest) { highest = fixture.values[i]; index = i; }
    }
    const lat = fixture.bbox[3] - (Math.floor(index / fixture.width) + 0.5) * (fixture.bbox[3] - fixture.bbox[1]) / fixture.height;
    const lon = fixture.bbox[0] + ((index % fixture.width) + 0.5) * (fixture.bbox[2] - fixture.bbox[0]) / fixture.width;
    const origin = { lat, lon };
    const profile = terrain.horizonProfile({ origin, sampler: raster.rasterSampler(grid),
      azimuths: Array.from({ length: 16 }, (_, i) => i * 22.5), maxDistanceM: 4000, stepM: 60, eyeHeightM: 1.6 });
    assert.strictEqual(profile.groundElevationM, highest, 'the origin should be the highest cell');
    const angles = profile.azimuths.map(entry => entry.maxAngleDeg);
    assert.ok(Math.max(...angles) < 5, 'a ridge 71 m above a valley is a few degrees at most: ' + Math.max(...angles).toFixed(2));
    assert.ok(Math.min(...angles) < 0, 'some directions look downhill');
    // Same input, same output: the profile is deterministic.
    const again = terrain.horizonProfile({ origin, sampler: raster.rasterSampler(grid),
      azimuths: Array.from({ length: 16 }, (_, i) => i * 22.5), maxDistanceM: 4000, stepM: 60, eyeHeightM: 1.6 });
    assert.deepStrictEqual(again.azimuths.map(entry => entry.maxAngleDeg), angles);
  });

  test('arguments that would silently produce nonsense are refused', () => {
    const sampler = { sample: () => ({ value: 100 }) };
    assert.throws(() => terrain.horizonProfile({ origin: { lat: 38, lon: -87 } }), /sampler/);
    assert.throws(() => terrain.horizonProfile({ origin: null, sampler }), /origin/);
    assert.throws(() => terrain.horizonProfile({ origin: { lat: 38, lon: -87 }, sampler, stepM: 0 }), /positive/);
    assert.throws(() => terrain.clearanceFor({ azimuths: [] }, { azimuthDeg: 0, altitudeDeg: 10 }), /empty profile/);
    assert.throws(() => terrain.clearanceFor({ azimuths: [] }, { azimuthDeg: 0 }), /azimuth and altitude/);
  });

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all geometry and terrain checks passed');
})();
