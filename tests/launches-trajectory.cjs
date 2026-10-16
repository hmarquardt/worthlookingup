/* Launch-ascent geometry prototype: deterministic tests and reference cases.
   Run: node tests/launches-trajectory.cjs
   Every mathematical claim the prototype makes is either compared with a closed-form analytical case
   or with the independent implementation already pinned in vendor/overhead (Astronomy Engine 2.1.19,
   reached through overhead-astro.js for solar position). The historical section compares the geometry
   against observations and achieved orbits published by third parties, and the worst measured
   differences are printed rather than hidden behind loose bounds. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.Astronomy = require(path.resolve('vendor/overhead/astronomy-2.1.19.min.js'));
const astro = require(path.resolve('overhead-astro.js'));
const AE = globalThis.Astronomy;
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/launches/trajectory-cases.json'), 'utf8'));
const generated = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/launches/trajectory-profiles.json'), 'utf8'));
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const wrap180 = value => ((value + 540) % 360) - 180;
const AU_M = 1.495978707e11;
const measured = {};

// Tolerances. Each one is justified beside the case it applies to and none is loosened to make a
// failing case pass: the printed worst values are the evidence that drift would be visible.
const TOL = Object.freeze({
  geodeticRoundTripM: 1e-3,      // fixed-point inverse of an exact WGS-84 forward transform
  libraryCoordinatesM: 2.0,      // my WGS-84 ECEF against Astronomy Engine's own observer vector
  librarySolarDeg: 0.30,         // my Earth-fixed solar elevation against overhead-astro sunAltitude
  closedFormDeg: 1e-6,           // axis-aligned and antimeridian cases that have an exact answer
  curvatureMinimumDeg: 2.5,      // flat trigonometry must be visibly wrong at 600 km downrange
  horizonRangeRelative: 0.02,    // ellipsoidal look() against the closed-form horizon distance
  shadowBoundaryDeg: 0.5,        // conical shadow edge against the dip-angle formula
  eventTimeS: 3,                 // reconstruction event times against the published timeline
  altitudeRelative: 0.20,        // reconstruction altitude against the published timeline figure
  reportRangeRelative: 0.08,     // documented range, quoted to a tenth of a mile at best
  orbitSpeedRelative: 0.03,      // reconstruction terminal speed against vis-viva, best case
});

let module_;
const load = (async () => { module_ = await import('../src/launches/launch-trajectory.mjs'); })();

// The solar source is injected: overhead-astro owns the Sun's position and sidereal time, and this
// prototype only borrows the resulting Earth-fixed direction.
const sun = {
  sunUnitEcefAt: milliseconds => {
    const equatorial = astro.geometricEquatorial('Sun', milliseconds);
    return module_.sunUnitEcef(equatorial.raDeg, equatorial.decDeg,
      AE.SiderealTime(AE.MakeTime(new Date(milliseconds))));
  },
  solarElevationAt: (milliseconds, latDeg, lonDeg) => astro.sunAltitude(milliseconds, { lat: latDeg, lon: lonDeg }),
};

// A recursive key scan used to assert that no assessment ever carries a claim this phase forbids.
function claimKeys(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    found.push(key.toLowerCase());
    claimKeys(child, found);
  }
  return found;
}

(async () => {
  await load;
  const M = module_;
  const originObserver = { latDeg: 0, lonDeg: 0, heightM: 0 };

  /* ---- 1. fixtures are internally honest -------------------------------- */
  assert.equal(cases.schema, 'worthlookingup.trajectory-fixtures/1');
  assert.equal(generated.schema, 'worthlookingup.trajectory-fixtures/1');
  assert.equal(generated.generated_by, 'scripts/build-trajectory-fixtures.mjs');
  assert.match(generated.source.licence, /public domain/i);
  for (const profile of [...cases.synthetic_profiles, ...cases.documented_profiles,
    ...cases.corridor_profiles, ...cases.pad_only_profiles, ...generated.profiles]) {
    const result = M.validateProfile(profile);
    assert.equal(result.ok, true, `${profile.id} must validate: ${result.errors.join('; ')}`);
  }
  // Nothing generated may claim a trajectory stronger than the evidence allows.
  for (const profile of generated.profiles) {
    assert.equal(profile.evidence.level, 2, 'webcast reconstructions are level 2, never level 1');
    assert.equal(profile.evidence.provenanceKind, 'webcast-telemetry-reconstruction');
    assert.ok(profile.limits.some(limit => /not independently validated/.test(limit)),
      'a reconstruction must state that its absolute values are unvalidated');
  }
  const saocom = generated.profiles.find(p => p.id === 'saocom-1a-2018-076');
  const iridium = generated.profiles.find(p => p.id === 'iridium-next-4-2017-083');
  const falconHeavy = generated.profiles.find(p => p.id === 'falcon-heavy-demo-1-2018-017');

  /* ---- 2. geodetic conversion ------------------------------------------- */
  for (const point of [{ latDeg: 34.632, lonDeg: -120.611, heightM: 0 },
    { latDeg: 0, lonDeg: -179.999, heightM: 0 }, { latDeg: -77.85, lonDeg: 166.7, heightM: 120 },
    { latDeg: 28.608, lonDeg: -80.604, heightM: 3 }]) {
    const back = M.ecefToGeodetic(M.geodeticToEcef(point.latDeg, point.lonDeg, point.heightM));
    assert.ok(Math.abs(back.latDeg - point.latDeg) < 1e-6, 'latitude round trip ' + point.latDeg);
    assert.ok(Math.abs(wrap180(back.lonDeg - point.lonDeg)) < 1e-6, 'longitude round trip ' + point.lonDeg);
    assert.ok(Math.abs(back.heightM - point.heightM) < TOL.geodeticRoundTripM, 'height round trip');
  }
  // Independent reference: Astronomy Engine's own Earth-fixed observer vector for the same instant.
  const epoch = Date.parse('2018-10-08T02:22:40Z');
  const epochTime = AE.MakeTime(new Date(epoch));
  const sidereal = AE.SiderealTime(epochTime) * 15 * D2R;
  const rotateToInertial = (v, theta) => ({ x: v.x * Math.cos(theta) - v.y * Math.sin(theta),
    y: v.x * Math.sin(theta) + v.y * Math.cos(theta), z: v.z });
  for (const observer of [{ latDeg: 34.17145, lonDeg: -118.51161, heightM: 250 },
    { latDeg: -33.8688, lonDeg: 151.2093, heightM: 58 }]) {
    const mine = M.geodeticToEcef(observer.latDeg, observer.lonDeg, observer.heightM);
    const theirs = rotateToInertial(mine, sidereal);
    const reference = AE.ObserverVector(epochTime,
      new AE.Observer(observer.latDeg, observer.lonDeg, observer.heightM), true);
    const deltaM = Math.hypot(theirs.x - reference.x * AU_M, theirs.y - reference.y * AU_M, theirs.z - reference.z * AU_M);
    measured.libraryCoordinatesM = Math.max(measured.libraryCoordinatesM || 0, deltaM);
    assert.ok(deltaM <= TOL.libraryCoordinatesM,
      `WGS-84 position differs from the pinned library by ${deltaM.toFixed(2)} m at ${observer.latDeg}`);
  }
  assert.throws(() => M.geodeticToEcef(NaN, 0), /finite/, 'non-finite input must be refused');


  /* ---- 3. observer azimuth and elevation, closed-form cases -------------- */
  const eastLook = M.look(originObserver, M.geodeticToEcef(0, 1, 0));
  assert.ok(Math.abs(eastLook.azimuthDeg - 90) < 1e-6, 'due-east azimuth');
  // Closed form on a sphere: two points at the same height a central angle apart see each other half
  // that angle below the local horizontal, so a co-altitude point one degree away is 0.5 degrees down.
  assert.ok(Math.abs(eastLook.elevationDeg + 0.5) < 0.01,
    `a co-altitude point one degree away must lie half a degree below the horizon, got ${eastLook.elevationDeg.toFixed(4)}`);
  assert.equal(eastLook.aboveHorizon, false, 'a co-altitude point is not above the horizon');
  assert.ok(Math.abs(M.look(originObserver, M.geodeticToEcef(1, 0, 0)).azimuthDeg) < 1e-6, 'due-north azimuth');
  assert.ok(Math.abs(wrap180(M.look(originObserver, M.geodeticToEcef(0, -1, 0)).azimuthDeg - 270)) < 1e-6, 'due-west azimuth');
  assert.ok(M.look(originObserver, M.geodeticToEcef(0, 0, 5000)).elevationDeg > 89.9, 'a point 5 km overhead');
  // A moving vehicle: elevation must be the angle above the observer's own horizontal plane.
  const eastward = cases.synthetic_profiles.find(p => p.id === 'synthetic-eastward');
  const moving = M.ascentState(eastward, originObserver, 300);
  const basis = M.enuBasis(originObserver.latDeg, originObserver.lonDeg);
  const fromPad = M.geodeticToEcef(0, 0, 0);
  const offset = { x: moving.ecef.x - fromPad.x, y: moving.ecef.y - fromPad.y, z: moving.ecef.z - fromPad.z };
  const upComponent = offset.x * basis.up.x + offset.y * basis.up.y + offset.z * basis.up.z;
  assert.ok(Math.abs(Math.asin(upComponent / moving.slantRangeM) * R2D - moving.elevationDeg) < 1e-9,
    'elevation must be the enclosed angle above the local horizontal plane');
  assert.ok(moving.aboveHorizon && moving.elevationDeg > 15,
    `a vehicle 250 km up and 600 km downrange must be well above the horizon, got ${moving.elevationDeg.toFixed(2)}`);
  assert.ok(Math.abs(wrap180(moving.azimuthDeg - 90)) < 1, 'an eastward ascent seen from the pad lies due east');
  assert.equal(M.ascentState(eastward, originObserver, 0).elevationDeg, 90, 'a vehicle still on the pad is overhead');

  /* ---- 4. below-horizon objects ----------------------------------------- */
  const antipodal = M.look(originObserver, M.geodeticToEcef(0, 180, 200000));
  assert.ok(antipodal.elevationDeg < -80, 'a point on the far side of the Earth is far below the horizon');
  assert.equal(antipodal.aboveHorizon, false);
  assert.ok(M.look(originObserver, M.geodeticToEcef(0, 90, 2000)).elevationDeg < -20,
    'a 2 km point a quarter of the way around the Earth is below the horizon');
  // Vertical ascent: no horizontal offset along the track, so the geometry reduces to one right
  // triangle in the observer's own frame, and the bearing is simply the bearing to the pad.
  const vertical = cases.synthetic_profiles.find(p => p.id === 'synthetic-vertical');
  const verticalTop = M.ascentState(vertical, { latDeg: 0.5, lonDeg: 0, heightM: 0 }, 240);
  assert.ok(verticalTop.elevationDeg > 65 && verticalTop.elevationDeg < 75,
    `a vertical ascent 55.6 km to the south and 160 km up must be about 71 degrees up, got ${verticalTop.elevationDeg.toFixed(2)}`);
  assert.ok(Math.abs(wrap180(verticalTop.azimuthDeg - 180)) < 0.1, 'the pad bearing due south must be reported as 180 degrees');
  assert.equal(verticalTop.aboveHorizon, true);
  // The right-triangle closed form, independent of the module: elevation = atan(up / horizontal).
  const horizontalM = M.greatCircleBetween(0.5, 0, 0, 0).distanceM;
  assert.ok(Math.abs(Math.atan2(160000, horizontalM) * R2D - verticalTop.elevationDeg) < 4,
    'the vertical case must match flat trigonometry to within the curvature correction, which is small here');

  /* ---- 5. long-distance Earth curvature --------------------------------- */
  // A target 600 km downrange at 250 km altitude: flat-earth trigonometry gives a materially steeper
  // elevation than the true ellipsoidal line of sight, which is why curvature cannot be ignored.
  const curved = M.ascentState(eastward, originObserver, 300);
  const flatElevation = Math.atan2(curved.altitudeM, 600000) * R2D;
  measured.curvatureDifferenceDeg = flatElevation - curved.elevationDeg;
  assert.ok(measured.curvatureDifferenceDeg >= TOL.curvatureMinimumDeg,
    `curvature must matter at 600 km: flat gives ${flatElevation.toFixed(2)} deg, spherical gives ${curved.elevationDeg.toFixed(2)} deg`);
  // The horizon crossing must agree with the closed-form arc distance, measured the same way the
  // module measures it: as a surface distance from the observer to the target's sub-point.
  for (const altitudeM of [50000, 100000, 200000, 400000]) {
    const limit = M.horizonDistanceM(0, altitudeM);
    let low = 0, high = (limit * 1.3 / M.DOWNRANGE_RADIUS_M) * R2D;
    for (let i = 0; i < 60; i++) {
      const middle = (low + high) / 2;
      const sight = M.look(originObserver, M.geodeticToEcef(0, middle, altitudeM));
      if (sight.aboveHorizon) low = middle; else high = middle;
    }
    const crossing = M.greatCircleBetween(0, 0, 0, (low + high) / 2).distanceM;
    const relative = Math.abs(crossing - limit) / limit;
    measured.horizonRangeRelative = Math.max(measured.horizonRangeRelative || 0, relative);
    assert.ok(relative <= TOL.horizonRangeRelative,
      `horizon at ${altitudeM} m measured ${(crossing / 1000).toFixed(1)} km against the closed form ` +
      `${(limit / 1000).toFixed(1)} km`);
  }
  // Dip angle: the horizon seen from altitude h falls below the horizontal by acos(R/(R+h)).
  const dipDeg = Math.acos(6371000 / (6371000 + 200000)) * R2D;
  measured.horizonDipDeg = dipDeg;
  assert.ok(dipDeg > 14 && dipDeg < 15, 'the dip angle at 200 km is about 14 degrees');
  // A co-altitude point far away is below the horizon by half the central angle, never above it.
  const farSameHeight = M.look(originObserver, M.geodeticToEcef(0, 10, 0));
  assert.ok(Math.abs(farSameHeight.elevationDeg + 5) < 0.02, 'a co-altitude point ten degrees away is five degrees down');
  assert.equal(farSameHeight.aboveHorizon, false);

  /* ---- 6. longitude wrapping -------------------------------------------- */
  const antimeridian = cases.synthetic_profiles.find(p => p.id === 'synthetic-antimeridian');
  const eastOfLine = M.greatCirclePoint(0, 179.8, 90, 60000);
  assert.ok(eastOfLine.lonDeg < 0, 'a ground track crossing 180 degrees east must report a negative longitude');
  assert.ok(Math.abs(wrap180(eastOfLine.lonDeg - 180.34)) < 0.2, 'and it must be the physically correct point');
  // Two representations of the same physical location must give identical sight lines.
  const westOfLine = M.look(originObserver, M.geodeticToEcef(0, 180.35, 100000));
  const westOfLineAlt = M.look(originObserver, M.geodeticToEcef(0, -179.65, 100000));
  assert.ok(Math.abs(wrap180(westOfLine.azimuthDeg - westOfLineAlt.azimuthDeg)) < TOL.closedFormDeg,
    'longitudes 180.35 and -179.65 are the same place and must not differ');
  assert.ok(Math.abs(westOfLine.elevationDeg - westOfLineAlt.elevationDeg) < TOL.closedFormDeg);
  // Walking the ascent across the line must not produce a bearing discontinuity.
  const observerAtLine = { latDeg: 0, lonDeg: 179.0, heightM: 0 };
  let previousAzimuth = null;
  for (let t = 0; t <= 180; t += 60) {
    const state = M.ascentState(antimeridian, observerAtLine, t);
    if (previousAzimuth !== null) {
      const jump = wrap180(state.azimuthDeg - previousAzimuth);
      assert.ok(Math.abs(jump) < 5, `the bearing must stay continuous across the antimeridian, it jumped ${jump.toFixed(3)} degrees`);
    }
    previousAzimuth = state.azimuthDeg;
  }
  const acrossLine = M.ascentState(antimeridian, observerAtLine, 180);
  assert.ok(acrossLine.lonDeg < 0, 'the final sample lies east of the antimeridian and must be reported as such');
  assert.ok(Math.abs(wrap180(acrossLine.lonDeg - (-177.32))) < 0.3, 'and at the place the downrange arc puts it');

  /* ---- 7. UTC timestamps ------------------------------------------------- */
  const saocomState = M.ascentState(saocom, { latDeg: 34.17145, lonDeg: -118.51161, heightM: 250 }, 142);
  assert.equal(saocomState.utc, '2018-10-08T02:23:22.000Z', 'timing is seconds after the UTC launch instant');
  // A clock change must not move anything: the same instant written in two offsets must be identical.
  const daylight = Date.parse('2018-11-04T01:30:00-04:00');
  const standard = Date.parse('2018-11-04T00:30:00-05:00');
  assert.equal(daylight, standard, 'the same instant in two offsets must parse to one epoch value');
  assert.equal(sun.sunUnitEcefAt(daylight).x, sun.sunUnitEcefAt(standard).x,
    'the Sun direction must not depend on the local clock');
  const dstObserver = { latDeg: 28.5, lonDeg: -80.5, heightM: 5 };
  const dstSunrise = M.solarElevationDeg(M.geodeticToEcef(dstObserver.latDeg, dstObserver.lonDeg, dstObserver.heightM),
    sun.sunUnitEcefAt(daylight));
  const dstSunriseStandard = M.solarElevationDeg(M.geodeticToEcef(dstObserver.latDeg, dstObserver.lonDeg, dstObserver.heightM),
    sun.sunUnitEcefAt(standard));
  assert.equal(dstSunrise, dstSunriseStandard,
    'two spellings of one instant must give one sunlight answer, whatever the local clock says');
  assert.notEqual(dstSunrise, M.solarElevationDeg(M.geodeticToEcef(dstObserver.latDeg, dstObserver.lonDeg, dstObserver.heightM),
    sun.sunUnitEcefAt(standard + 3600000)), 'and an hour later must differ, so the test cannot pass vacuously');
  assert.ok(M.validateProfile({ ...saocom, launch: { ...saocom.launch, utc: '2018-10-08 02:21' } }).errors.length > 0,
    'an unparseable launch instant must be refused');

  /* ---- 8. moving rocket positions --------------------------------------- */
  const encino = { latDeg: 34.17145, lonDeg: -118.51161, heightM: 250 };
  const assessSaocom = M.assess({ profile: saocom, observer: encino, sun, stepS: 10 });
  assert.equal(assessSaocom.geometry.available, true);
  const exact = M.profilePosition(saocom, 120);
  const sample120 = saocom.samples.find(sample => sample.t === 120);
  assert.equal(exact.altitudeM, sample120.altitudeM, 'an exact sample time must return the sample itself');
  assert.equal(exact.interpolated, false);
  const midpoint = M.profilePosition(saocom, 125);
  const sample130 = saocom.samples.find(sample => sample.t === 130);
  assert.equal(midpoint.interpolated, true);
  assert.ok(Math.abs(midpoint.altitudeM - (sample120.altitudeM + sample130.altitudeM) / 2) < 1,
    'a midpoint must be the mean of its bracket');
  // The sight line must move continuously and in one direction during the first-stage ascent.
  const ascentStates = assessSaocom.geometry.samples.filter(state => state.t <= 140);
  for (let i = 1; i < ascentStates.length; i++) {
    const before = ascentStates[i - 1], after = ascentStates[i];
    assert.ok(after.altitudeM >= before.altitudeM, 'the first-stage ascent must keep climbing');
    assert.ok(after.slantRangeM >= before.slantRangeM, 'and must keep moving away from a distant observer');
    // Bounds on continuity, not precision claims: over ten seconds a first-stage vehicle a few hundred
    // kilometres away cannot swing the sight line by more than a few degrees in either coordinate.
    assert.ok(Math.abs(wrap180(after.azimuthDeg - before.azimuthDeg)) < 3, 'the bearing to the vehicle cannot jump');
    assert.ok(Math.abs(after.elevationDeg - before.elevationDeg) < 5, 'nor can the elevation');
  }
  assert.ok(ascentStates[ascentStates.length - 1].azimuthDeg < ascentStates[0].azimuthDeg,
    'a southward ascent seen from the coast must drift away from the pad bearing');

  /* ---- 9. solar illumination geometry ----------------------------------- */
  // Constructed points on the anti-solar axis: the shadow edge must appear at the dip angle, which is
  // the closed-form answer and owes nothing to this module's implementation.
  for (const altitudeM of [100000, 200000, 400000]) {
    const radiusM = 6371000 + altitudeM;
    const dipDeg = Math.acos(6371000 / radiusM) * R2D;
    const sunAxis = { x: 1, y: 0, z: 0 };
    let low = 6300000, high = 6500000;
    for (let i = 0; i < 60; i++) {
      const middle = (low + high) / 2;
      const point = { x: -Math.sqrt(Math.max(0, radiusM ** 2 - middle ** 2)), y: middle, z: 0 };
      if (M.shadowState(point, sunAxis).state === 'umbra') low = middle; else high = middle;
    }
    const edgeRadius = (low + high) / 2;
    const edge = { x: -Math.sqrt(Math.max(0, radiusM ** 2 - edgeRadius ** 2)), y: edgeRadius, z: 0 };
    const edgeElevation = M.solarElevationDeg(edge, sunAxis);
    measured.shadowBoundaryDeg = Math.max(measured.shadowBoundaryDeg || 0, Math.abs(edgeElevation + dipDeg));
    assert.ok(Math.abs(edgeElevation + dipDeg) <= TOL.shadowBoundaryDeg,
      `the shadow edge at ${altitudeM} m must sit at the dip angle: edge ${edgeElevation.toFixed(2)}, dip ${dipDeg.toFixed(2)}`);
    // The penumbra is the band between full shadow and full sunlight, and geometrically it is narrow:
    // 2 * d * tan(rho) where d is the distance along the shadow axis. Atmospheric refraction of grazing
    // sunlight, which this model omits, is what actually widens the honest uncertainty here.
    const penumbraWidthM = 2 * Math.sqrt(Math.max(0, radiusM ** 2 - edgeRadius ** 2)) * Math.tan(0.2666 * D2R);
    measured.penumbraWidthM = Math.max(measured.penumbraWidthM || 0, penumbraWidthM);
    assert.ok(penumbraWidthM > 5000 && penumbraWidthM < 60000,
      `at ${altitudeM} m the penumbral band is tens of kilometres wide, measured ${(penumbraWidthM / 1000).toFixed(1)} km`);
  }
  // Why twilight launch plumes exist: at altitude the Sun can still be up while the ground is dark.
  const atmospherePoint = { x: -Math.sqrt((6371000 + 200000) ** 2 - 6400000 ** 2), y: 6400000, z: 0 };
  measured.altitudeTwilightSolarDeg = M.solarElevationDeg(atmospherePoint, { x: 1, y: 0, z: 0 });
  assert.ok(M.shadowState(atmospherePoint, { x: 1, y: 0, z: 0 }).state === 'sunlit',
    'a point at 200 km altitude is in sunlight at solar elevations that mean twilight on the ground');
  assert.ok(M.twilightBand(measured.altitudeTwilightSolarDeg) !== 'daylight',
    'and that same solar elevation is not daylight for the observer below');
  assert.equal(M.twilightBand(-4), 'civil');
  assert.equal(M.twilightBand(-10), 'nautical');
  assert.equal(M.twilightBand(-16), 'astronomical');
  assert.equal(M.twilightBand(3), 'daylight');
  // The module's Earth-fixed solar elevation must agree with the pinned astronomy layer.
  for (const t of [0, 120, 240, 420]) {
    const milliseconds = Date.parse(saocom.launch.utc) + t * 1000;
    const mine = M.solarElevationDeg(M.geodeticToEcef(encino.latDeg, encino.lonDeg, encino.heightM),
      sun.sunUnitEcefAt(milliseconds));
    const library = astro.sunAltitude(milliseconds, { lat: encino.latDeg, lon: encino.lonDeg, alt: encino.heightM });
    measured.librarySolarDeg = Math.max(measured.librarySolarDeg || 0, Math.abs(mine - library));
    assert.ok(Math.abs(mine - library) <= TOL.librarySolarDeg,
      `solar elevation differs from the astronomy layer by ${(mine - library).toFixed(3)} deg at t=${t}`);
  }



  /* ---- 10. missing trajectory segments ---------------------------------- */
  const gapped = cases.synthetic_profiles.find(p => p.id === 'synthetic-gap');
  const inGap = M.profilePosition(gapped, 200);
  assert.equal(inGap.ok, false, 'a time inside a declared gap must not produce a position');
  assert.equal(inGap.state, 'gap');
  assert.match(inGap.reason, /telemetry dropout/);
  assert.equal(M.profilePosition(gapped, 60).ok, true, 'a time outside the gap still resolves');
  assert.equal(M.profilePosition(gapped, -5).state, 'before');
  assert.equal(M.profilePosition(gapped, 10000).state, 'after', 'nothing may be extrapolated past the last sample');
  // A walk across the gap must report what it could not sample instead of filling it in.
  const gappedAssessment = M.assess({ profile: gapped, observer: { latDeg: 28.7, lonDeg: -80.6, heightM: 5 },
    sun, stepS: 60, allowSynthetic: true });
  assert.ok(gappedAssessment.skipped.length >= 1, 'the walk must report the times it refused');
  assert.ok(gappedAssessment.skipped.every(entry => entry.state === 'gap'), 'and say why');
  // An events-only profile has no continuous track at all.
  const documented = cases.documented_profiles[0];
  assert.equal(M.profilePosition(documented, 300).state, 'events-only',
    'a published timeline must not be walked as if it were telemetry');

  /* ---- 11. uncertain and contradictory source data ---------------------- */
  const contradictory = cases.synthetic_profiles.find(p => p.id === 'synthetic-contradictory-time');
  const contradictoryAssessment = M.assess({ profile: contradictory, observer: { latDeg: 28.7, lonDeg: -80.6, heightM: 5 },
    sun, stepS: 60, allowSynthetic: true });
  assert.ok(contradictoryAssessment.refusals.some(text => /liftoff time/.test(text)),
    'an unresolved disagreement must appear in the refusals');
  assert.ok(contradictoryAssessment.refusals.some(text => /source A/.test(text) && /source B/.test(text)),
    'and must name both competing sources');
  // The validator is the gate: every one of these must be rejected outright.
  const rejections = [
    ['undeclared provenance', { ...saocom, evidence: { ...saocom.evidence, sourceUrl: undefined } }],
    ['missing azimuth uncertainty', { ...saocom, azimuth: { ...saocom.azimuth, uncertaintyDeg: undefined } }],
    ['sample inside a declared gap', { ...gapped, samples: [{ t: 0, altitudeM: 0, downrangeM: 0 },
      { t: 60, altitudeM: 1000, downrangeM: 1000 }, { t: 150, altitudeM: 5000, downrangeM: 5000 }] }],
    ['non-monotonic times', { ...gapped, gaps: [], samples: [{ t: 0, altitudeM: 0, downrangeM: 0 },
      { t: 60, altitudeM: 1000, downrangeM: 1000 }, { t: 60, altitudeM: 2000, downrangeM: 2000 }] }],
    ['a disagreement with one value', { ...saocom,
      disagreements: [{ field: 'azimuth', values: [{ value: 199, source: 'a' }], resolution: 'reported' }] }],
    ['a forbidden claim field', { ...saocom, probability_of_seeing: 0.4 }],
    ['sampling finer than the evidence', { ...saocom, samplingS: 1 }],
    ['a corridor bearing on a time-resolved profile', { ...saocom, azimuth: { ...saocom.azimuth, kind: 'corridor-derived' } }],
    ['level 4 marked as a measured azimuth', { ...cases.corridor_profiles[0],
      azimuth: { ...cases.corridor_profiles[0].azimuth, kind: 'documented' } }],
    ['an azimuth on a pad-only record', { ...cases.pad_only_profiles[0],
      azimuth: { deg: 180, kind: 'documented', uncertaintyDeg: 1, source: 'x' } }],
    ['samples attached to a documented profile', { ...documented, samples: [{ t: 0, altitudeM: 0, downrangeM: 0 }] }],
    ['a provenance kind that cannot support the level', { ...saocom,
      evidence: { ...saocom.evidence, provenanceKind: 'pad-record' } }],
  ];
  for (const [label, profile] of rejections) {
    const result = M.validateProfile(profile);
    assert.equal(result.ok, false, `the validator must reject ${label}`);
    assert.ok(result.errors.length > 0);
  }
  assert.throws(() => M.assertValidProfile(rejections[0][1]), /Invalid trajectory profile/);
  // Real, reported disagreements are surfaced rather than averaged away.
  assert.ok(assessSaocom.refusals.some(text => /azimuth and achieved inclination/.test(text)),
    'the documented azimuth and the achieved inclination must be reported as disagreeing');


  /* ---- 12. evidence taxonomy discipline --------------------------------- */
  const corridor = cases.corridor_profiles[0];
  const corridorAssessment = M.assess({ profile: corridor, observer: { latDeg: 35.8, lonDeg: -78.7, heightM: 100 }, sun });
  assert.equal(corridorAssessment.geometry.available, false, 'a hazard area is not a trajectory');
  assert.equal(corridorAssessment.illumination.available, false);
  assert.ok(corridorAssessment.refusals.some(text => /not a flight path/.test(text)));
  assert.ok(!corridorAssessment.permitted.some(item => /elevation|timing at/.test(item)),
    'a corridor may not offer elevation or time-resolved timing');
  const padOnly = cases.pad_only_profiles[0];
  const padAssessment = M.assess({ profile: padOnly, observer: { latDeg: 34.17, lonDeg: -118.51, heightM: 250 }, sun });
  assert.equal(padAssessment.geometry.available, false);
  assert.ok(padAssessment.refusals.some(text => /no flight geometry at all/.test(text)));
  assert.ok(padAssessment.refusals.some(text => /visibility/.test(text)),
    'the pad-only level must state that it cannot change the unknown visibility label');
  assert.equal(padAssessment.launchAzimuth, null, 'a pad-only record carries no ascent azimuth');
  assert.ok(padAssessment.pad.slantRangeM > 0, 'but it can still state where the pad is');
  // Synthetic results may never be presented as predictions without the explicit flag.
  const gatedSynthetic = M.assess({ profile: gapped, observer: { latDeg: 28.7, lonDeg: -80.6, heightM: 5 }, sun });
  assert.equal(gatedSynthetic.available, false);
  assert.match(gatedSynthetic.refusals.join(' '), /synthetic fixture/);
  // The taxonomy caps the output, and the module never emits a forbidden claim.
  for (const assessment of [assessSaocom, gappedAssessment, corridorAssessment, padAssessment]) {
    assert.ok(assessment.notProvided.length > 0, 'every assessment must state what its level cannot provide');
    const keys = claimKeys(assessment).join(' ');
    for (const forbidden of M.FORBIDDEN_CLAIMS) {
      assert.ok(!keys.includes(forbidden), `an assessment must never carry a ${forbidden} claim`);
    }
    assert.ok(!/ probab/i.test(JSON.stringify(assessment.claims)), 'no claim text may mention a probability');
  }
  assert.deepEqual(M.EVIDENCE_LEVELS.map(level => level.level), [1, 2, 3, 4, 5]);
  assert.equal(M.EVIDENCE_LEVELS[4].samplingS, null, 'the pad-only level is not time-resolved');
  assert.ok(M.EVIDENCE_LEVELS[0].blocked.includes('probability of being seen'),
    'even a verified trajectory may not promise visibility');
  // The documented profile yields sectors and event times, not a bearing at a chosen instant.
  const documentedAssessment = M.assess({ profile: documented, observer: encino, sun });
  assert.equal(documentedAssessment.geometry.samples.length, 0, 'no continuous track may be produced');
  assert.equal(documentedAssessment.geometry.events.length, documented.events.length);
  assert.ok(documentedAssessment.refusals.some(text => /ground position between published events is unknown/.test(text)));
  const meco = documentedAssessment.geometry.events.find(event => event.name === 'main engine cutoff');
  // A published altitude with no published downrange leaves the elevation almost unconstrained: the
  // vehicle could still be near the pad and below the horizon, or already far out and well up.
  assert.ok(meco.sensitivity.elevationRangeDeg[0] < 5 && meco.sensitivity.elevationRangeDeg[1] > 10,
    `the elevation range must span from near the horizon upwards, got ${meco.sensitivity.elevationRangeDeg.map(v => v.toFixed(1)).join(' to ')}`);
  assert.ok(meco.sensitivity.elevationRangeDeg[1] - meco.sensitivity.elevationRangeDeg[0] > 10,
    'and it must be reported as a range, not one number');
  assert.ok(meco.sensitivity.azimuth.spanDeg > 0, 'and a bearing sector');


  /* ---- 13. historical validation against published observations ---------- */
  const encinoObservation = cases.observations.find(entry => entry.id === 'oberg-encino-sightline');
  const sightline = M.assess({ profile: saocom, observer: encino, sun, stepS: 10 });
  const sweep = sightline.geometry.summary.aboveHorizon.azimuth;
  const documentedAzimuth = encinoObservation.documented.sight_azimuth_deg;
  const documentedAzimuthUncertainty = encinoObservation.uncertainty.azimuth_deg;
  // The documented sight line, with the uncertainty its own source states, must overlap the sweep the
  // reconstruction predicts for that observer.
  assert.ok(documentedAzimuth + documentedAzimuthUncertainty >= sweep.fromDeg &&
    documentedAzimuth - documentedAzimuthUncertainty <= sweep.toDeg,
    `the documented sight line of ${documentedAzimuth} +/- ${documentedAzimuthUncertainty} degrees must overlap ` +
    `the predicted sweep ${sweep.fromDeg.toFixed(1)} to ${sweep.toDeg.toFixed(1)} degrees`);
  // And the naive answer, "look where the launch site is", must be measurably wrong: the plume is not
  // the pad, which is why a bearing needs a trajectory rather than a launch site.
  measured.padVersusDocumentedAzimuthDeg = Math.abs(wrap180(sightline.pad.azimuthDeg - documentedAzimuth));
  assert.ok(measured.padVersusDocumentedAzimuthDeg > 10,
    `the pad bearing must not be mistaken for the sight line: they differ by ${measured.padVersusDocumentedAzimuthDeg.toFixed(1)} degrees`);
  // The documented range is stated in miles, and the reconstruction's pad range is a surface distance.
  const padRangeKm = M.greatCircleBetween(encino.latDeg, encino.lonDeg, saocom.site.latDeg, saocom.site.lonDeg).distanceM / 1000;
  measured.padRangeStatuteMileRelative = Math.abs(padRangeKm - 120 * 1.609344) / (120 * 1.609344);
  measured.padRangeNauticalMileRelative = Math.abs(padRangeKm - 120 * 1.852) / (120 * 1.852);
  assert.ok(measured.padRangeStatuteMileRelative <= TOL.reportRangeRelative,
    `120 statute miles is ${(120 * 1.609344).toFixed(1)} km against a computed ${padRangeKm.toFixed(1)} km`);
  // The twilight-plume mechanism, reproduced from first principles: a dark observer, a sunlit vehicle.
  const observerSunAtLaunch = sightline.illumination.observerSunElevationDeg;
  assert.ok(observerSunAtLaunch < -6 && observerSunAtLaunch > -18,
    `the observer must be in twilight at liftoff, got ${observerSunAtLaunch.toFixed(1)} degrees (${sightline.illumination.observerTwilight})`);
  assert.ok(sightline.illumination.sunlitRuns.length > 0, 'part of the ascent must be in full sunlight');
  assert.ok(sightline.illumination.darkObserverWhileVehicleSunlit.length > 0,
    'and the observer must be past civil twilight while the vehicle is lit: that is the twilight plume condition');
  measured.sunlitWindowS = sightline.illumination.sunlitRuns.map(run => [run.fromT, run.toT]);
  // Against the published timeline, timing agrees closely and altitude does not, which is why an
  // honest elevation claim carries a band instead of a single figure.
  const published = cases.anchors.find(entry => entry.id === 'presskit-saocom1a').value;
  measured.eventTimeDeltaS = Math.max(Math.abs(saocom.sourceEvents.meco - published.meco_t),
    Math.abs(saocom.sourceEvents.maxq - 59), Math.abs(saocom.sourceEvents.landing_end - 466));
  assert.ok(measured.eventTimeDeltaS <= TOL.eventTimeS,
    `reconstruction event times must match the published timeline within ${TOL.eventTimeS} s, worst ${measured.eventTimeDeltaS} s`);
  const reconstructionAtMeco = saocom.samples.find(sample => sample.t === 140);
  measured.mecoAltitudeRelative = (reconstructionAtMeco.altitudeM - published.meco_altitude_m) / published.meco_altitude_m;
  assert.ok(Math.abs(measured.mecoAltitudeRelative) >= 0.10 && Math.abs(measured.mecoAltitudeRelative) <= TOL.altitudeRelative,
    `the two sources must disagree about MECO altitude by 10 to 20 per cent, measured ${(measured.mecoAltitudeRelative * 100).toFixed(1)} per cent`);
  const band = [0.86, 1.14].map(scale => M.ascentState({ ...saocom,
    samples: saocom.samples.map(sample => ({ ...sample, altitudeM: sample.altitudeM * scale })) }, encino, 140).elevationDeg);
  measured.elevationBandDeg = Math.abs(band[1] - band[0]);
  assert.ok(measured.elevationBandDeg >= 1.5,
    `the altitude disagreement must produce an elevation band of at least 1.5 degrees, measured ${measured.elevationBandDeg.toFixed(2)}`);

  // Iridium NEXT 4 seen from Orange County: the published evidence is a photograph with no bearing, so
  // the check is qualitative and the test says so instead of inventing a number to compare against.
  const orangeCounty = { latDeg: 33.7175, lonDeg: -117.8311, heightM: 30 };
  const iridiumSight = M.assess({ profile: iridium, observer: orangeCounty, sun, stepS: 10 });
  const iridiumSweep = iridiumSight.geometry.summary.aboveHorizon.azimuth;
  assert.ok(iridiumSweep.spanDeg > 60,
    `an ascent from Vandenberg sweeps a wide arc from Orange County, measured ${iridiumSweep.spanDeg.toFixed(0)} degrees`);
  assert.ok(iridiumSight.illumination.sunlitRuns.length > 0, 'the second stage must be sunlit for part of the flight');
  assert.match(iridiumSight.confidence.observation.grade, /unknown/,
    'with no published bearing, the observation claim must stay unestablished');
  assert.ok(iridiumSight.unknown.some(text => /no optics, no weather, no brightness/.test(text)));
  // Falcon Heavy from Orlando: the daylit, unfavourable case. The geometry is firm, and the lighting
  // rather than the geometry is why the answer must stay unknown.
  const orlando = { latDeg: 28.5383, lonDeg: -81.3792, heightM: 30 };
  const heavySight = M.assess({ profile: falconHeavy, observer: orlando, sun, stepS: 10 });
  const heavySweep = heavySight.geometry.summary.aboveHorizon.azimuth;
  assert.ok(heavySweep.spanDeg < 2,
    `an eastward ascent from the Cape is nearly a fixed bearing from Orlando, measured ${heavySweep.spanDeg.toFixed(2)} degrees`);
  assert.ok(heavySight.illumination.observerSunElevationDeg > 0, 'this case is daylit, which is why it is here');
  assert.equal(heavySight.illumination.observerTwilight, 'daylight');
  assert.equal(heavySight.illumination.sunlitRuns.length, 1, 'the daylit vehicle is sunlit throughout');
  assert.ok(!/visible|see it/i.test(JSON.stringify(heavySight.claims)),
    'a firm geometry in daylight may not become a visibility claim');

  /* ---- 14. reconstructions anchored to achieved orbits ------------------- */
  // Vis-viva is the independent analytical reference for the state the vehicle must have reached.
  const MU = 398600.4418, EARTH_RADIUS_KM = 6378.137;
  const perigeeSpeed = (perigeeKm, apogeeKm) => Math.sqrt(MU * (2 / (EARTH_RADIUS_KM + perigeeKm) -
    1 / (EARTH_RADIUS_KM + (perigeeKm + apogeeKm) / 2))) * 1000;
  const iridiumLast = iridium.samples[iridium.samples.length - 1];
  const heavyLast = falconHeavy.samples[falconHeavy.samples.length - 1];
  measured.iridiumTerminal = { profileSpeedMps: iridiumLast.velocityMps,
    orbitSpeedMps: perigeeSpeed(iridium.orbit.perigeeKm, iridium.orbit.apogeeKm),
    profileAltitudeKm: iridiumLast.altitudeM / 1000, orbitPerigeeKm: iridium.orbit.perigeeKm };
  measured.heavyTerminal = { profileSpeedMps: heavyLast.velocityMps,
    orbitSpeedMps: perigeeSpeed(falconHeavy.orbit.perigeeKm, falconHeavy.orbit.apogeeKm),
    profileAltitudeKm: heavyLast.altitudeM / 1000, orbitPerigeeKm: falconHeavy.orbit.perigeeKm };
  // The finding this phase rests on: each reconstruction agrees with its achieved orbit in one
  // dimension and disagrees in the other, and the two disagree in opposite ways.
  assert.ok(Math.abs(measured.iridiumTerminal.profileSpeedMps - measured.iridiumTerminal.orbitSpeedMps) /
    measured.iridiumTerminal.orbitSpeedMps <= TOL.orbitSpeedRelative,
    'the Iridium reconstruction reaches about the right speed for its orbit');
  assert.ok(Math.abs(measured.iridiumTerminal.profileAltitudeKm - measured.iridiumTerminal.orbitPerigeeKm) > 200,
    'but its altitude is hundreds of kilometres below the orbit it reached');
  assert.ok(Math.abs(measured.heavyTerminal.profileAltitudeKm - measured.heavyTerminal.orbitPerigeeKm) < 10,
    'the Falcon Heavy reconstruction ends at about the right altitude');
  assert.ok(measured.heavyTerminal.profileSpeedMps < measured.heavyTerminal.orbitSpeedMps * 0.90,
    'but its speed is more than ten per cent below the speed that orbit requires');
  for (const id of ['iridium-terminal-state', 'falcon-heavy-terminal-state']) {
    assert.equal(cases.contradictions.find(entry => entry.id === id).resolution, 'unresolved',
      `${id} must stay recorded as an unresolved contradiction`);
  }

  /* ---- 15. inventory, documentation and product protection --------------- */
  const inventory = JSON.parse(fs.readFileSync(path.resolve('src/launches/trajectory-sources.json'), 'utf8'));
  assert.equal(inventory.schema, 'worthlookingup.trajectory-sources/1');
  assert.ok(inventory.sources.length >= 12, 'the inventory must cover every source category examined');
  const ids = new Set();
  for (const source of inventory.sources) {
    for (const field of ['id', 'name', 'category', 'url', 'contributes', 'access', 'machine_readable',
      'spatial_precision', 'temporal_precision', 'coverage', 'update_frequency', 'licence',
      'commercial_reuse', 'automation', 'limitations', 'citation']) {
      assert.ok(source[field] !== undefined, `${source.id} is missing ${field}`);
    }
    assert.ok(inventory.access_vocabulary.includes(source.access), `${source.id} has an unknown access value`);
    assert.ok(inventory.licence_vocabulary.includes(source.licence), `${source.id} has an unknown licence value`);
    assert.ok(inventory.contributes_vocabulary.includes(source.contributes), `${source.id} has an unknown contribution`);
    assert.ok(source.evidence_max === null || (source.evidence_max >= 1 && source.evidence_max <= 5),
      `${source.id} evidence_max must be null or 1..5`);
    assert.equal(ids.has(source.id), false, `duplicate source id ${source.id}`);
    ids.add(source.id);
  }
  // Reuse claims must be as strict as the licence: nothing proprietary may be marked reusable.
  for (const source of inventory.sources.filter(entry => /proprietary|copyright-holder-retained/.test(entry.licence))) {
    assert.equal(source.commercial_reuse, false, `${source.id} may not claim commercial reuse`);
  }
  // The prose inventory must name every id, and both documents must carry their required sections.
  const sourcesDoc = fs.readFileSync(path.resolve('docs/launch-trajectory-sources.md'), 'utf8');
  for (const id of ids) assert.ok(sourcesDoc.includes(id), `docs/launch-trajectory-sources.md must mention ${id}`);
  const feasibility = fs.readFileSync(path.resolve('docs/launch-trajectory-feasibility.md'), 'utf8');
  for (const heading of ['## 1. What the product does today', '## 2. Sources and what they can support',
    '## 3. Evidence taxonomy', '## 4. The geometry prototype', '## 5. Historical validation',
    '## 6. Architecture', '## 7. Tests', '## 8. Recommended Phase 5B scope', '## 9. The eight answers']) {
    assert.ok(feasibility.includes(heading), `the feasibility report must carry the section "${heading}"`);
  }
  assert.ok(/no user-facing visibility prediction/i.test(feasibility),
    'the report must state that this phase activates nothing user-facing');
  // The prototype must stay isolated: no network, no DOM, no storage, no schedule-engine import.
  const prototype = fs.readFileSync(path.resolve('src/launches/launch-trajectory.mjs'), 'utf8');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'document.', 'window.', 'localStorage', 'indexedDB']) {
    assert.ok(!prototype.includes(forbidden), `the prototype may not use ${forbidden}`);
  }
  assert.ok(!/from '\.\/launch-feed/.test(prototype), 'the prototype must not import the schedule engine');
  assert.ok(!/launch-trajectory/.test(fs.readFileSync(path.resolve('index.html'), 'utf8')),
    'nothing user-facing may load the prototype');
  assert.ok(!/launch-trajectory/.test(fs.readFileSync(path.resolve('pages-worker.mjs'), 'utf8')),
    'the worker must not load the prototype');
  // The production launch calendar is untouched: no trajectory field, and visibility still unknown.
  const feed = JSON.parse(fs.readFileSync(path.resolve('data/launches/upcoming.json'), 'utf8'));
  assert.equal(feed.schema, 'worthlookingup.launches/1');
  assert.ok(feed.launches.every(record => !('trajectory' in record) && !('visibility' in record)),
    'the published feed must not carry a trajectory or a visibility field');
  assert.match(fs.readFileSync(path.resolve('overhead-launches.js'), 'utf8'), /visibility:'unknown'/,
    'the calendar module must still report local visibility as unknown');

  console.log('PASS: launch-ascent geometry prototype — geodetic conversion, observer bearing and elevation, ' +
    'below-horizon and Earth-curvature limits, antimeridian wrapping, UTC handling, moving positions, ' +
    'solar shadow geometry, missing segments, contradictory sources, evidence caps, historical validation ' +
    'and the untouched production calendar.');
  console.log('Measured: libraryCoordinatesM ' + measured.libraryCoordinatesM.toFixed(2) +
    ', curvatureDifferenceDeg ' + measured.curvatureDifferenceDeg.toFixed(2) +
    ', horizonRangeRelative ' + measured.horizonRangeRelative.toFixed(5) +
    ', shadowBoundaryDeg ' + measured.shadowBoundaryDeg.toFixed(3) +
    ', penumbraWidthM ' + Math.round(measured.penumbraWidthM) +
    ', librarySolarDeg ' + measured.librarySolarDeg.toFixed(3) +
    ', eventTimeDeltaS ' + measured.eventTimeDeltaS +
    ', mecoAltitudeRelativePct ' + (measured.mecoAltitudeRelative * 100).toFixed(1) +
    ', elevationBandDeg ' + measured.elevationBandDeg.toFixed(2) +
    ', padVersusDocumentedAzimuthDeg ' + measured.padVersusDocumentedAzimuthDeg.toFixed(1) +
    ', padRangeStatuteMilePct ' + (measured.padRangeStatuteMileRelative * 100).toFixed(1) +
    ', padRangeNauticalMilePct ' + (measured.padRangeNauticalMileRelative * 100).toFixed(1) +
    ', sunlitWindowS ' + JSON.stringify(measured.sunlitWindowS) +
    ', iridiumSpeedErrorMps ' + (measured.iridiumTerminal.profileSpeedMps - measured.iridiumTerminal.orbitSpeedMps).toFixed(0) +
    ', iridiumAltitudeErrorKm ' + (measured.iridiumTerminal.profileAltitudeKm - measured.iridiumTerminal.orbitPerigeeKm).toFixed(0) +
    ', heavySpeedErrorMps ' + (measured.heavyTerminal.profileSpeedMps - measured.heavyTerminal.orbitSpeedMps).toFixed(0) +
    ', heavyAltitudeErrorKm ' + (measured.heavyTerminal.profileAltitudeKm - measured.heavyTerminal.orbitPerigeeKm).toFixed(0) + '.');
})();

