/* Phase 5C: the mission-direction evidence contract.

   The contract exists so the difference between a published direction and a derived heading can be
   enforced by machine. These tests run the representative fixtures (accepted, rejected and the real
   incomplete investigation) through the validator, and then check the rules the fixtures cannot express:
   that only two of the five evidence classes may ever reach an upcoming mission's sector, and that
   nothing in the product consumes the contract yet. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixtures = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/launches/mission-direction-cases.json'), 'utf8'));

const PRODUCT_FILES = ['index.html', 'overhead-launch-explorer.js', 'overhead-launches.js',
  'pages-worker.mjs', 'overhead-engine.js', 'overhead-lifecycle.js'];

(async () => {
  const M = await import('../src/launches/mission-direction.mjs');

  /* ---- 1. the taxonomy itself ---- */
  assert.deepEqual(M.DIRECTION_CLASSES.map(entry => entry.level), [1, 2, 3, 4, 5], 'the classes are ordered by strength');
  const eligible = M.DIRECTION_CLASSES.filter(entry => entry.upcomingSectorEligible).map(entry => entry.code);
  assert.deepEqual(eligible, ['published-mission-direction', 'reconstructed-mission-direction'],
    'only a published or reconstructed mission-specific direction may ever reach an upcoming mission sector');
  for (const klass of M.DIRECTION_CLASSES) assert.equal(typeof klass.label, 'string');
  for (const needed of ['hazard-area', 'catalogue-orbit', 'press-kit', 'instrumented-reconstruction']) {
    assert.ok(M.SOURCE_TYPES.includes(needed));
  }

  /* ---- 2. every representative fixture behaves as declared ---- */
  const seen = new Set();
  for (const testCase of fixtures.cases) {
    const result = M.validateDirectionEvidence(testCase.record, { nowIso: '2026-10-16T00:00:00Z' });
    const label = testCase.name + ': ';
    assert.equal(result.ok, testCase.expected.ok, label + result.errors.join('; '));
    assert.equal(result.permitted, testCase.expected.permitted, label + result.reasons.join('; '));
    assert.equal(result.klass && result.klass.code, testCase.expected.class, label + 'class');
    if (!testCase.expected.permitted) assert.ok(result.reasons.length, label + 'a refusal must say why');
    // A permitted record must be able to produce a sector, and only then.
    const ask = M.directionSectorForUpcomingMission(testCase.record, { nowIso: '2026-10-16T00:00:00Z' });
    assert.equal(ask.permitted, testCase.expected.permitted, label + 'sector request');
    if (ask.permitted) {
      assert.ok(ask.sector && Number.isFinite(ask.sector.centreDeg) && Number.isFinite(ask.sector.uncertaintyDeg));
      assert.equal(ask.sector.frame, M.REFERENCE_FRAME);
      assert.ok(ask.sector.uncertaintyDeg <= M.MAX_SECTOR_UNCERTAINTY_DEG);
      assert.ok(Array.isArray(ask.provenance.corroboration) && ask.provenance.corroboration.length);
    } else {
      assert.equal(ask.sector, null, label + 'no sector may be produced');
    }
    seen.add(testCase.name);
  }
  assert.equal(seen.size, fixtures.cases.length);
  assert.equal(seen.size, 12);

  /* ---- 3. the specific refusals this phase requires ---- */
  const byName = name => fixtures.cases.find(testCase => testCase.name === name);
  const family = M.validateDirectionEvidence(byName('rejected-family-only-as-upcoming-sector').record);
  assert.equal(family.permitted, false);
  assert.ok(family.reasons.some(reason => /analogy/.test(reason)),
    'a family analogy is refused as an analogy, not as a malformed record');

  const hazard = M.validateDirectionEvidence(byName('rejected-hazard-only-claimed-as-direction').record);
  assert.equal(hazard.ok, false);
  assert.ok(hazard.errors.some(error => /hazard-area source may only be filed as physically-constrained-direction/.test(error)),
    'a hazard area cannot be filed as a flown direction');

  const inclination = M.validateDirectionEvidence(byName('rejected-inclination-derived-claimed-as-published').record);
  assert.equal(inclination.ok, false);
  assert.ok(inclination.errors.some(error => /catalogue-orbit source may only be filed as physically-constrained-direction/.test(error)),
    'an inclination-derived heading can never be class 1 or 2');

  // A class-3 constraint may still be a valid record: the refusal is about use, not about shape.
  const real = byName('incomplete-ussf-481-pad-and-orbit-class-only');
  const constraint = M.validateDirectionEvidence(real.record);
  assert.equal(constraint.ok, true, constraint.errors.join('; '));
  assert.equal(constraint.klass.level, 3);
  assert.equal(constraint.permitted, false);
  assert.ok(constraint.reasons.some(reason => /constraint/.test(reason)));
  assert.ok(real.record.limitations.length >= 4, 'the real investigation must state what is missing');

  // An expired record validates but may not be used, and is usable again only by re-verification.
  const expired = byName('rejected-expired-review').record;
  assert.equal(M.validateDirectionEvidence(expired, { nowIso: '2026-10-16T00:00:00Z' }).permitted, false);
  assert.equal(M.validateDirectionEvidence(expired, { nowIso: '2019-01-01T00:00:00Z' }).permitted, true,
    'the same record was usable before its review date, so the refusal is about expiry and nothing else');

  // The self-corroboration rules: the same URL and the same source type both fail to corroborate.
  const accepted = byName('accepted-published-mission-direction').record;
  const sameUrl = JSON.parse(JSON.stringify(accepted));
  sameUrl.corroboration = [{ sourceType: 'press-kit', url: sameUrl.source.url, independent: true }];
  assert.equal(M.validateDirectionEvidence(sameUrl).ok, false, 'a copy of the same document is not corroboration');
  const sameType = JSON.parse(JSON.stringify(accepted));
  sameType.corroboration = [{ sourceType: 'press-kit', url: 'https://example.invalid/other-press-kit',
    publisher: accepted.source.publisher, independent: true }];
  assert.equal(M.validateDirectionEvidence(sameType).ok, false,
    'the same author restating the same claim in the same form is not independent corroboration');
  const notIndependent = JSON.parse(JSON.stringify(accepted));
  notIndependent.corroboration = [{ sourceType: 'airspace-notice', url: 'https://example.invalid/n/a',
    publisher: 'Example Range Authority', independent: false }];
  assert.equal(M.validateDirectionEvidence(notIndependent).ok, false,
    'corroboration that is not declared independent does not count');
  // A constraint cannot corroborate a direction: an inclination or a hazard area is not a second opinion.
  const constraintSupport = JSON.parse(JSON.stringify(accepted));
  constraintSupport.corroboration = [{ sourceType: 'catalogue-orbit', url: 'https://example.invalid/cat/piece',
    publisher: 'Example Catalogue', independent: true }];
  assert.equal(M.validateDirectionEvidence(constraintSupport).ok, false,
    'a catalogue orbit or hazard area can never corroborate a direction');

  /* ---- 4. the contract is not a capability ---- */
  for (const file of PRODUCT_FILES) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) continue;
    assert.equal(/mission-direction/.test(fs.readFileSync(resolved, 'utf8')), false,
      file + ' must not consume the direction contract yet');
  }
  const directionSource = fs.readFileSync(path.resolve('src/launches/mission-direction.mjs'), 'utf8');
  assert.equal(/fetch\(|localStorage|document\.|indexedDB/.test(directionSource), false,
    'the contract is a pure module: no network, no DOM, no storage');
  assert.match(directionSource, /never be shown as an upcoming mission/);

  console.log('PASS: mission-direction evidence contract — the five-class taxonomy with only published and ' +
    'reconstructed mission-specific directions eligible for an upcoming sector, accepted fixtures that ' +
    'produce a bounded sector, family-only and hazard-only and inclination-derived claims refused, ' +
    'self-corroboration and expiry and ambiguous provenance refused, and no product consumer.');
  console.log('Measured: fixtures ' + fixtures.cases.length + ', classes ' + M.DIRECTION_CLASSES.length +
    ', eligibleClasses ' + eligible.length + ', sectorEligibleFixtures ' +
    fixtures.cases.filter(testCase => testCase.expected.permitted).length + '.');
})().catch(error => { console.error(error); process.exit(1); });
