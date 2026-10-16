/* Phase 5B: the published historical ascent profiles, the two anchoring gates and the presentation
   contract.

   This suite reads the committed artifact and re-derives every number the generator recorded, so a
   profile cannot pass by trusting its own prose: the terminals are recomputed from the profile's final
   sample and the catalogued orbit, the permissions are recomputed from the gate results, and the whole
   published set would be rejected if any profile awarded itself an output its gates did not support.

   Nothing here is loosened to make a profile pass. The deliberately failing cases later in the file are
   the evidence that the gates can fail. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
globalThis.Astronomy = require(path.resolve('vendor/overhead/astronomy-2.1.19.min.js'));
const astro = require(path.resolve('overhead-astro.js'));
const AE = globalThis.Astronomy;
const artifact = JSON.parse(fs.readFileSync(path.resolve('data/launches/trajectory-profiles.json'), 'utf8'));
const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
const adapter = fs.readFileSync(path.resolve('overhead-launch-explorer.js'), 'utf8');

let module_;
const load = (async () => { module_ = await import('../src/launches/launch-trajectory.mjs'); })();

const sun = {
  sunUnitEcefAt: milliseconds => {
    const equatorial = astro.geometricEquatorial('Sun', milliseconds);
    return module_.sunUnitEcef(equatorial.raDeg, equatorial.decDeg,
      AE.SiderealTime(AE.MakeTime(new Date(milliseconds))));
  },
  solarElevationAt: (milliseconds, latDeg, lonDeg) => astro.sunAltitude(milliseconds, { lat: latDeg, lon: lonDeg }),
};

// Every key in a returned object, so a forbidden output cannot hide in a nested structure.
function keysOf(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    found.push(key.toLowerCase());
    if (Array.isArray(child)) child.forEach(entry => keysOf(entry, found));
    else keysOf(child, found);
  }
  return found;
}
const FORBIDDEN = /^(brightness|magnitude|plumesize|probability|chance|apparentsize|opticalvisibility)$/;

(async () => {
  await load;
  const M = module_;

  /* ---- 1. the artifact itself is publishable ---------------------------- */
  assert.equal(artifact.schema, M.PROFILES_SCHEMA);
  const artifactValidation = M.validateProfileArtifact(artifact);
  assert.equal(artifactValidation.ok, true, 'the published artifact must validate: ' + artifactValidation.errors.join('; '));
  assert.ok(artifact.profiles.length >= 1, 'at least one profile must be published');
  assert.ok(artifact.rejected.length >= 5, 'rejected candidates must be documented, not silently dropped');
  assert.equal(typeof artifact.generated_utc, 'string');
  assert.match(artifact.note, /prediction for any future launch/i);

  /* ---- 2. sources and licences ------------------------------------------ */
  for (const source of artifact.sources) {
    assert.match(source.url, /^https:\/\//, 'every source must be a resolvable public URL');
    assert.ok(source.licence && source.licence.length > 3, 'every source must carry its licence');
    assert.match(source.retrieved_utc, /^\d{4}-\d{2}-\d{2}$/);
  }
  for (const profile of artifact.profiles) {
    assert.ok(profile.evidence.licence, profile.id + ' must state its licence');
    assert.ok(profile.evidence.retrievedUtc && profile.evidence.method, profile.id + ' must state method and retrieval');
    assert.match(profile.evidence.sourceUrl, /^https:\/\//);
    assert.ok(profile.orbit.source && profile.orbit.sourceUrl, profile.id + ' must cite its orbit anchor');
    assert.notEqual(profile.evidence.provenanceKind, 'synthetic-fixture', profile.id + ' must not be synthetic');
    assert.equal(profile.synthetic, undefined);
  }

  /* ---- 3. the recorded gates are reproducible, not asserted -------------- */
  for (const profile of artifact.profiles) {
    const recomputed = M.terminalStateConsistency({ terminal: profile.terminal, orbit: profile.orbit });
    const recorded = profile.validation.terminal;
    assert.equal(recomputed.applicable, true, profile.id + ': a published profile must have an applicable terminal gate');
    assert.equal(recomputed.passes, true, profile.id + ': a published profile must pass the terminal gate');
    assert.equal(recomputed.passes, recorded.passes);
    assert.equal(recomputed.failures.length, 0);
    assert.ok(Math.abs(recomputed.speedRelativeError - recorded.speedRelativeError) < 1e-9,
      profile.id + ': the recorded speed error must match a recomputation');
    assert.ok(Math.abs(recomputed.altitudeErrorKm - recorded.altitudeErrorKm) < 1e-9,
      profile.id + ': the recorded altitude error must match a recomputation');
    assert.ok(Math.abs(recomputed.speedRelativeError) <= M.TERMINAL_STATE.speedRelative);
    assert.ok(recomputed.altitudeErrorKm <= M.TERMINAL_STATE.altitudeKm);
    const permissions = M.publicationPermissions(profile.validation);
    assert.deepEqual(permissions, profile.validation.permissions, profile.id + ': permissions must follow from the gates');
    assert.equal(permissions.elevation, true);
    assert.equal(permissions.illumination, 'vehicle-and-observer');
  }

  /* ---- 4. altitude is not orbital radius -------------------------------- */
  assert.equal(M.orbitalRadiusKm(0), M.EARTH.equatorialRadiusKm);
  assert.ok(Math.abs(M.orbitalRadiusKm(400000) - (M.EARTH.equatorialRadiusKm + 400)) < 1e-9);
  assert.ok(Math.abs(M.orbitSemiMajorAxisKm(400, 400) - M.orbitalRadiusKm(400000)) < 1e-9);
  const circular400 = M.visVivaSpeedMps(400, 400, M.orbitalRadiusKm(400000));
  assert.ok(Math.abs(circular400 - Math.sqrt(M.EARTH.muKm3S2 / M.orbitalRadiusKm(400000)) * 1000) < 1e-6,
    'a circular orbit must follow the circular-speed relation');
  assert.ok(Math.abs(M.insertionSpeedMps(180, 6939) - 9024.9) < 1,
    'the Falcon Heavy demonstration perigee speed must match the published vis-viva value');
  assert.ok(M.visVivaSpeedMps(200, 30000, M.orbitalRadiusKm(200000)) >
    M.visVivaSpeedMps(200, 30000, M.orbitalRadiusKm(30000000)), 'speed must fall with radius along one orbit');
  assert.throws(() => M.orbitalRadiusKm(Number.NaN), /finite altitude/);
  assert.throws(() => M.orbitSemiMajorAxisKm(300, 200), /physically ordered/);

  /* ---- 5. the plane relation: both branches, and the impossible case ---- */
  const formosat = M.planeAzimuths(34.632, 98.30);
  assert.equal(formosat.retrograde, true, 'a 98 degree inclination is retrograde');
  assert.ok(Math.abs(formosat.southerlyDeg - 190.1) < 0.1, 'southbound sun-synchronous heading');
  assert.ok(Math.abs(formosat.northerlyDeg - 349.9) < 0.1, 'the mirror heading of the same plane');
  const heavy = M.planeAzimuths(28.6083, 29.02);
  assert.equal(heavy.retrograde, false);
  assert.ok(Math.abs(heavy.northerlyDeg - 84.91) < 0.05, 'Cape eastbound heading for a 29 degree plane');
  assert.equal(M.planeAzimuths(28.6083, 0.03).available, false,
    'a geostationary plane cannot be reached from Cape latitude, so no heading may be reported');
  for (const profile of artifact.profiles) {
    const plane = M.planeAzimuths(profile.site.latDeg, profile.plane.achievedInclinationDeg);
    const mirror = profile.azimuth.branch === 'southerly' ? 'northerlyDeg' : 'southerlyDeg';
    assert.ok(Math.abs(plane[profile.azimuth.branch === 'southerly' ? 'southerlyDeg' : 'northerlyDeg'] - profile.azimuth.deg) < 1e-6,
      profile.id + ': a derived azimuth must equal the plane heading for the branch it declares');
    assert.ok(Math.abs(plane[mirror] - profile.azimuth.alternateDeg) < 1e-6,
      profile.id + ': the recorded alternate heading must be the mirror branch');
  }

  /* ---- 6. deliberate gate failures, and what they downgrade ------------- */
  // The SAOCOM 1A case: a published azimuth of 199 degrees against an achieved plane that implies about
  // 105.5 degrees of inclination. The gate must report a disagreement far beyond its tolerance.
  const saocom = M.planeConsistency(34.632, 199, 97.9);
  assert.equal(saocom.consistent, false, 'a yaw-steered ascent must fail the plane check');
  assert.ok(Math.abs(saocom.deltaDeg) > 7 && Math.abs(saocom.deltaDeg) < 8, 'measured plane discrepancy');
  const saocomRejected = artifact.rejected.find(entry => entry.id.startsWith('saocom'));
  assert.ok(saocomRejected, 'SAOCOM 1A must be recorded as a rejected candidate');
  assert.equal(saocomRejected.measured.planeApplicable, true);
  assert.equal(saocomRejected.measured.planeConsistent, false);
  assert.match(saocomRejected.reasons.join(' '), /orbital-plane check disagreed/i);

  // A reconstruction whose last sample is on the ground cannot be checked against an orbit at all: a
  // booster landing and an incomplete series must both be refused rather than compared.
  const onGround = M.terminalStateConsistency({ terminal: { altitudeM: 500, velocityMps: 90, phase: 'booster-return' },
    orbit: { perigeeKm: 611, apogeeKm: 626, inclinationDeg: 86.68, appliesTo: 'insertion' } });
  assert.equal(onGround.applicable, false);
  assert.equal(onGround.passes, null);
  assert.match(onGround.reason, /ends on the ground/);
  const noOrbit = M.terminalStateConsistency({ terminal: { altitudeM: 500000, velocityMps: 7600 },
    orbit: { perigeeKm: 611, apogeeKm: 626, inclinationDeg: 86.68, appliesTo: 'operational' } });
  assert.equal(noOrbit.applicable, false, 'an operational orbit is not an insertion state');
  assert.match(noOrbit.reason, /operational orbit/);
  const noSample = M.terminalStateConsistency({ terminal: null, orbit: { perigeeKm: 600, apogeeKm: 620, appliesTo: 'insertion' } });
  assert.equal(noSample.applicable, false, 'a missing terminal sample must refuse the check, not pass it');
  const wrongPhase = M.terminalStateConsistency({ terminal: { altitudeM: 500000, velocityMps: 7600, phase: 'ascent' },
    orbit: { perigeeKm: 500, apogeeKm: 510, inclinationDeg: 86.68, appliesTo: 'insertion' } });
  assert.equal(wrongPhase.applicable, false, 'a profile that stops mid-ascent is not an insertion state');
  assert.match(wrongPhase.reason, /not the insertion phase/);

  // The Iridium NEXT 4 case: the reconstructed end state is both too slow and far too low for its own
  // anchor. Both failures must be reported, and the profile must lose its elevation.
  const iridium = artifact.rejected.find(entry => entry.id.startsWith('iridium-next-4'));
  assert.ok(iridium, 'Iridium NEXT 4 must be recorded as a rejected candidate');
  assert.equal(iridium.measured.terminalPasses, false);
  assert.ok(iridium.measured.speedRelativeError < -0.03, 'measured speed failure');
  assert.ok(iridium.measured.altitudeErrorKm > 25, 'measured altitude failure');
  const iridiumGate = M.terminalStateConsistency({
    terminal: { altitudeM: iridium.measured.terminalAltitudeM, velocityMps: iridium.measured.terminalVelocityMps, phase: 'second-stage' },
    orbit: { perigeeKm: 610, apogeeKm: 626, inclinationDeg: 86.69, appliesTo: 'insertion' } });
  assert.equal(iridiumGate.passes, false);
  assert.deepEqual(iridiumGate.failures.sort(), ['altitude', 'speed']);
  const iridiumPermissions = M.publicationPermissions({ plane: { applicable: false }, terminal: iridiumGate });
  assert.equal(iridiumPermissions.elevation, false);
  assert.equal(iridiumPermissions.timedWindow, false);
  assert.equal(iridiumPermissions.illumination, 'observer-only');
  assert.equal(iridiumPermissions.downgraded, true);
  assert.ok(iridiumPermissions.reasons.length >= 1, 'a downgrade must say why');

  // The Falcon Heavy demonstration: the altitude is right and the speed is 18 per cent wrong. One
  // failing component is enough.
  const heavyRejected = artifact.rejected.find(entry => entry.id.startsWith('falcon-heavy'));
  assert.ok(heavyRejected);
  assert.equal(heavyRejected.measured.terminalPasses, false);
  assert.ok(heavyRejected.measured.speedRelativeError < -0.15, 'measured speed failure for the demonstration flight');
  assert.ok(heavyRejected.measured.altitudeErrorKm < 25, 'its altitude was consistent');
  assert.deepEqual(heavyRejected.measured.terminalFailures, ['speed']);




  /* ---- 7. an artifact cannot award itself what its gates refused -------- */
  const tampered = JSON.parse(JSON.stringify(artifact));
  tampered.profiles[0].validation.terminal.passes = false;
  tampered.profiles[0].validation.terminal.failures = ['speed'];
  // The stated permissions still claim elevation, which is exactly the hand edit the runtime check exists
  // to stop. The permission cross-check and the publishable-profile gate must both refuse it.
  const tamperedValidation = M.validateProfileArtifact(tampered);
  assert.equal(tamperedValidation.ok, false);
  assert.match(tamperedValidation.errors.join(' '), /permissions\.elevation disagrees|may not award itself an elevation/);
  const noGates = JSON.parse(JSON.stringify(artifact.profiles[0]));
  delete noGates.validation;
  assert.equal(M.validatePublishableProfile(noGates).ok, false);
  assert.match(M.validatePublishableProfile(noGates).errors.join(' '), /must carry its gate results/);
  const synthetic = JSON.parse(JSON.stringify(artifact.profiles[0]));
  synthetic.synthetic = true;
  assert.match(M.validatePublishableProfile(synthetic).errors.join(' '), /must never be published/);
  const unlicensed = JSON.parse(JSON.stringify(artifact.profiles[0]));
  delete unlicensed.evidence.licence;
  assert.match(M.validatePublishableProfile(unlicensed).errors.join(' '), /licence/);
  const noAnchor = JSON.parse(JSON.stringify(artifact.profiles[0]));
  delete noAnchor.orbit;
  assert.match(M.validatePublishableProfile(noAnchor).errors.join(' '), /achieved-orbit anchor/);
  const noTerminal = JSON.parse(JSON.stringify(artifact.profiles[0]));
  delete noTerminal.terminal;
  assert.match(M.validatePublishableProfile(noTerminal).errors.join(' '), /terminal sample it was checked against/);
  // A profile that has lost its samples may not claim to be time-resolved either.
  const noSamples = JSON.parse(JSON.stringify(artifact.profiles[0]));
  noSamples.samples = [noSamples.samples[0]];
  assert.equal(M.validateProfile(noSamples).ok, false);
  assert.match(M.validateProfile(noSamples).errors.join(' '), /at least two samples/);

  /* ---- 8. the presentation contract ------------------------------------ */
  const observer = { latDeg: 34.4, lonDeg: -119.7, heightM: 0 };
  for (const profile of artifact.profiles) {
    const explored = M.exploreHistorical({ profile, observer, sun });
    assert.equal(explored.historical, true);
    assert.match(explored.notAPrediction, /not a prediction/i);
    assert.equal(explored.permissions.elevation, true);
    assert.ok(Array.isArray(explored.series) && explored.series.length > 10, profile.id + ' must carry a series');
    assert.ok(explored.summary, profile.id + ' must carry a summary');
    assert.ok(explored.direction && Number.isFinite(explored.direction.centreDeg), profile.id + ' must carry a direction');
    assert.ok(explored.direction.spanDeg >= 0, profile.id + ': the azimuth span must be a range, not one bearing');
    assert.equal(explored.pad.site, profile.site.pad);
    assert.ok(Number.isFinite(explored.pad.azimuthDeg) && Number.isFinite(explored.pad.slantRangeM));
    assert.ok(explored.provenance.source && explored.provenance.licence && explored.provenance.anchor);
    assert.ok(explored.limits.length >= 3, profile.id + ' must publish its limits');
    assert.ok(explored.unknown.length >= 3, profile.id + ' must always state what stays unknown');
    assert.ok(explored.refusals.length + explored.unknown.length >= 3,
      profile.id + ' must say what it cannot tell you');
    assert.equal(explored.illumination.available, true);
    assert.ok(Number.isFinite(explored.illumination.observerSunElevationDeg));
    assert.ok(['daylight', 'civil', 'nautical', 'astronomical', 'deep-night'].includes(explored.illumination.observerTwilight));
    for (const key of keysOf(explored)) {
      assert.equal(FORBIDDEN.test(key), false, `${profile.id}: a forbidden output appeared as key ${key}`);
    }
    const claims = [explored.notAPrediction, ...explored.claims, ...explored.refusals,
      ...explored.unknown, ...explored.limits].join(' ').toLowerCase();
    assert.equal(/brightness of|plume size of|per cent chance|probability of sighting/.test(claims), false,
      profile.id + ': a forbidden claim appeared in the text');
  }

  /* ---- 9. a downgraded profile keeps direction and loses everything else - */
  const downgraded = JSON.parse(JSON.stringify(artifact.profiles[0]));
  downgraded.validation.terminal.passes = false;
  downgraded.validation.terminal.failures = ['altitude'];
  downgraded.validation.permissions = M.publicationPermissions(downgraded.validation);
  assert.equal(M.validateProfileArtifact({ schema: M.PROFILES_SCHEMA, profiles: [downgraded] }).ok, true,
    'a consistently downgraded profile is still a valid published profile');
  const exploredDowngraded = M.exploreHistorical({ profile: downgraded, observer, sun });
  assert.equal(exploredDowngraded.permissions.elevation, false);
  assert.equal(exploredDowngraded.series, null, 'no track may be walked for a downgraded profile');
  assert.equal(exploredDowngraded.summary, null);
  assert.equal(exploredDowngraded.illuminationInvariance, null);
  assert.ok(exploredDowngraded.direction, 'the direction must survive the downgrade');
  assert.equal(exploredDowngraded.direction.kind, downgraded.azimuth.kind);
  assert.ok(Number.isFinite(exploredDowngraded.direction.alternateDeg));
  assert.ok(exploredDowngraded.refusals.some(refusal => /elevation and timed window withheld/.test(refusal)));
  assert.ok(exploredDowngraded.refusals.some(refusal => /failed validation/.test(refusal)));
  assert.equal(exploredDowngraded.illumination.available, false);
  assert.equal(exploredDowngraded.illumination.scope, 'observer-only');
  assert.ok(Number.isFinite(exploredDowngraded.illumination.observerSunElevationDeg),
    'the observer twilight is still available, because it needs no vehicle position');

  /* ---- 10. twilight bands and Earth-shadow classification --------------- */
  assert.equal(M.twilightBand(20), 'daylight');
  assert.equal(M.twilightBand(-3), 'civil');
  assert.equal(M.twilightBand(-9), 'nautical');
  assert.equal(M.twilightBand(-15), 'astronomical');
  assert.equal(M.twilightBand(-25), 'deep-night');
  assert.equal(M.twilightBand(0), 'daylight', 'the horizon itself is still daylight');
  assert.equal(M.twilightBand(-6), 'nautical', 'the civil boundary belongs to the darker band');
  assert.equal(M.twilightBand(-18), 'deep-night', 'the astronomical boundary belongs to the darker band');
  // Shadow classification against a known solar direction: a point behind the Earth must be in the umbra,
  // and a point beside it must be sunlit.
  const sunUnit = { x: 1, y: 0, z: 0 };
  const radiusM = M.EARTH.equatorialRadiusKm * 1000;
  assert.equal(M.shadowState({ x: radiusM + 500000, y: 0, z: 0 }, sunUnit).state, 'sunlit');
  assert.equal(M.shadowState({ x: -(radiusM + 500000), y: 0, z: 0 }, sunUnit).state, 'umbra');
  assert.equal(M.shadowState({ x: 0, y: radiusM + 500000, z: 0 }, sunUnit).state, 'sunlit',
    'a point beside the shadow cylinder is lit');

  /* ---- 11. historical only: no future launch, no profile by family ----- */
  const generatedMs = Date.parse(artifact.generated_utc);
  for (const profile of artifact.profiles) {
    const launchMs = Date.parse(profile.launch.utc);
    assert.ok(Number.isFinite(launchMs), profile.id + ': the launch instant must parse');
    assert.ok(launchMs < generatedMs, profile.id + ': a published profile must be a past flight');
    assert.match(profile.launch.utc, /Z$/, profile.id + ': the launch instant must be an unambiguous UTC instant');
    assert.ok(['second', 'minute', 'hour', 'day', 'month', 'quarter', 'year'].includes(profile.launch.precision));
    assert.ok(/falcon/i.test(profile.vehicle), profile.id + ': only Falcon vehicles are published');
  }
  // Nothing in the artifact may carry a future launch identifier or a prediction: the upstream schedule
  // keeps its own identity and the two must never be joined by vehicle family or launch site.
  const artifactText = JSON.stringify(artifact);
  // The limits arrays name those outputs on purpose, to say they are not derivable. Every other part of
  // a profile must be free of them.
  const claimsFree = artifact.profiles.map(profile => { const copy = { ...profile }; delete copy.limits; return JSON.stringify(copy); }).join(' ');
  assert.equal(/prediction|forecast|will be visible|probability|brightness|plume/i.test(claimsFree), false,
    'no published profile may carry a prediction or an unsupported optical claim');
  const feed = JSON.parse(fs.readFileSync(path.resolve('data/launches/upcoming.json'), 'utf8'));
  for (const record of feed.launches || []) {
    assert.equal(artifactText.includes(record.id), false,
      'no published profile may reference an upcoming launch: ' + record.id);
  }


  /* ---- 12. the interface is wired the way this phase claims ------------- */
  assert.match(indexHtml, /<script src="overhead-launch-explorer\.js" defer><\/script>/);
  assert.match(indexHtml, /<dialog id="ascent-dialog"/);
  assert.match(indexHtml, /id="ascent-flight"/);
  assert.match(indexHtml, /id="ascent-observer"/);
  assert.match(indexHtml, /id="ascent-open"/);
  assert.match(indexHtml, /data-pad-geometry=/);
  assert.match(indexHtml, /enhanceLaunchPadGeometry\(selection\)/);
  assert.match(indexHtml, /none of it predicts a future launch/);
  // The adapter loads both the module and the artifact on demand, resolves them against the document base,
  // and refuses to try at all on a page that cannot serve modules.
  assert.match(adapter, /import\(moduleUrl\(\)\)/);
  assert.match(adapter, /new URL\(MODULE_PATH, document\.baseURI\)/);
  assert.match(adapter, /new URL\(ARTIFACT_PATH, document\.baseURI\)/);
  assert.match(adapter, /validateProfileArtifact/);
  assert.match(adapter, /exploreHistorical/);
  assert.match(adapter, /\^https\?:\$/);
  const adapterCode = adapter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // The adapter names those outputs only to deny them, and it may never phrase one as a claim.
  assert.match(adapterCode, /computed anywhere in this product/);
  assert.equal(/brightness of|plume size of|chance of seeing [\d.]|probability is/i.test(adapterCode), false,
    'the adapter must not state an output the sources cannot support');

  console.log('PASS: published historical ascent profiles — artifact validation, source and licence metadata, ' +
    'reproduced orbital-plane and terminal-state gates, altitude versus orbital radius, retrograde and dogleg ' +
    'cases, deliberate gate failures and downgrades, the presentation contract, twilight and shadow classes, ' +
    'historical-only separation and the interface wiring.');
  console.log('Measured: publishedProfiles ' + artifact.profiles.length +
    ', rejectedCandidates ' + artifact.rejected.length +
    ', worstPublishedSpeedPct ' + (Math.max(...artifact.profiles.map(profile => Math.abs(profile.validation.terminal.speedRelativeError))) * 100).toFixed(2) +
    ', worstPublishedAltitudeKm ' + Math.max(...artifact.profiles.map(profile => profile.validation.terminal.altitudeErrorKm)).toFixed(1) +
    ', bestRejectedSpeedPct ' + (Math.min(...artifact.rejected.filter(entry => entry.measured.terminalApplicable)
      .map(entry => Math.abs(entry.measured.speedRelativeError))) * 100).toFixed(2) +
    ', bestRejectedAltitudeKm ' + Math.min(...artifact.rejected.filter(entry => entry.measured.terminalApplicable)
      .map(entry => entry.measured.altitudeErrorKm)).toFixed(0) + '.');
})().catch(error => { console.error(error); process.exit(1); });