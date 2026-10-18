/* The candidate inventory, the three-axis evaluation, and the promise that none of it reaches production.

   The inventory is real data: coordinates come from PAD-US and every access statement is a quotation with a
   URL and a date. These tests check the record shape, that the evaluation keeps the three axes apart, that a
   site without documented access can never be sorted into the recommendable group, and that the prototype
   modules and research artefacts are absent from the deployment. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let failures = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); }
  catch (error) { failures++; console.log('FAIL ' + name + '\n     ' + String(error && error.message || error)); } };
const root = path.join(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const NOW = Date.parse('2026-10-18T00:00:00Z');

(async () => {
  const access = await import('../src/geodata/access-evidence.mjs');
  const sites = await import('../src/geodata/site-evaluation.mjs');
  const geo = await import('../src/geodata/geo-geometry.mjs');

  const inventory = readJson('research/geodata/candidates/southern-indiana.json');
  const profiles = new Map();
  const profileDir = path.join(root, 'research', 'geodata', 'profiles');
  for (const file of fs.readdirSync(profileDir)) {
    const profile = JSON.parse(fs.readFileSync(path.join(profileDir, file), 'utf8'));
    profiles.set(profile.candidate, profile);
  }
  const evaluate = (candidate) => {
    const profile = profiles.get(candidate.id) || null;
    const classification = access.classifyAccess(candidate.accessEvidence, { now: NOW });
    return sites.evaluateSite({ candidate, access: classification, profile,
      core: profile ? profile.core : null,
      sky: { unit: null, value: null, reason: 'no licensed, machine-readable sky-brightness dataset is available' },
      origin: { lat: 38.3553, lon: -87.5675 }, now: NOW });
  };
  const rows = inventory.candidates.map(evaluate);

  test('the inventory is real, complete and inside its own study area', () => {
    assert.strictEqual(inventory.schema, 'worthlookingup.geodata-candidates/1');
    assert.match(inventory.status, /research-only/);
    assert.ok(inventory.candidates.length >= 8, 'a small but not token inventory: ' + inventory.candidates.length);
    const area = geo.normaliseStudyArea(inventory.studyArea);
    for (const candidate of inventory.candidates) {
      assert.ok(candidate.id && candidate.name && candidate.type, candidate.id + ' has an identity');
      assert.strictEqual(candidate.coordinateSource.sourceId, 'usgs-padus-4-1', candidate.id + ' coordinates come from PAD-US');
      assert.match(candidate.coordinateSource.method, /centroid/);
      assert.ok(candidate.ownership.ownerType, candidate.id + ' records an owner type');
      assert.ok(candidate.accessEvidence.length >= 1, candidate.id + ' has access evidence');
      assert.ok(candidate.verifiedAt, candidate.id + ' records when it was checked');
      assert.doesNotThrow(() => geo.normaliseCoordinate(candidate.coordinates));
    }
    // Every candidate either lies in the study box or is a unit that straddles its edge.
    const outside = inventory.candidates.filter(candidate => !geo.withinStudyArea(area, candidate.coordinates));
    assert.ok(outside.length <= 1, 'at most one straddling unit: ' + outside.map(c => c.id).join(', '));
    for (const candidate of outside) assert.ok(candidate.ownership.acres > 1000, 'and it is a large unit');
    // Every access quotation carries a URL and a date.
    for (const candidate of inventory.candidates) {
      for (const evidence of candidate.accessEvidence) {
        assert.match(evidence.url, /^https:\/\//, candidate.id + ' evidence URL');
        assert.ok(Number.isFinite(Date.parse(evidence.verifiedAt)), candidate.id + ' evidence date');
      }
    }
  });

  test('every candidate has a terrain profile produced from a real DEM', () => {
    assert.strictEqual(profiles.size, inventory.candidates.length, 'a profile per candidate');
    for (const profile of profiles.values()) {
      assert.strictEqual(profile.dem.source, 'usgs-3dep', profile.candidate + ' used 3DEP');
      assert.ok(profile.dem.pixelSizeM > 0 && profile.dem.pixelSizeM < 100, profile.candidate + ' pixel size');
      assert.strictEqual(profile.profile.length, 16, 'sixteen directions');
      assert.ok(profile.profile.every(entry => entry.coverage >= 0.9), profile.candidate + ' complete coverage');
      assert.ok(Number.isFinite(profile.clearance.horizonAngleDeg));
      assert.ok(profile.clearance.uncertaintyDeg >= 0.5);
      assert.ok(profile.core.altitudeDeg > 0, 'the core is up on the target night');
      assert.strictEqual(profile.eyeHeightM, 1.6);
      assert.ok(Number.isFinite(profile.observerElevationM), 'the ground under the observer is recorded');
    }
  });

  test('the evaluation keeps three axes apart and never invents an overall score', () => {
    for (const row of rows) {
      assert.ok(row.access && row.terrain && row.sky, row.id + ' has three verdicts');
      assert.ok(!('score' in row) && !('rank' in row), row.id + ' carries no score or rank');
      assert.strictEqual(row.noCompositeScore, true);
      assert.strictEqual(row.sky.state, 'unavailable', row.id + ' has no sky dataset');
      assert.match(row.sky.reason, /no licensed/);
      assert.match(row.sky.note, /not the same as dark/);
      assert.ok(row.warnings.length >= 1, row.id + ' states its gaps');
      assert.ok(row.provenance.length >= 2, row.id + ' carries provenance for each claim');
      assert.strictEqual(row.distance.kind, 'great-circle');
      assert.match(row.distance.caveat, /not a drive/);
      assert.ok(!('travelTime' in row) && !('driveMinutes' in row), 'no travel time is invented');
      assert.match(row.terrain.caveat, /trees, buildings/);
    }
    // The serialised rows must not contain a drive time under any name.
    const text = JSON.stringify(rows).toLowerCase();
    for (const forbidden of ['drivetime', 'traveltime', 'durationminutes', 'bortle']) {
      assert.ok(!text.includes(forbidden), 'no ' + forbidden + ' anywhere in the evaluation');
    }
  });

  test('the comparison groups by access first and never promotes an unverified site', () => {
    const comparison = sites.compareSites(rows);
    assert.strictEqual(comparison.noCompositeScore, true);
    assert.match(comparison.basis, /grouped by documented after-dark access/);
    const total = comparison.recommendable.length + comparison.needsVerification.length + comparison.unsuitable.length;
    assert.strictEqual(total, rows.length, 'every candidate lands in exactly one group');
    for (const row of comparison.recommendable) assert.strictEqual(row.access.state, 'verified-night-access');
    for (const row of comparison.needsVerification) assert.strictEqual(row.access.recommendable, false);
    for (const row of comparison.unsuitable) assert.ok(['restricted-after-dark', 'private-no-permission'].includes(row.access.state));
    // The private parcel with a public-access flag in PAD-US must not be recommendable.
    const utility = rows.find(row => row.id === 'aep-rockport');
    assert.ok(utility, 'the utility land candidate exists');
    assert.strictEqual(utility.access.state, 'private-no-permission');
    assert.ok(comparison.unsuitable.includes(utility));
    // The state property that publishes 24/7 hours is the one verified reference case.
    const sugarRidge = rows.find(row => row.id === 'sugar-ridge-fwa');
    assert.strictEqual(sugarRidge.access.state, 'verified-night-access');
    assert.ok(sugarRidge.warnings.some(text => /PAD-US records restricted access/.test(text)),
      'the dataset flag that disagrees is surfaced, not hidden');
    // An Indiana property with no published property hours is not verified, whatever its agency.
    const glendale = rows.find(row => row.id === 'glendale-fwa');
    assert.strictEqual(glendale.access.state, 'public-night-unknown');
  });

  test('the committed report matches the inventory it claims to describe', () => {
    const report = readJson('research/geodata/report.json');
    assert.strictEqual(report.schema, 'worthlookingup.geodata-report/1');
    assert.strictEqual(report.status, 'research-only');
    assert.match(report.disclaimer, /Not a recommendation/);
    assert.strictEqual(report.comparison.counts.total, inventory.candidates.length);
    assert.deepStrictEqual(report.gate.eligible.sort(), ['aws-terrain-tiles', 'indiana-dnr-properties',
      'nasa-black-marble-vnp46a4', 'usfs-shawnee', 'usgs-3dep', 'usgs-padus-4-1']);
    assert.ok(report.gate.blocked.some(entry => entry.id === 'falchi-2016-world-atlas'));
    assert.strictEqual(report.checks.profilesPresent, inventory.candidates.length);
    const html = fs.readFileSync(path.join(root, 'research', 'geodata', 'report.html'), 'utf8');
    assert.match(html, /Research only, and not a recommendation/);
    assert.match(html, /no basemap, no tiles/);
    assert.ok(!/https?:\/\/[^"]*\.(png|jpg|webp)/.test(html), 'the page loads no image from anywhere');
    assert.ok(!/<script/i.test(html), 'the page runs no script');
    for (const row of report.comparison.recommendable) assert.ok(html.includes(row.name), row.name + ' appears in the page');
  });

  test('none of this reaches the deployment', () => {
    // The build stages index.html, the overhead modules, the launch modules and the public asset and data
    // directories. The prototype lives outside all of them, and the build allowlist is asserted rather than
    // assumed, so a future edit that copies src/ wholesale fails here.
    const build = fs.readFileSync(path.join(root, 'scripts', 'build.cjs'), 'utf8');
    assert.ok(!/src['"]?,?\s*\)?\s*;?\s*$/.test(build.split('\n').slice(0, 20).join('\n')));
    assert.ok(!/fs\.cpSync\([^)]*'src'/.test(build), 'the build never copies src wholesale');
    assert.ok(!/cpSync\([^)]*research/.test(build), 'the build never copies research');
    const packageJson = readJson('package.json');
    // Generator scripts may exist; what must never happen is a build or deploy that ships their output.
    assert.ok(!/research/.test(packageJson.scripts.build || ''), 'the build script does not touch research');
    assert.ok(!/research/.test(packageJson.scripts.deploy || ''), 'the deploy script does not touch research');
    assert.ok(/geodata:report/.test(JSON.stringify(packageJson.scripts)), 'the report is generated by its own script');
    // And the modules do not reference the network at all.
    for (const file of fs.readdirSync(path.join(root, 'src', 'geodata'))) {
      if (!file.endsWith('.mjs')) continue;
      const text = fs.readFileSync(path.join(root, 'src', 'geodata', file), 'utf8');
      assert.ok(!/\bfetch\(/.test(text), file + ' performs no request');
      assert.ok(!/XMLHttpRequest|localStorage|document\./.test(text), file + ' touches no browser global');
    }
    const dist = path.join(root, 'dist');
    if (fs.existsSync(dist)) {
      assert.ok(!fs.existsSync(path.join(dist, 'src', 'geodata')), 'dist has no geodata module');
      assert.ok(!fs.existsSync(path.join(dist, 'research')), 'dist has no research artefact');
    }
  });

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all candidate, evaluation and packaging checks passed');
})();
