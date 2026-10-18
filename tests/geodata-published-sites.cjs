/* The published area artifact, and everything it must refuse to contain.

   This is the gate that stands between research evidence and a public claim: an area is published only with
   documented after-dark access and a mapped extent, and the artifact may not carry a point's coordinates, a
   parking place, a drive time, a darkness rating or a score. The research inputs are committed, so the whole
   check runs offline and the generator's `--check` is reproducible. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let failures = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); }
  catch (error) { failures++; console.log('FAIL ' + name + '\n     ' + String(error && error.message || error)); } };
const root = path.join(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const NOW = Date.parse('2026-10-18T12:00:00Z');

(async () => {
  const sites = require(path.join(root, 'overhead-sites.js')) || globalThis.OverheadSites;
  const module = globalThis.OverheadSites || sites;
  const artifact = readJson('data/geodata/sites.json');
  const inventory = readJson('research/geodata/candidates/southern-indiana.json');
  const verifications = readJson('src/geodata/access-verifications.json');
  const raw = JSON.stringify(artifact);
  const EXCLUDED = ['glendale-fwa', 'hovey-lake-fwa', 'harmonie', 'patoka-lake', 'higginson-henry',
    'wabash-mount-carmel', 'aep-rockport'];

  test('the artifact validates against the same rules the browser applies', () => {
    assert.strictEqual(module.validate(artifact), artifact);
    assert.strictEqual(artifact.schema, 'worthlookingup.geodata-sites/1');
    assert.strictEqual(artifact.generated_by, 'scripts/build-geodata-sites.mjs');
    // Deterministic: no clock time anywhere, so --check can compare bytes.
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(raw), 'the artifact contains a timestamp');
    assert.ok(!/generated_at/.test(raw), 'the artifact records a generation time');
  });

  test('every published record is an area with verified after-dark access', () => {
    assert.ok(artifact.areas.length >= 1, 'at least one area is published');
    for (const area of artifact.areas) {
      assert.strictEqual(area.type, 'area', area.id + ' is an area');
      assert.strictEqual(area.access.state, 'verified-night-access', area.id + ' is verified');
      assert.ok(area.access.evidence.length >= 2, area.id + ' cites ownership and agency evidence');
      const agency = area.access.evidence.filter(item => item.id !== 'padus-shawnee-ownership' &&
        !/PAD-US/.test(item.publisher));
      assert.ok(agency.length >= 1, area.id + ' cites an agency statement, not just an ownership dataset');
      for (const item of area.access.evidence) {
        assert.match(item.url, /^https:\/\//, area.id + ' evidence URL');
        assert.ok(Number.isFinite(Date.parse(item.verifiedAt)), area.id + ' evidence date');
      }
      assert.ok(Number.isFinite(Date.parse(area.verifiedAt)), area.id + ' has a verification date');
      const age = (NOW - Date.parse(area.verifiedAt)) / 86400000;
      assert.ok(age >= 0 && age <= 365, area.id + ' evidence is current: ' + Math.round(age) + ' days');
    }
  });

  test('an area is never dressed as an observation point', () => {
    for (const area of artifact.areas) {
      assert.ok(!('coordinates' in area), area.id + ' carries no point coordinates');
      assert.ok(!('point' in area) && !('parking' in area) && !('trailhead' in area), area.id + ' invents no facility');
      assert.ok(area.boundary && area.boundary.rings.length >= 1, area.id + ' has a mapped extent');
      for (const ring of area.boundary.rings) {
        assert.ok(ring.length >= 4, area.id + ' ring has shape');
        for (const pair of ring) {
          assert.ok(Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite));
          assert.ok(pair[0] > -91 && pair[0] < -84 && pair[1] > 36 && pair[1] < 40, area.id + ' boundary is in the region');
        }
      }
      assert.strictEqual(area.terrain.state, 'regional-context-only', area.id + ' makes no point clearance claim');
      assert.ok(!('horizonAngleDeg' in area.terrain) && !('clearanceDeg' in area.terrain), area.id + ' has no clearance angle');
      assert.strictEqual(area.sky.state, 'unavailable');
      assert.match(area.sky.message, /has not yet been assessed/);
      assert.strictEqual(area.distance.kind, 'great-circle');
      assert.strictEqual(area.distance.reference, 'nearest mapped boundary');
      assert.match(area.distance.note, /not an entrance/);
      assert.ok(area.unknowns.length >= 4, area.id + ' lists its unknowns');
      assert.ok(area.restrictions.length >= 1, area.id + ' lists at least one restriction');
    }
  });

  test('nothing forbidden appears anywhere in the published bytes', () => {
    const forbidden = ['"coordinates"', '"latitude"', '"longitude"', '"parkingLot"', '"trailhead"',
      '"travelTime"', '"driveMinutes"', '"driveTime"', '"bortle"', '"skyBrightness"', '"mpsas"',
      '"radiance"', '"score"', '"rank"'];
    for (const pattern of forbidden) assert.ok(!raw.includes(pattern), 'the artifact contains ' + pattern);
    // The words may appear only in a negation or in a list of unknowns: what must not exist is a number.
    // Entries in an `unknowns` list name what is missing, so they are removed before the scan: what must
    // not exist is a computed drive, not a sentence admitting there is none.
    const scanned = artifact.areas.flatMap(area => area.unknowns)
      .reduce((text, entry) => text.split(entry).join(''), raw);
    for (const match of scanned.matchAll(/[^".]{0,70}(driving distance|drive time|arrival time|travel time)[^".]{0,70}/gi)) {
      assert.match(match[0], /\bno\b|\bnot\b|unknown|never|without/i,
        'the artifact mentions a drive outside a negation: ' + match[0].trim());
    }
    assert.ok(!/"(durationMinutes|minutes|hours)"\s*:\s*\d/.test(raw), 'the artifact carries a travel duration');
    assert.ok(!/Bortle|mag\/arcsec|mcd/i.test(raw), 'the artifact carries a darkness rating');
  });

  test('excluded candidates are absent, with their reasons recorded in the review file', () => {
    for (const id of EXCLUDED) {
      assert.ok(!raw.includes('"' + id + '"'), id + ' leaked into the public artifact');
      const review = verifications.review[id];
      assert.ok(review && review.outcome === 'excluded', id + ' has no recorded review');
      assert.ok(review.reason && review.reason.length > 30, id + ' review has a real reason');
      assert.match(review.url, /^https:\/\//, id + ' review cites a page');
    }
    assert.strictEqual(artifact.publication.reviewedCandidates, inventory.candidates.length);
    assert.strictEqual(artifact.publication.excludedCount, EXCLUDED.length);
    assert.strictEqual(artifact.publication.publishedAreas, artifact.areas.length);
  });

  test('every published unit has an agency statement that actually names it', () => {
    for (const area of artifact.areas) {
      const statements = [];
      for (const list of Object.values(verifications.evidence)) {
        for (const statement of list) {
          if (Array.isArray(statement.appliesTo) && statement.appliesTo.includes(area.id)) statements.push(statement);
        }
      }
      assert.ok(statements.length >= 1, area.id + ' has no applicable statement');
      assert.ok(statements.some(statement => statement.states && statement.states.nightAccess === 'permitted'),
        area.id + ' has no statement permitting after-dark presence');
    }
    // A statement must not be applied to a unit that is excluded for lack of permission.
    for (const [unit, list] of Object.entries(verifications.evidence)) {
      for (const statement of list) {
        for (const target of statement.appliesTo || []) {
          assert.ok(inventory.candidates.some(candidate => candidate.id === target), statement.id + ' names an unknown unit');
          if (statement.states && statement.states.nightAccess === 'permitted') {
            assert.ok(!EXCLUDED.includes(target), statement.id + ' permits an excluded unit');
          }
        }
      }
    }
  });

  test('the generator reproduces the committed artifact byte for byte', () => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-geodata-sites.mjs'), '--check'],
      { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, 'check failed: ' + result.stderr + result.stdout);
    assert.match(result.stdout, /PASS/);
  });

  test('the artifact stays small enough to load on demand', () => {
    const bytes = fs.statSync(path.join(root, 'data', 'geodata', 'sites.json')).size;
    assert.ok(bytes < 96 * 1024, 'artifact is ' + (bytes / 1024).toFixed(1) + ' kB');
    const moduleBytes = fs.statSync(path.join(root, 'overhead-sites.js')).size;
    assert.ok(moduleBytes < 20 * 1024, 'module is ' + (moduleBytes / 1024).toFixed(1) + ' kB');
  });

  test('the module measures to the nearest edge, and never ranks', () => {
    const area = artifact.areas[0];
    assert.ok(!module.regionContains(artifact, { lat: 51.5, lon: -0.1 }), 'London is outside the region');
    const home = { lat: 38.3553, lon: -87.5675 };
    assert.ok(module.regionContains(artifact, home), 'Princeton is inside the region');
    const onBoundary = { lat: area.boundary.rings[0][0][1], lon: area.boundary.rings[0][0][0] };
    const near = module.nearestBoundary(area, onBoundary);
    assert.ok(near.metres < 1, 'a point on a vertex is at zero metres: ' + near.metres.toFixed(3));
    const far = module.nearestBoundary(area, { lat: 40, lon: -84 });
    assert.ok(far.metres > 100000, 'a far point is far: ' + Math.round(far.metres / 1000) + ' km');
    const entries = module.compare(artifact, home);
    assert.strictEqual(entries.length, artifact.areas.length);
    const names = entries.map(entry => entry.name);
    assert.deepStrictEqual(names, names.slice().sort(), 'ordered by name, not by a quality score');
    for (const entry of entries) {
      assert.strictEqual(entry.distanceKind, 'great-circle');
      assert.ok(Number.isFinite(entry.distanceMetres));
      assert.ok(!('score' in entry) && !('rank' in entry));
    }
    assert.strictEqual(module.distanceLabel(26000), 'about 26 km');
    assert.strictEqual(module.distanceLabel(400), 'about 400 m');
  });

  test('the deployed artifact cannot leak an unverified area', () => {
    const module = readJson('data/geodata/sites.json');
    const tampered = JSON.parse(JSON.stringify(module));
    tampered.areas[0].access.state = 'public-night-unknown';
    assert.throws(() => module.constructor && globalThis.OverheadSites.validate(tampered), /unverified area/);
    const withPoint = JSON.parse(JSON.stringify(module));
    withPoint.areas[0].coordinates = { lat: 38, lon: -88 };
    assert.throws(() => globalThis.OverheadSites.validate(withPoint), /coordinates/);
  });

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all published-site checks passed');
})();
