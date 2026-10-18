/* Sky brightness, nighttime access and the licensing gate.

   The point of these checks is the boundary: what may be *claimed*, and what must be refused. Upward
   radiance is not sky brightness; ownership is not permission; a third-party map is not evidence; and a
   dataset that cannot be legally redistributed may not be marked production-eligible however useful it is. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); }
  catch (error) { failures++; console.log('FAIL ' + name + '\n     ' + String(error && error.message || error)); } };
const NOW = Date.parse('2026-10-18T00:00:00Z');

(async () => {
  const sky = await import('../src/geodata/light-pollution.mjs');
  const access = await import('../src/geodata/access-evidence.mjs');
  const sources = await import('../src/geodata/geo-sources.mjs');
  const raster = await import('../src/geodata/geo-raster.mjs');

  test('luminance and surface brightness convert both ways, with the stated zero point', () => {
    assert.ok(Math.abs(sky.mcdToMpsas(0.17) - 22.02) < 0.02, '0.17 mcd/m2 is about 22 mag/arcsec2: ' + sky.mcdToMpsas(0.17).toFixed(2));
    assert.ok(Math.abs(sky.mpsasToMcd(22) - 0.171) < 0.002, 'and 22 comes back to 0.171 mcd/m2');
    for (const value of [0.05, 0.5, 2, 40]) {
      assert.ok(Math.abs(sky.mcdToMpsas(sky.mpsasToMcd(sky.mcdToMpsas(value))) - sky.mcdToMpsas(value)) < 1e-9);
    }
    assert.strictEqual(sky.mcdToMpsas(0), null, 'a zero luminance has no magnitude');
    assert.strictEqual(sky.mcdToMpsas(NaN), null);
    assert.strictEqual(sky.MPSAS_ZERO_POINT, 12.58);
  });

  test('the natural sky is added, because an artificial-only atlas is not a sky', () => {
    const dark = sky.combineWithNaturalSky(0.01);
    assert.ok(Math.abs(dark.totalMcd - 0.18) < 1e-9, 'artificial plus natural');
    assert.ok(dark.totalMpsas < sky.mcdToMpsas(0.01), 'adding natural light makes the sky brighter, not darker');
    assert.ok(dark.totalMpsas > 21.5, 'and a pristine site stays near 22: ' + dark.totalMpsas.toFixed(2));
    // 1 cd/m2 of artificial luminance is a city centre: about 12.6 mag/arcsec2, eight magnitudes brighter.
    const bright = sky.combineWithNaturalSky(1000);
    assert.ok(bright.totalMpsas < 14, 'a city is much brighter: ' + bright.totalMpsas.toFixed(1));
    assert.throws(() => sky.combineWithNaturalSky(1, 0), /positive/);
  });

  test('upward radiance is never converted into a sky brightness', () => {
    const grid = raster.makeRaster({ width: 2, height: 2, values: [2, 4, 6, 8], bbox: [0, 0, 1, 1], source: 'test' });
    const sampler = raster.rasterSampler(grid);
    const radiance = sky.sampleSkyEvidence({ sampler, point: { lat: 0.5, lon: 0.5 }, unit: sky.UNITS.RADIANCE,
      source: 'eog-viirs-vnl' });
    assert.strictEqual(radiance.unit, sky.UNITS.RADIANCE);
    assert.ok(radiance.value > 0);
    assert.strictEqual(radiance.mpsas, null, 'there is no sky brightness for a radiance sample');
    assert.match(radiance.note, /not a sky brightness/);
    const comparison = sky.compareSamples(radiance, { unit: sky.UNITS.ZENITH_MCD, value: 1 });
    assert.strictEqual(comparison.comparable, false);
    assert.match(comparison.reason, /different quantities/);
    // Two radiance samples are comparable, and the difference is quoted in magnitudes.
    const other = { unit: sky.UNITS.RADIANCE, value: radiance.value / 10 };
    const ratio = sky.compareSamples(radiance, other);
    assert.strictEqual(ratio.comparable, true);
    assert.ok(Math.abs(ratio.magnitudeDifference - 2.5) < 1e-9, 'ten times the radiance is 2.5 magnitudes');
  });

  test('a masked pixel is unavailable, and a zero is not dark', () => {
    const grid = raster.makeRaster({ width: 3, height: 3, values: [1, 1, 1, 1, NaN, 1, 1, 1, 1], bbox: [0, 0, 3, 3] });
    const sampler = raster.rasterSampler(grid);
    const missing = sky.sampleSkyEvidence({ sampler, point: { lat: 1.5, lon: 1.5 }, unit: sky.UNITS.ZENITH_MCD });
    assert.strictEqual(missing.value, null);
    assert.match(missing.reason, /masked|cloud-free coverage missing/);
    assert.match(missing.reason, /not the same as darkness/);
    const zeroGrid = raster.makeRaster({ width: 3, height: 3, values: new Array(9).fill(0), bbox: [0, 0, 3, 3] });
    const zero = sky.sampleSkyEvidence({ sampler: raster.rasterSampler(zeroGrid), point: { lat: 1.5, lon: 1.5 },
      unit: sky.UNITS.ZENITH_MCD });
    assert.strictEqual(zero.value, 0, 'a masked zero is a value of zero, which the comparison must still refuse');
    assert.strictEqual(sky.compareSamples(zero, zero).comparable, false, 'zero cannot be used as a ratio');
    const ranking = sky.rankBySkyEvidence([{ unit: sky.UNITS.ZENITH_MCD, value: null }, { unit: sky.UNITS.ZENITH_MCD, value: 0.4 }]);
    assert.strictEqual(ranking.ranked.length, 1);
    assert.strictEqual(ranking.missing, 1);
    assert.match(ranking.reason, /not ranked/);
  });

  test('nothing in this layer returns a Bortle class', () => {
    const names = Object.keys(sky).join(' ').toLowerCase();
    assert.ok(!names.includes('bortle'), 'no exported name mentions Bortle');
    const grid = raster.makeRaster({ width: 1, height: 1, values: [0.5], bbox: [0, 0, 1, 1] });
    const sample = sky.sampleSkyEvidence({ sampler: raster.rasterSampler(grid), point: { lat: 0.5, lon: 0.5 },
      unit: sky.UNITS.ZENITH_MCD });
    assert.ok(!JSON.stringify(sample).toLowerCase().includes('bortle'), 'the sample carries no Bortle class');
  });

  const evidence = (overrides) => ({ kind: 'agency-page', publisher: 'Test agency', url: 'https://example.gov/x',
    verifiedAt: '2026-10-01', summary: 'test evidence', states: { publicLand: true }, ...overrides });

  test('after-dark access is verified only by an authoritative statement with a legal place to park', () => {
    const verified = access.classifyAccess([
      evidence({ kind: 'official-dataset', states: { publicLand: true } }),
      evidence({ kind: 'agency-rule', states: { publicLand: true, nightAccess: 'permitted', parking: 'permitted' } })], { now: NOW });
    assert.strictEqual(verified.state, access.ACCESS_STATES.VERIFIED);
    assert.strictEqual(access.isRecommendable(verified), true);
    // Permission without parking is not enough to cross a road on foot at 2 a.m.
    const noParking = access.classifyAccess([evidence({ kind: 'agency-rule',
      states: { publicLand: true, nightAccess: 'permitted' } })], { now: NOW });
    assert.strictEqual(noParking.state, access.ACCESS_STATES.PUBLIC_UNKNOWN);
    assert.match(noParking.reason, /vehicle/);
    // A whole-property hours statement covers its own lot, and the inference is recorded.
    const propertyHours = access.classifyAccess([evidence({ kind: 'agency-rule',
      states: { publicLand: true, nightAccess: 'permitted', parking: 'on-site-by-property-hours', scope: 'property' } })], { now: NOW });
    assert.strictEqual(propertyHours.state, access.ACCESS_STATES.VERIFIED);
    assert.strictEqual(propertyHours.parkingInferred, true);
    // The same claim scoped to one activity does not cover the property.
    const activityOnly = access.classifyAccess([evidence({ kind: 'agency-rule',
      states: { publicLand: true, nightAccess: 'permitted', parking: 'on-site-by-property-hours', scope: 'activity' } })], { now: NOW });
    assert.strictEqual(activityOnly.state, access.ACCESS_STATES.PUBLIC_UNKNOWN);
  });

  test('a restriction wins over a permission, because being wrong there is a trespass', () => {
    const conflict = access.classifyAccess([
      evidence({ kind: 'agency-page', states: { publicLand: true, nightAccess: 'permitted', parking: 'permitted' } }),
      evidence({ kind: 'agency-rule', states: { publicLand: true, nightAccess: 'restricted', nightWindow: '07:00-23:00' } })], { now: NOW });
    assert.strictEqual(conflict.state, access.ACCESS_STATES.RESTRICTED);
    assert.strictEqual(conflict.nightWindow, '07:00-23:00');
    assert.strictEqual(conflict.conflict, true, 'the conflict is recorded, not hidden');
    assert.strictEqual(access.isRecommendable(conflict), false);
  });

  test('public ownership alone, or a private parcel, never becomes a recommendation', () => {
    const publicOnly = access.classifyAccess([evidence({ kind: 'official-dataset' })], { now: NOW });
    assert.strictEqual(publicOnly.state, access.ACCESS_STATES.PUBLIC_UNKNOWN);
    assert.match(publicOnly.reason, /after dark/);
    const privateLand = access.classifyAccess([evidence({ kind: 'official-dataset',
      states: { publicLand: false, ownership: 'private' } })], { now: NOW });
    assert.strictEqual(privateLand.state, access.ACCESS_STATES.PRIVATE);
    assert.strictEqual(access.isRecommendable(privateLand), false);
    const nothing = access.classifyAccess([], { now: NOW });
    assert.strictEqual(nothing.state, access.ACCESS_STATES.INSUFFICIENT);
  });

  test('a third-party map can raise a question but never answers one', () => {
    const fromMap = access.classifyAccess([evidence({ kind: 'third-party-map',
      states: { publicLand: true, nightAccess: 'permitted', parking: 'permitted' } })], { now: NOW });
    assert.strictEqual(fromMap.state, access.ACCESS_STATES.INSUFFICIENT, 'a map annotation is not authoritative');
    assert.strictEqual(access.isRecommendable(fromMap), false);
    assert.ok(access.EVIDENCE_AUTHORITY['third-party-map'] < access.EVIDENCE_AUTHORITY['official-dataset']);
    assert.ok(access.EVIDENCE_AUTHORITY['agency-rule'] > access.EVIDENCE_AUTHORITY['agency-page']);
    assert.throws(() => access.authorityOf({ kind: 'hearsay' }), /unknown evidence kind/);
  });

  test('verified access expires, and an expired claim is downgraded rather than kept', () => {
    const old = access.classifyAccess([evidence({ kind: 'agency-rule', verifiedAt: '2024-01-01',
      states: { publicLand: true, nightAccess: 'permitted', parking: 'permitted' } })], { now: NOW });
    assert.strictEqual(old.state, access.ACCESS_STATES.PUBLIC_UNKNOWN);
    assert.strictEqual(old.stale, true);
    assert.match(old.reason, /re-checked/);
    assert.strictEqual(access.isRecommendable(old), false);
    const fresh = access.classifyAccess([evidence({ kind: 'agency-rule',
      states: { publicLand: true, nightAccess: 'permitted', parking: 'permitted' } })], { now: NOW });
    assert.strictEqual(fresh.state, access.ACCESS_STATES.VERIFIED);
    assert.ok(access.evidenceAgeDays(evidence({}), NOW) < 30);
    assert.strictEqual(access.evidenceAgeDays({ verifiedAt: 'not a date' }, NOW), null);
  });

  test('the source inventory validates itself and refuses to overstate eligibility', () => {
    const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'geodata', 'sources.json'), 'utf8'));
    assert.ok(sources.validateInventory(inventory));
    for (const source of inventory.sources) {
      assert.ok(source.limitations.length >= 1, source.id + ' states at least one limitation');
      assert.ok(source.access.url.startsWith('http'), source.id + ' has an access URL');
    }
    // A non-commercial licence can never be production-eligible, whatever the flag says.
    const liar = { ...inventory.sources[0], id: 'liar', productionEligible: true,
      licence: { ...inventory.sources[0].licence, class: 'noncommercial-only', commercialUse: false } };
    assert.throws(() => sources.productionVerdict(liar), /claims productionEligible=true/);
    // Share-alike needs an explicit decision, not an assumption.
    const shareAlike = { ...inventory.sources[0], id: 'sa', productionEligible: false,
      licence: { ...inventory.sources[0].licence, shareAlike: true } };
    const verdict = sources.productionVerdict(shareAlike);
    assert.strictEqual(verdict.eligible, false);
    assert.match(verdict.blockers.join(' '), /share-alike/);
    assert.throws(() => sources.validateSource({ id: 'x' }), /missing/);
    assert.throws(() => sources.validateSource({ ...inventory.sources[0], limitations: [] }), /not credible/);
  });

  test('the gate separates availability from redistribution rights', () => {
    const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'geodata', 'sources.json'), 'utf8'));
    const gate = sources.gateReport(inventory);
    assert.ok(gate.eligible.includes('usgs-3dep'), 'public-domain elevation is eligible');
    assert.ok(gate.eligible.includes('usgs-padus-4-1'), 'public-domain ownership is eligible');
    assert.ok(!gate.eligible.includes('falchi-2016-world-atlas'), 'the non-commercial atlas is not');
    assert.ok(!gate.eligible.includes('eog-viirs-vnl'), 'an account-gated dataset is not');
    assert.ok(!gate.eligible.includes('lorenz-atlas'), 'an unlicensed raster is not');
    const falchi = gate.blocked.find(entry => entry.id === 'falchi-2016-world-atlas');
    assert.match(falchi.blockers.join(' '), /commercial/);
    const eog = gate.blocked.find(entry => entry.id === 'eog-viirs-vnl');
    assert.match(eog.blockers.join(' '), /automated access/);
    assert.strictEqual(gate.routing.length, 4);
    assert.ok(gate.routing.some(entry => /precomputed/.test(entry.id)));
    const attribution = sources.attributionFor(inventory, 'usgs-3dep');
    assert.match(attribution.attribution, /Geological Survey/);
    assert.strictEqual(attribution.checkedAt, '2026-10-18');
    assert.throws(() => sources.sourceById(inventory, 'nope'), /unknown source/);
  });

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all sky, access and licensing checks passed');
})();
