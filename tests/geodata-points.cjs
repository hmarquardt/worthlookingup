/* Verified observation points: the artifact, its provenance, its terrain and the refusals behind it.

   The point artifact may only contain facilities the agency names and permits overnight use of, with a recorded
   coordinate provenance and a real elevation profile. Everything else stays in the research inventory, where the
   negative findings live. No network access: the inventory, the profiles and the artifact are all committed. */
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

require(path.join(root, 'overhead-sites.js'));
const sites = globalThis.OverheadSites;
const points = readJson('data/geodata/points.json');
const areas = readJson('data/geodata/sites.json');
const inventory = readJson('research/geodata/points/candidates.json');
const raw = JSON.stringify(points);

(async () => {
  test('the artifact validates against the rules the browser applies', () => {
    assert.strictEqual(sites.validatePoints(points), points);
    assert.strictEqual(points.schema, 'worthlookingup.geodata-points/1');
    assert.strictEqual(points.generated_by, 'scripts/build-geodata-points.mjs');
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(raw), 'no clock time leaks into the artifact');
    assert.strictEqual(points.points.length, 3, 'three facilities cleared the gate');
  });

  test('every point is a facility with verified night presence and a parking basis', () => {
    for (const point of points.points) {
      assert.strictEqual(point.type, 'point', point.id + ' is a point');
      assert.strictEqual(point.access.nightPresence, 'verified', point.id + ' night presence is verified');
      assert.ok(['verified', 'verified-at-designated-campsite'].includes(point.access.parking),
        point.id + ' has a documented parking basis: ' + point.access.parking);
      assert.ok(point.facilityType, point.id + ' names a facility type');
      assert.ok(point.access.evidence.some(entry => entry.quote), point.id + ' quotes a statement');
      for (const entry of point.access.evidence) {
        assert.match(entry.url, /^https:\/\//, point.id + ' evidence URL');
        assert.ok(Number.isFinite(Date.parse(entry.verifiedAt)), point.id + ' evidence date');
      }
      assert.ok(point.access.restrictions.length >= 1, point.id + ' lists a restriction');
      assert.ok(point.unknowns.length >= 4, point.id + ' lists its unknowns');
    }
  });

  test('a point is never a parcel centroid, and always sits inside its published area', () => {
    for (const point of points.points) {
      const parent = areas.areas.find(area => area.id === point.parentArea);
      assert.ok(parent, point.id + ' names a published parent area');
      assert.notStrictEqual(point.name, parent.name, point.id + ' is not simply the area renamed');
      assert.ok(point.coordinateSource && point.coordinateSource.kind, point.id + ' records its provenance');
      assert.ok(Number.isFinite(point.coordinateSource.estimatedPrecisionM), point.id + ' states a precision');
      const inside = point.coordinates.lat >= parent.boundary.bbox[1] && point.coordinates.lat <= parent.boundary.bbox[3] &&
        point.coordinates.lon >= parent.boundary.bbox[0] && point.coordinates.lon <= parent.boundary.bbox[2];
      assert.ok(inside, point.id + ' falls inside the mapped extent of ' + parent.id);
      // The area's own marker is not the point: the point must be a different place in the forest.
      const areaCentre = { lat: (parent.boundary.bbox[1] + parent.boundary.bbox[3]) / 2,
        lon: (parent.boundary.bbox[0] + parent.boundary.bbox[2]) / 2 };
      const apart = sites.distanceMetres(areaCentre, point.coordinates);
      assert.ok(apart > 1000, point.id + ' is ' + Math.round(apart) + ' m from the area centre');
    }
  });

  test('coordinate provenance distinguishes an agency marker from a third-party map', () => {
    const kyln = points.points.map(point => point.coordinateSource.kind);
    assert.ok(kyln.includes('agency-point-feature'), 'the campgrounds use the agency marker');
    assert.ok(kyln.includes('third-party-map'), 'the named overnight lot uses a mapped facility node');
    const lot = points.points.find(point => point.coordinateSource.kind === 'third-party-map');
    assert.match(lot.coordinateSource.detail, /names this facility but publishes no point/);
    assert.match(lot.coordinateSource.detail, /not an agency survey/);
    const agency = points.points.find(point => point.coordinateSource.kind === 'agency-point-feature');
    assert.match(agency.coordinateSource.detail, /not a surveyed point/);
    // No point claims a survey it does not have.
    for (const point of points.points) assert.ok(!/surveyed point is|survey grade/i.test(JSON.stringify(point)));
  });

  test('terrain is a bare-earth result per moment, and the core visibly moves', () => {
    for (const point of points.points) {
      assert.ok(['clear', 'marginal', 'obstructed', 'unknown'].includes(point.terrain.state), point.id + ' terrain state');
      assert.strictEqual(point.terrain.moments.length, 3, point.id + ' has three moments');
      const azimuths = point.terrain.moments.map(moment => moment.azimuthDeg);
      assert.ok(Math.max(...azimuths) - Math.min(...azimuths) > 1,
        point.id + ' the core changes azimuth during the window: ' + azimuths.join(', '));
      for (const moment of point.terrain.moments) {
        assert.ok(Number.isFinite(moment.horizonAngleDeg), point.id + ' horizon angle');
        assert.ok(Number.isFinite(moment.uncertaintyDeg) && moment.uncertaintyDeg >= 0.5, point.id + ' uncertainty');
        assert.ok(moment.altitudeDeg > moment.horizonAngleDeg, point.id + ' the core is above the modelled horizon');
      }
      assert.strictEqual(point.terrain.dem.source, 'usgs-3dep', point.id + ' used 3DEP');
      assert.ok(point.terrain.dem.pixelSizeM > 0 && point.terrain.dem.pixelSizeM < 100, point.id + ' pixel size');
      assert.match(point.terrain.note, /Bare-earth terrain only/);
      assert.match(point.terrain.note, /trees/i);
    }
  });

  test('the point carries its own astronomy, not the visitor\'s', () => {
    for (const point of points.points) {
      const core = point.core;
      assert.ok(Number.isFinite(core.windowStart) && Number.isFinite(core.windowEnd), point.id + ' window');
      assert.ok(core.windowEnd > core.windowStart, point.id + ' window runs forward');
      assert.ok(core.maxAltitudeDeg > 18 && core.maxAltitudeDeg < 90, point.id + ' core altitude');
      assert.ok(Number.isFinite(core.quality) && core.quality >= 0 && core.quality <= 100, point.id + ' quality bounds');
      assert.ok(core.minutes >= 20, point.id + ' window length');
      assert.strictEqual(point.timezone, 'America/Chicago', point.id + ' records its timezone rather than guessing');
      // The point's own coordinate is what the window was computed at: it is not the visitor's site.
      assert.ok(Number.isFinite(point.coordinates.lat) && Math.abs(point.coordinates.lat - 38.3553) > 0.001,
        point.id + ' is not the pilot origin');
    }
  });

  test('the refusals are preserved in the research inventory, with their reasons', () => {
    const byName = new Map(inventory.candidates.map(candidate => [candidate.sourceRecord.name, candidate]));
    const iron = byName.get('Illinois Iron Furnace Historic Site');
    assert.strictEqual(iron.decision, 'reject');
    assert.match(iron.decisionBasis, /No overnight parking/);
    const knob = byName.get('High Knob Lookout');
    assert.strictEqual(knob.decision, 'reject');
    assert.match(knob.decisionBasis, /Day-use only|living|outside the site/);
    const oakwood = byName.get('Oakwood Bottoms & Turkey Bayou Campground');
    assert.strictEqual(oakwood.decision, 'reject');
    assert.match(oakwood.decisionBasis, /closed due to flooding/);
    assert.strictEqual(inventory.counts.facilities, 33);
    assert.strictEqual(inventory.counts.publish, 6);
    assert.strictEqual(inventory.counts.reject, 4);
    // The three publishable facilities outside the studied region are not in the public artifact.
    for (const name of ['Pine Hills Campground', 'Bell Smith Springs Recreation Area', 'Panther Den Wilderness']) {
      assert.ok(!raw.includes(name), name + ' leaked into the public artifact');
    }
  });

  test('nothing forbidden is published, and no route or darkness is claimed', () => {
    for (const pattern of ['"parkingLot"', '"travelTime"', '"driveMinutes"', '"driveTime"', '"bortle"',
      '"skyBrightness"', '"mpsas"', '"radiance"', '"score"', '"rank"']) {
      assert.ok(!raw.includes(pattern), 'the artifact contains ' + pattern);
    }
    assert.ok(!/Bortle|mag\/arcsec|mcd/i.test(raw), 'no darkness rating');
    assert.ok(!/\bdriving distance\b|\bdrive time\b|\barrival time\b/i.test(raw), 'no drive claim');
    for (const point of points.points) {
      assert.strictEqual(point.sky.state, 'unavailable');
      assert.match(point.sky.message, /has not yet been assessed/);
    }
    assert.match(points.publication.rule, /An area rule alone is never inherited by a point/);
  });

  test('point access evidence expires in the browser exactly as an area\'s does', () => {
    assert.strictEqual(sites.isCurrent(points.points[0], NOW), true);
    assert.strictEqual(sites.isCurrent(points.points[0], NOW + 370 * 86400000), false);
    const call = (at) => {
      let captured = '';
      const fake = { set innerHTML(value) { captured = value; }, get innerHTML() { return captured; } };
      const result = sites.render(fake, { artifact: areas, points, origin: { lat: 38.3553, lon: -87.5675 }, now: at });
      return { ...result, html: captured };
    };
    const fresh = call(NOW);
    assert.strictEqual(fresh.points.length, 3);
    assert.strictEqual(fresh.pointsWithheld.length, 0);
    const aged = call(NOW + 400 * 86400000);
    assert.strictEqual(aged.points.length, 0);
    assert.strictEqual(aged.pointsWithheld.length, 3);
    assert.match(aged.html, /Withheld points: verification expired/);
    assert.match(aged.html, /No point currently has current verification/);
  });

  test('the generator reproduces the committed artifact byte for byte', () => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-geodata-points.mjs'), '--check'],
      { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, 'check failed: ' + result.stderr + result.stdout);
    assert.match(result.stdout, /PASS/);
  });

  test('a calendar export names the point, its own coordinates and no travel', () => {
    const Cal = require(path.join(root, 'overhead-calendar.js'));
    const point = points.points[0];
    const site = { lat: point.coordinates.lat, lon: point.coordinates.lon, tz: point.timezone, name: point.name };
    const event = { id: 'milkyway:milkyway:milky-way:milky-way-core:x:' + point.id, category: 'milkyway',
      sourceId: 'milky-way-core:' + point.id, title: 'Milky Way core at ' + point.name, start: point.core.windowStart,
      end: point.core.windowEnd, best: point.core.windowStart, precision: 'window', categoryPriority: point.core.quality,
      explanation: 'calculated at the point', warnings: ['weather is shown for your own location only'],
      source: 'Astronomy Engine', optical: 'camera' };
    const built = Cal.single({ event, source: { site } }, { now: NOW, site, timezone: point.timezone, clock: '12',
      scoreLabel: value => String(value) });
    assert.ok(built.eligible, built.reason);
    const text = built.ics.replace(/\r\n[ \t]/g, '');
    assert.ok(text.includes('LOCATION:' + point.name), 'the calendar entry names the point');
    assert.ok(text.includes('DTSTART:') && text.includes('DTEND:'), 'an interval');
    assert.ok(!/drive|travel time|departure/i.test(text.replace(/no travel|not a drive/gi, '')));
    assert.match(text, /Milky Way window quality/);
  });

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all observation-point checks passed');
})();
