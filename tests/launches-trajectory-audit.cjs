/* Phase 5C: the trajectory evidence audit, the compact pad index and the review policy.

   Everything here runs offline against fixtures. The audit's judgement lives in
   src/launches/trajectory-audit.mjs, so the failure paths that matter — a source that answers with a
   different record, a source that does not answer at all, an artifact that no longer reproduces its own
   gates — are exercised directly instead of being inferred from a network run. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const artifact = JSON.parse(fs.readFileSync(path.resolve('data/launches/trajectory-profiles.json'), 'utf8'));
const padIndex = JSON.parse(fs.readFileSync(path.resolve('data/launches/trajectory-pad-index.json'), 'utf8'));
const review = JSON.parse(fs.readFileSync(path.resolve('data/launches/trajectory-review.json'), 'utf8'));
const adapter = fs.readFileSync(path.resolve('overhead-launch-explorer.js'), 'utf8');
const auditSource = fs.readFileSync(path.resolve('src/launches/trajectory-audit.mjs'), 'utf8');

let modules;
const load = (async () => {
  modules = {
    T: await import('../src/launches/launch-trajectory.mjs'),
    AUDIT: await import('../src/launches/trajectory-audit.mjs'),
    INDEX: await import('../src/launches/launch-pad-index.mjs'),
  };
})();

const clone = value => JSON.parse(JSON.stringify(value));
// A live source that agrees with a committed profile, built from the artifact itself.
const agreeingLive = profile => ({
  launchInstant: { available: true, utc: profile.launch.utc },
  orbit: { available: true, found: true, perigeeKm: profile.orbit.perigeeKm, apogeeKm: profile.orbit.apogeeKm,
    inclinationDeg: profile.orbit.inclinationDeg },
  pad: { looked: true, found: true, latDeg: profile.site.latDeg, lonDeg: profile.site.lonDeg },
  series: { available: true, terminal: { altitudeM: profile.terminal.altitudeM, velocityMps: profile.terminal.velocityMps } },
});

(async () => {
  await load;
  const { T, AUDIT, INDEX } = modules;

  /* ---- 1. the committed publication passes its own audit --------------- */
  const digest = crypto.createHash('sha256')
    .update(fs.readFileSync(path.resolve('data/launches/trajectory-profiles.json'))).digest('hex');
  const integrity = AUDIT.auditIntegrity({ artifact, padIndex, review, artifactDigest: digest });
  const integritySummary = AUDIT.summarize(integrity);
  assert.equal(integritySummary.verdict, 'clean', integritySummary.failures.concat(integritySummary.reviews)
    .map(entry => `${entry.scope}/${entry.name}: ${entry.detail}`).join('; '));
  assert.equal(integritySummary.counts.fail, 0);
  assert.equal(integritySummary.counts.unavailable, 0);
  for (const check of integrity) assert.ok(AUDIT.CHECK_STATUSES.includes(check.status), 'unknown check status ' + check.status);

  /* ---- 2. every published profile against agreeing live sources -------- */
  for (const profile of artifact.profiles) {
    const result = AUDIT.auditAnchor(profile, agreeingLive(profile));
    const summary = AUDIT.summarize(result.checks);
    assert.equal(summary.verdict, 'clean', profile.id + ': ' + JSON.stringify(result.checks.filter(c => c.status !== 'pass')));
    assert.equal(result.changed, null, profile.id + ': an agreeing source must not look like drift');
    assert.equal(result.checks.length, 5, profile.id + ': the instant, the orbit, the gate, the pad and the series');
  }

  /* ---- 3. a source that does not answer is never a contradiction ------- */
  const first = artifact.profiles[0];
  const offlineChecks = AUDIT.auditAnchor(first, {
    launchInstant: { available: false, detail: 'HTTP 503' },
    orbit: { available: false, detail: 'HTTP 503' },
    pad: { looked: false, detail: 'HTTP 503' },
    series: { available: false, detail: 'fetch failed' },
  }).checks;
  const offlineSummary = AUDIT.summarize(offlineChecks);
  assert.equal(offlineSummary.verdict, 'clean', 'an unavailable source must not create work for a human');
  // The gate check only exists when the orbit was readable, so an unreachable catalogue yields four
  // unavailable checks rather than five.
  assert.equal(offlineSummary.counts.unavailable, 4);
  assert.equal(AUDIT.candidateReviewEntries(offlineChecks, '2026-10-16').length, 0,
    'an unavailable source must never produce a suppression candidate');
  assert.equal(AUDIT.reviewRecordFor([], '2026-10-16'), null);

  /* ---- 4. a contradictory source is a review item, never a demotion ---- */
  const movedOrbit = agreeingLive(first);
  movedOrbit.orbit.perigeeKm += 40;
  const orbitResult = AUDIT.auditAnchor(first, movedOrbit);
  assert.ok(orbitResult.checks.some(c => c.name === 'orbit anchor unchanged' && c.status === 'review-required'));
  assert.ok(orbitResult.checks.some(c => c.name === 'terminal gate passes against the live anchor' && c.status === 'review-required'));
  assert.ok(typeof orbitResult.changed === 'string' && /orbit/.test(orbitResult.changed));
  const candidates = AUDIT.candidateReviewEntries(orbitResult.checks, '2026-10-16');
  assert.equal(candidates.length, 1, 'one profile yields one candidate entry');
  assert.equal(candidates[0].id, first.id);
  assert.equal(candidates[0].action, 'suppress-elevation', 'a candidate may only withhold output');
  const candidateRecord = AUDIT.reviewRecordFor(candidates, '2026-10-16');
  assert.equal(T.validateReviewRecord(candidateRecord).ok, true, T.validateReviewRecord(candidateRecord).errors.join('; '));

  const movedPad = agreeingLive(first);
  movedPad.pad.latDeg += 0.4;
  assert.ok(AUDIT.auditAnchor(first, movedPad).checks.some(c => c.name === 'pad coordinates unchanged' && c.status === 'review-required'));

  const movedSeries = agreeingLive(first);
  movedSeries.series.terminal.velocityMps -= 25;
  assert.ok(AUDIT.auditAnchor(first, movedSeries).checks.some(c => c.name === 'source series unchanged' && c.status === 'review-required'));

  const movedInstant = agreeingLive(first);
  movedInstant.launchInstant.utc = new Date(Date.parse(first.launch.utc) + 3600000).toISOString();
  assert.ok(AUDIT.auditAnchor(first, movedInstant).checks.some(c => c.name === 'launch instant unchanged' && c.status === 'review-required'));

  // A withdrawn anchor is a review item; a pad row we cannot match by name is only unavailable.
  const gone = agreeingLive(first);
  gone.orbit = { available: true, found: false };
  gone.launchInstant = { available: true, utc: null };
  gone.pad = { looked: true, found: false };
  const goneSummary = AUDIT.summarize(AUDIT.auditAnchor(first, gone).checks);
  assert.equal(goneSummary.counts['review-required'], 2);
  assert.equal(goneSummary.counts.unavailable, 1, 'a pad row we cannot match by name is unavailable, not drift');
  assert.equal(goneSummary.counts.fail, 0);

  // A sub-minute refinement of the launch instant (a log that now publishes seconds) is not drift.
  const refined = agreeingLive(first);
  refined.launchInstant.utc = new Date(Date.parse(first.launch.utc) + 30000).toISOString();
  assert.equal(AUDIT.summarize(AUDIT.auditAnchor(first, refined).checks).verdict, 'clean',
    'a refinement inside the published precision is not drift');

  /* ---- 5. integrity failures the audit must never gloss over ----------- */
  const tampered = clone(artifact);
  tampered.profiles[0].validation.permissions.elevation = false;
  tampered.profiles[0].validation.permissions.downgraded = true;
  const tamperedChecks = AUDIT.auditIntegrity({ artifact: tampered, padIndex, review, artifactDigest: digest });
  assert.ok(tamperedChecks.some(c => c.status === 'fail' && c.name === 'permissions follow the gates'),
    'a permission edit must fail the audit');
  assert.equal(AUDIT.summarize(tamperedChecks).verdict, 'integrity-failure');

  const relabelled = clone(artifact);
  relabelled.profiles[0].evidence.level = 1;
  const relabelChecks = AUDIT.auditIntegrity({ artifact: relabelled, padIndex, review, artifactDigest: digest });
  assert.ok(relabelChecks.some(c => c.status === 'fail' && c.name === 'evidence level unchanged'),
    'a hand-raised evidence level must fail the audit');
  // The audit never rewrites what it is judging.
  assert.equal(/writeFileSync\([^)]*trajectory-profiles/.test(auditSource), false,
    'the audit must not write the published artifact');
  assert.equal(/writeFileSync\([^)]*trajectory-review/.test(auditSource), false,
    'the audit must not write the review record');

  const staleIndex = clone(padIndex);
  staleIndex.artifact_digest = '0'.repeat(64);
  const staleChecks = AUDIT.auditIntegrity({ artifact, padIndex: staleIndex, review, artifactDigest: digest });
  assert.ok(staleChecks.some(c => c.name === 'pad index digest matches the artifact' && c.status === 'fail'));

  const noIndex = AUDIT.auditIntegrity({ artifact, padIndex: null, review, artifactDigest: digest });
  assert.equal(AUDIT.summarize(noIndex).counts['review-required'], 1, 'a missing index is a review item');

  const noReview = AUDIT.auditIntegrity({ artifact, padIndex, review: null, artifactDigest: digest });
  assert.equal(AUDIT.summarize(noReview).verdict, 'review-required');
  const brokenReview = AUDIT.auditIntegrity({ artifact, padIndex, artifactDigest: digest,
    review: { schema: T.REVIEW_SCHEMA,
      entries: [{ id: first.id, action: 'promote-to-level-one', reason: 'x', since: '2026-10-16', evidence: 'y' }] } });
  assert.ok(brokenReview.some(c => c.status === 'fail' && c.name === 'review record validates'),
    'a review record with an invented action must fail');




  /* ---- 6. the pad index is generated from the artifact and agrees with it ---- */
  assert.equal(padIndex.schema, INDEX.PAD_INDEX_SCHEMA);
  assert.equal(padIndex.artifact_digest, digest, 'the committed index was built from the committed artifact');
  const rebuilt = INDEX.buildPadIndex(artifact, { digest, generatedUtc: padIndex.generated_utc });
  assert.deepEqual(rebuilt, padIndex, 'the committed index must be reproducible from the artifact');
  assert.equal(padIndex.profile_count, artifact.profiles.length);
  const indexed = new Set(padIndex.pads.flatMap(pad => pad.profiles.map(profile => profile.id)));
  assert.equal(indexed.size, artifact.profiles.length);
  for (const profile of artifact.profiles) assert.ok(indexed.has(profile.id), profile.id + ' must appear in the index');
  for (const pad of padIndex.pads) {
    assert.equal(INDEX.padKey(pad.lat_deg, pad.lon_deg), pad.key);
    for (const profile of pad.profiles) {
      const source = artifact.profiles.find(entry => entry.id === profile.id);
      assert.equal(profile.mission, source.mission);
      assert.equal(profile.launch_utc, source.launch.utc);
      assert.equal(profile.evidence_level, source.evidence.level);
      assert.equal(profile.output, source.validation.permissions.elevation ? 'elevation-and-window' : 'direction-only');
    }
  }
  // The index answers one question and must carry no geometry: an index that could answer more would be a
  // second source of trajectory truth.
  const indexText = JSON.stringify(padIndex);
  for (const forbidden of ['altitudeM', 'downrangeM', 'velocityMps', 'elevationDeg', 'azimuthDeg', 'samples']) {
    assert.equal(indexText.includes(forbidden), false, 'the index must not carry ' + forbidden);
  }

  /* ---- 7. index matching, and the ways a bad index fails safe ---------- */
  const vandenberg = artifact.profiles[0].site;
  assert.equal(INDEX.profilesForPad(padIndex, { latitude: vandenberg.latDeg, longitude: vandenberg.lonDeg }).length, 3);
  // The launch feed publishes the same pad with slightly different precision.
  assert.equal(INDEX.profilesForPad(padIndex, { latitude: 34.632, longitude: -120.611 }).length, 3);
  assert.equal(INDEX.profilesForPad(padIndex, { latitude: 28.5619, longitude: -80.5774 }).length, 0,
    'another pad has no profile');
  assert.equal(INDEX.profilesForPad(null, { latitude: 34.632, longitude: -120.611 }).length, 0,
    'a missing index yields no profiles');
  assert.equal(INDEX.profilesForPad(padIndex, null).length, 0);
  assert.equal(INDEX.profilesForPad(padIndex, { latitude: Number.NaN, longitude: 0 }).length, 0);

  const badIndexes = [
    [null, /must be an object/],
    [{ schema: 'other', pads: [] }, /schema/],
    [{ schema: INDEX.PAD_INDEX_SCHEMA, pads: [] }, /digest/],
    [{ ...clone(padIndex), profile_count: 99 }, /profile_count/],
    [{ ...clone(padIndex), pads: [{ key: '34.632,-120.611', lat_deg: 34.632, lon_deg: -120.6106, pad: 'p',
      profiles: [{ id: 'a', launch_utc: new Date().toISOString(), evidence_level: 2, output: 'nope' }] }] }, /output/],
    [{ ...clone(padIndex), pads: [{ key: '34.632,-120.611', lat_deg: 34.632, lon_deg: -120.6106, pad: 'p', profiles: [] }] },
      /at least one profile/],
  ];
  for (const [bad, expected] of badIndexes) {
    const result = INDEX.validatePadIndex(bad);
    assert.equal(result.ok, false, 'this index must be rejected');
    assert.match(result.errors.join(' '), expected);
  }
  assert.throws(() => INDEX.assertPadIndex(null), /Invalid pad index/);
  const leaky = clone(padIndex);
  leaky.pads[0].profiles[0].altitudeM = 724439;
  assert.match(INDEX.validatePadIndex(leaky).errors.join(' '), /must not carry trajectory data/);


  /* ---- 8. applying a review suppresses output without rewriting history ---- */
  const suppressed = T.assertReviewRecord({ schema: T.REVIEW_SCHEMA, reviewed_utc: '2026-10-16',
    entries: [{ id: first.id, action: 'suppress-elevation', since: '2026-10-16',
      reason: 'the monthly audit found the catalogued orbit had moved', evidence: 'scripts/audit-trajectory-profiles.mjs' }] });
  const observer = { latDeg: 34.4, lonDeg: -119.7, heightM: 0 };
  const before = T.exploreHistorical({ profile: first, observer });
  assert.equal(before.permissions.elevation, true);
  assert.ok(before.series && before.series.length > 10);
  const after = T.exploreHistorical({ profile: first, observer, review: suppressed });
  assert.equal(after.permissions.elevation, false, 'a review withholds the elevation');
  assert.equal(after.permissions.timedWindow, false);
  assert.equal(after.permissions.illumination, 'observer-only');
  assert.equal(after.series, null, 'no track may be walked while a review is active');
  assert.equal(after.summary, null);
  assert.ok(after.direction, 'the direction survives a suppression, exactly as it survives a failed gate');
  assert.equal(after.review.action, 'suppress-elevation');
  assert.ok(after.refusals.some(refusal => /evidence review since 2026-10-16/.test(refusal)));
  // The recorded gate results are the record of what was verified, and a review must not rewrite them.
  assert.deepEqual(after.validation, first.validation);
  assert.equal(after.gatePermissions.elevation, true, 'the gates still say they passed, and the panel says both');
  assert.equal(T.validateProfileArtifact({ schema: T.PROFILES_SCHEMA, profiles: [first] }).ok, true,
    'a suppressed profile stays a valid published profile: the artifact is not rewritten');

  // suppress-all withholds even the direction, and a review entry for another profile changes nothing.
  const all = T.assertReviewRecord({ schema: T.REVIEW_SCHEMA, reviewed_utc: '2026-10-16',
    entries: [{ id: first.id, action: 'suppress-all', since: '2026-10-16', reason: 'provenance is ambiguous',
      evidence: 'docs/trajectory-audit.md' }] });
  const silenced = T.exploreHistorical({ profile: first, observer, review: all });
  assert.equal(silenced.direction, null, 'suppress-all withholds the direction too');
  assert.equal(silenced.permissions.elevation, false);
  const unrelated = T.assertReviewRecord({ schema: T.REVIEW_SCHEMA, reviewed_utc: '2026-10-16',
    entries: [{ id: 'some-other-profile', action: 'suppress-all', since: '2026-10-16', reason: 'x', evidence: 'y' }] });
  assert.equal(T.exploreHistorical({ profile: first, observer, review: unrelated }).permissions.elevation, true,
    'a review entry for another profile must not affect this one');
  // An unreadable review record suppresses nothing rather than silently authorising output.
  assert.equal(T.reviewFor({ schema: 'other', entries: [] }, first.id), null);
  assert.equal(T.reviewFor({ schema: T.REVIEW_SCHEMA, entries: 'nope' }, first.id), null);
  assert.equal(T.reviewFor(null, first.id), null);

  /* ---- 9. the interface asks for the small pieces, not the whole catalog ---- */
  assert.match(adapter, /launch-geodesy\.mjs/);
  assert.match(adapter, /launch-pad-index\.mjs/);
  assert.match(adapter, /trajectory-pad-index\.json/);
  assert.match(adapter, /function ensureCardData\(\)/);
  assert.match(adapter, /profilesForPad\(cards\.index/);
  // The launch-card path may not reach for the evidence module or the profile artifact: those belong to the
  // panel, and this asserts the split is real rather than a naming convention.
  const cardBody = adapter.slice(adapter.indexOf('function enhanceLaunchCards'), adapter.indexOf('var api = { open: open'));
  assert.equal(/ensureData\(\)/.test(cardBody), false, 'the card path must not load the profile artifact');
  assert.equal(/data\.module|data\.artifact/.test(cardBody), false, 'the card path must not use the evidence module');
  assert.match(cardBody, /ensureCardData\(\)/);
  // A review is applied in the panel, where a reader can see why an output is missing.
  assert.match(adapter, /review: data\.review/);
  assert.match(adapter, /validateReviewRecord/);

  console.log('PASS: trajectory evidence audit — artifact/index/review integrity, gate reproduction, agreed, ' +
    'contradictory and unavailable sources, drift beyond tolerance, review candidates that can only withhold ' +
    'output, the generated pad index and its consistency with the artifact, and the interface split between the ' +
    'compact card path and the full panel path.');
  console.log('Measured: publishedProfiles ' + artifact.profiles.length +
    ', integrityChecks ' + integrity.length +
    ', pads ' + padIndex.pad_count +
    ', reviewEntries ' + review.entries.length + '.');
})().catch(error => { console.error(error); process.exit(1); });
