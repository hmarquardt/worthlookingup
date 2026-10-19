/* Photography sessions: the record, the clearance, the guidance and the local storage.

   The session builder is presentation plus bookkeeping; the astronomy stays in the page and in the Milky Way
   engine. What is tested here is everything the builder itself decides: how a session is identified, what a
   saved plan may contain, how a horizon is interpolated between profile directions (against the research
   module, not against a copy of its arithmetic), what the camera guidance may and may not claim, and what
   happens when browser storage is full or a record is corrupt. No network access. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let failures = 0;
const test = (name, fn) => { try { fn(); console.log('ok   ' + name); }
  catch (error) { failures++; console.log('FAIL ' + name + '\n     ' + String(error && error.message || error)); } };
const root = path.join(__dirname, '..');
require(path.join(root, 'overhead-sessions.js'));
const S = globalThis.OverheadSessions;
const pointsArtifact = JSON.parse(fs.readFileSync(path.join(root, 'data', 'geodata', 'points.json'), 'utf8'));
const profile = pointsArtifact.points[0].terrain.profile;

/* A storage stub with a byte budget, so a full browser is a test and not a surprise. */
function fakeStorage(limit = Infinity) {
  const data = new Map();
  const used = () => [...data].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  return {
    data,
    get(key, fallback) { return data.has(key) ? JSON.parse(data.get(key)) : fallback; },
    set(key, value) {
      const text = JSON.stringify(value);
      const current = data.has(key) ? key.length + data.get(key).length : 0;
      if (used() - current + key.length + text.length > limit) return false;
      data.set(key, text); return true;
    },
  };
}

(async () => {
  test('the module stays small enough to load on demand', () => {
    const bytes = fs.statSync(path.join(root, 'overhead-sessions.js')).size;
    // Phase 6D added the forecast summary, the access comparison, the pre-departure list and the offline field
    // copy. It is still fetched only when a reader opens the builder: 64 kB raw is roughly 18 kB gzipped.
    assert.ok(bytes < 64 * 1024, 'module is ' + (bytes / 1024).toFixed(1) + ' kB');
  });

  test('session storage never shares a key with the saved site, settings or favourites', () => {
    const reserved = ['site', 'settings', 'favorites', 'theme'];
    for (const key of [S.LIST_KEY, S.CURRENT_KEY, S.CHECKLIST_KEY]) {
      assert.ok(!reserved.includes(key), key + ' collides with a preference key');
      assert.match(key, /^session\./);
    }
    assert.strictEqual(new Set([S.LIST_KEY, S.CURRENT_KEY, S.CHECKLIST_KEY]).size, 3);
  });

  test('notes lose control characters, keep their text and stop at the documented limit', () => {
    assert.strictEqual(S.sanitiseNotes('gate \u0007code \u001b[31m 7'), 'gate code [31m 7');
    assert.strictEqual(S.sanitiseNotes(null), '');
    assert.strictEqual(S.sanitiseNotes('x'.repeat(5000)).length, S.MAX_NOTES);
    const escaped = S.esc('<img src=x onerror=alert(1)>');
    assert.ok(!escaped.includes('<') && escaped.includes('&lt;img'), escaped);
  });

  test('one site and one night make one identity, and a different night makes another', () => {
    const a = S.sessionId('camp-cadiz-campground', '2027-04-13');
    assert.strictEqual(a, S.sessionId('camp-cadiz-campground', '2027-04-13'));
    assert.notStrictEqual(a, S.sessionId('camp-cadiz-campground', '2027-04-14'));
    assert.notStrictEqual(a, S.sessionId('tower-rock-campground', '2027-04-13'));
    assert.strictEqual(S.newSession({ siteKey: 'camp-cadiz-campground', date: '2027-04-13' }).id, a);
  });

  test('a saved record is normalised, an older shape is migrated and rubbish is refused', () => {
    const legacy = { date: '2027-04-13', siteKey: 'camp-cadiz-campground', notes: 'keep me',
      window: { start: 1, end: 2, minutes: 60, level: 'astronomical' } };
    const migrated = S.migrate(legacy);
    assert.strictEqual(migrated.ok, true);
    assert.strictEqual(migrated.migrated, true);
    assert.strictEqual(migrated.session.schema, S.SCHEMA);
    assert.strictEqual(migrated.session.notes, 'keep me');
    assert.strictEqual(migrated.session.date, '2027-04-13');
    assert.strictEqual(S.migrate({ schema: 'something/9' }).ok, false);
    assert.strictEqual(S.migrate('a string').ok, false);
    const unreadable = S.normalise({ schema: S.SCHEMA, date: 'not-a-date', site: { lat: 'x', lon: 2 } });
    assert.strictEqual(unreadable.date, null, 'an unparseable date is dropped rather than guessed');
    assert.strictEqual(unreadable.site, null, 'a site without numbers is dropped rather than guessed');
  });

  test('the saved list is newest first, bounded, de-duplicated by identity and survives a full disk', () => {
    const storage = fakeStorage();
    for (let day = 1; day <= 14; day++) {
      const date = '2027-04-' + String(day).padStart(2, '0');
      const session = S.newSession({ siteKey: 'camp-cadiz-campground', date, notes: 'night ' + day });
      session.updatedAt = Date.parse(date + 'T12:00:00Z');
      assert.strictEqual(S.put(storage, session).ok, true);
    }
    const listed = S.listFrom(storage);
    assert.strictEqual(listed.sessions.length, S.MAX_SESSIONS);
    assert.strictEqual(listed.sessions[0].date, '2027-04-14', 'the newest plan is first');
    // Saving the same site and night again updates one entry instead of adding a second.
    const again = S.newSession({ siteKey: 'camp-cadiz-campground', date: '2027-04-14', notes: 'edited' });
    again.updatedAt = Date.parse('2027-04-15T12:00:00Z');
    const replaced = S.put(storage, again);
    assert.strictEqual(replaced.sessions.filter(entry => entry.id === again.id).length, 1);
    assert.strictEqual(S.remove(storage, again.id).some(entry => entry.id === again.id), false);
    const full = fakeStorage(200);
    const refused = S.put(full, S.newSession({ siteKey: 'somewhere', date: '2027-04-13' }));
    assert.strictEqual(refused.ok, false);
    assert.match(refused.reason, /full|blocked/);
    assert.deepStrictEqual(S.listFrom(fakeStorage()).sessions, []);
  });

  test('a corrupt entry is skipped and the rest of the list still opens', () => {
    const storage = fakeStorage();
    const good = S.newSession({ siteKey: 'camp-cadiz-campground', date: '2027-04-13' });
    S.put(storage, good);
    const raw = JSON.parse(storage.data.get(S.LIST_KEY));
    raw.unshift({ schema: 'unknown/0' });
    storage.data.set(S.LIST_KEY, JSON.stringify(raw));
    const listed = S.listFrom(storage);
    assert.strictEqual(listed.ok, true);
    assert.strictEqual(listed.sessions.length, 1);
    assert.strictEqual(listed.skipped, 1);
  });

  test('the checklist defaults to unticked, keeps a tick and ignores unknown ids', () => {
    const storage = fakeStorage();
    const defaults = S.readChecklist(storage);
    assert.ok(Object.keys(defaults).length >= 10);
    assert.ok(Object.values(defaults).every(value => value === false));
    storage.set(S.CHECKLIST_KEY, { camera: true, notAnItem: true });
    const stored = S.readChecklist(storage);
    assert.strictEqual(stored.camera, true);
    assert.strictEqual('notAnItem' in stored, false);
    assert.strictEqual(stored.tripod, false);
  });

  test('the clearance matches the research module at sampled and interpolated directions', async () => {
    const terrain = await import(pathToFileURL(path.join(root, 'src', 'geodata', 'terrain-horizon.mjs')).href);
    const research = { azimuths: profile.map(entry => ({ azimuthDeg: entry.azimuthDeg, maxAngleDeg: entry.horizonAngleDeg,
      maxAtM: entry.maxAtM, coverage: entry.coverage, status: entry.status, roughnessM: 0 })) };
    for (const azimuth of [0, 22.5, 45, 90, 123.4, 158.51, 180, 270, 337.5, 359.9]) {
      const mine = S.horizonAt(profile, azimuth);
      const theirs = terrain.horizonAtAzimuth(research, azimuth);
      assert.ok(Math.abs(mine.horizonAngleDeg - theirs.horizonAngleDeg) < 1e-9,
        'azimuth ' + azimuth + ': ' + mine.horizonAngleDeg + ' vs ' + theirs.horizonAngleDeg);
    }
    // Across the north seam the neighbours are 337.5 and 0, not 337.5 and 360: the interpolation weight is right.
    const seam = S.horizonAt(profile, 350);
    assert.deepStrictEqual(seam.neighbours, [337.5, 0]);
  });

  test('clearance is clear, obstructed or unknown, and never a guess without a profile', async () => {
    const terrain = await import(pathToFileURL(path.join(root, 'src', 'geodata', 'terrain-horizon.mjs')).href);
    const research = { azimuths: profile.map(entry => ({ azimuthDeg: entry.azimuthDeg, maxAngleDeg: entry.horizonAngleDeg,
      maxAtM: entry.maxAtM, coverage: entry.coverage, status: entry.status, roughnessM: 0 })) };
    for (const azimuth of [0, 45, 158.51, 180, 270]) {
      const mine = S.clearance(profile, azimuth, 40);
      const theirs = terrain.clearanceFor(research, { azimuthDeg: azimuth, altitudeDeg: 40 });
      assert.strictEqual(mine.state, theirs.status, 'azimuth ' + azimuth);
    }
    assert.strictEqual(S.clearance(profile, 180, 0.1).state, 'obstructed');
    assert.strictEqual(S.clearance(null, 180, 20).state, 'unavailable');
    assert.match(S.clearance(null, 180, 20).reason, /no terrain profile/);
  });

  test('the guidance refuses to invent an exposure without equipment, and says so', () => {
    const unknown = S.cameraGuidance({});
    assert.strictEqual(unknown.unknown, true);
    assert.strictEqual(unknown.exposure, null);
    assert.ok(unknown.assumptions[0].includes('No camera or lens was given'));
    assert.ok(unknown.lines.length >= 3, 'the unknown path is still useful');
    assert.ok(!/second|exposure time of/i.test(unknown.lines.join(' ')), 'no duration is suggested');
  });

  test('the 500-rule family is arithmetic on the visitor\'s own numbers, labelled as a rule of thumb', () => {
    const apsc = S.cameraGuidance({ sensor: 'aps-c', focalLength: 24, aperture: 2.8 });
    assert.strictEqual(apsc.exposure.fullFrameEquivalentMm, 36);
    assert.strictEqual(apsc.exposure.fiveHundredSeconds, 13.9);
    assert.strictEqual(apsc.exposure.sharpSeconds, 8.3);
    const joined = apsc.assumptions.join(' ');
    assert.ok(/rules? of thumb/.test(joined), joined);
    assert.ok(/pixel pitch/i.test(joined));
    assert.ok(/declination/i.test(joined));
    assert.ok(joined.includes('f/2.8'));
    const tracked = S.cameraGuidance({ sensor: 'full-frame', focalLength: 24, tracker: true });
    assert.strictEqual(tracked.exposure, null, 'a tracker removes the trailing limit');
    assert.ok(tracked.assumptions.join(' ').includes('tracking mount'));
    const odd = S.cameraGuidance({ sensor: 'unknown', focalLength: 24 });
    assert.strictEqual(odd.exposure, null, 'an unknown crop factor cannot produce a duration');
  });

  test('the builder renders the six steps and escapes everything a visitor typed', () => {
    const html = S.render({ state: { when: 'custom', date: '2027-04-13', where: 'home', notes: '<script>bad()</script>',
      camera: { sensor: 'aps-c', focalLength: 24 } }, todayISO: '2026-10-15', maxDateISO: '2027-10-15',
      dates: [{ id: 'tonight', label: 'Tonight', detail: 'Thursday, October 15, 2026' }], points: [],
      home: { name: 'Princeton, Indiana' }, conditions: null, checklist: { camera: true },
      guidance: S.cameraGuidance({ sensor: 'aps-c', focalLength: 24 }), saved: [], notice: null, session: null });
    for (const heading of ['When', 'Where', 'Conditions at', 'Before you leave', 'Prepare', 'Save or export']) {
      assert.ok(html.includes(heading), 'missing step: ' + heading);
    }
    assert.ok(!html.includes('<script>bad()'), 'notes are escaped');
    assert.ok(html.includes('&lt;script&gt;bad()'), 'notes survive as text');
    assert.ok(html.includes('data-session="save"'));
    assert.ok(html.includes('My saved location'));
    assert.ok(html.includes('name="viewport"') === false);
  });

  test('a night with no window cannot be saved, and the builder says why', () => {
    const html = S.render({ state: { when: 'custom', date: '2026-10-20', where: 'home', notes: '', camera: {} },
      todayISO: '2026-10-15', maxDateISO: '2027-10-15', dates: [], points: [], home: { name: 'Princeton' },
      checklist: {}, guidance: S.cameraGuidance({}), saved: [],
      conditions: { siteName: 'Camp Cadiz Campground', dateLabel: 'Tuesday, October 20, 2026',
        why: { headline: 'No qualifying Galactic-core window at this place on this date.', detail: 'the core is low' } } });
    assert.ok(html.includes('No qualifying Galactic-core window at this place on this date.'));
    assert.ok(html.includes('data-session="save" disabled'), 'the save button is disabled');
    assert.ok(html.includes('data-session="print" disabled'));
  });

  test('the forecast summary uses the hours of this window, and leaves absent series absent', () => {
    const start = Date.parse('2027-04-10T20:00:00Z');
    const hourly = { time: [], cloud_cover: [], precipitation_probability: [], temperature_2m: [],
      wind_speed_10m: [], wind_gusts_10m: [],
      units: { temperature_2m: '°C', wind_speed_10m: 'km/h', precipitation_probability: '%' } };
    for (let hour = 0; hour < 24; hour++) {
      hourly.time.push(Math.floor((start + hour * 3600000) / 1000));
      hourly.cloud_cover.push(hour < 2 ? 90 : 10 + hour);
      hourly.precipitation_probability.push(hour);
      hourly.temperature_2m.push(5 + hour / 10);
      hourly.wind_speed_10m.push(hour);
      hourly.wind_gusts_10m.push(hour * 2);
    }
    const window = { start: start + 3 * 3600000, end: start + 6 * 3600000 };
    const summary = S.weatherSummary(hourly, window);
    assert.strictEqual(summary.hours, 4, 'four hourly rows fall inside the window');
    assert.strictEqual(summary.cloud.value, 14.5, 'only the four hours inside the window are averaged');
    assert.strictEqual(summary.cloud.min, 13);
    assert.strictEqual(summary.cloud.max, 16);
    assert.strictEqual(summary.precipitation.value, 6, 'rain chance is the maximum, not a mean');
    assert.strictEqual(summary.wind.value, 6);
    assert.strictEqual(summary.gust.value, 12);
    assert.strictEqual(summary.temperature.min, 5.3);
    assert.strictEqual(summary.units.temperature, '°C');
    // A provider answer without wind produces no wind, not a zero that reads as still air.
    const withoutWind = S.weatherSummary({ time: hourly.time, cloud_cover: hourly.cloud_cover }, window);
    assert.strictEqual(withoutWind.wind, null);
    assert.strictEqual(withoutWind.cloud.value, 14.5);
    assert.strictEqual(S.weatherSummary(hourly, { start: start + 40 * 3600000, end: start + 41 * 3600000 }).hours, 0);
    assert.strictEqual(S.weatherSummary(null, window).hours, 0);
    assert.strictEqual(S.weatherSummary(hourly, null).hours, 0);
  });

  test('a forecast is only quoted inside the provider horizon, and never for a past night', () => {
    const now = Date.parse('2027-04-10T18:00:00Z');
    assert.strictEqual(S.forecastHorizon(now, now + 3 * 86400000, 9).status, 'within');
    assert.strictEqual(S.forecastHorizon(now, now + 10 * 86400000, 9).status, 'beyond');
    assert.strictEqual(S.forecastHorizon(now, now - 3 * 86400000, 9).status, 'past');
    assert.strictEqual(S.forecastHorizon(now, NaN, 9).status, 'unknown');
  });

  const EVIDENCE = { verifiedAt: '2026-10-18', access: { nightPresence: 'verified', parking: 'verified-at-designated-campsite',
    classification: 'verified-night-access', summary: 'Camping is permitted.', verifiedAt: '2026-10-18',
    evidence: [{ verifiedAt: '2026-10-18', quote: 'Camp only at designated campsites.' }],
    restrictions: [{ text: 'Quiet hours 10 p.m. to 6 a.m.' }] } };
  const currentPoint = () => ({ id: 'camp-cadiz-campground', verifiedAt: '2026-10-18',
    access: JSON.parse(JSON.stringify(EVIDENCE.access)) });

  test('saved and current access records are compared field by field, and the saved copy is never rewritten', () => {
    const saved = JSON.parse(JSON.stringify(EVIDENCE));
    const same = S.compareAccess(saved, currentPoint(), Date.parse('2027-04-01T00:00:00Z'));
    assert.strictEqual(same.status, 'current');
    assert.deepStrictEqual(same.changes, []);
    assert.strictEqual(saved.access.parking, 'verified-at-designated-campsite', 'the saved record is untouched');
    const changedPoint = currentPoint();
    changedPoint.access.parking = 'unknown';
    const changed = S.compareAccess(saved, changedPoint, Date.parse('2027-04-01T00:00:00Z'));
    assert.strictEqual(changed.status, 'changed');
    assert.ok(changed.changes.some(change => change.field === 'parking' && change.current === 'unknown'));
    const restricted = currentPoint();
    restricted.access.restrictions.push({ text: 'Gate locked 9 p.m. to 7 a.m.' });
    const restrictedResult = S.compareAccess(saved, restricted, Date.parse('2027-04-01T00:00:00Z'));
    assert.ok(restrictedResult.changes.some(change => change.field === 'restrictions'), 'a new restriction is a change');
    assert.strictEqual(S.compareAccess(saved, null, Date.now()).status, 'withheld');
    const old = currentPoint();
    old.access.verifiedAt = '2024-01-01';
    assert.strictEqual(S.compareAccess(saved, old, Date.parse('2027-04-01T00:00:00Z')).status, 'expired');
  });

  test('the fingerprint follows the evidence that matters and nothing else', () => {
    const base = S.evidenceFingerprint(EVIDENCE);
    assert.strictEqual(base, S.evidenceFingerprint(JSON.parse(JSON.stringify(EVIDENCE))));
    const other = JSON.parse(JSON.stringify(EVIDENCE));
    other.access.parking = 'verified';
    assert.notStrictEqual(S.evidenceFingerprint(other), base);
    const restriction = JSON.parse(JSON.stringify(EVIDENCE));
    restriction.access.restrictions[0].text = 'Gate locked at dusk.';
    assert.notStrictEqual(S.evidenceFingerprint(restriction), base);
    const note = JSON.parse(JSON.stringify(EVIDENCE));
    note.access.operatingSeason = 'summer only';
    note.unrelated = 'a field the plan does not depend on';
    assert.strictEqual(S.evidenceFingerprint(note), base, 'a field the plan does not depend on does not change the digest');
    assert.strictEqual(S.evidenceFingerprint(null), null);
  });

  test('the pre-departure list is unticked by default, keeps a tick and ignores unknown ids', () => {
    const storage = fakeStorage();
    const fresh = S.readReadiness(storage);
    assert.ok(Object.keys(fresh).length >= 6);
    assert.ok(Object.values(fresh).every(value => value === false));
    storage.set(S.READINESS_KEY, { parking: true, notAnItem: true });
    const stored = S.readReadiness(storage);
    assert.strictEqual(stored.parking, true);
    assert.strictEqual('notAnItem' in stored, false);
    assert.notStrictEqual(S.READINESS_KEY, S.CHECKLIST_KEY);
  });

  test('a saved record keeps its readiness state and its evidence fingerprint through a round trip', () => {
    const record = S.newSession({ siteKey: 'camp-cadiz-campground', date: '2027-04-13',
      evidenceRef: { ...EVIDENCE, fingerprint: S.evidenceFingerprint(EVIDENCE) }, readiness: { parking: true },
      checklist: { tripod: true }, notes: 'keep' });
    assert.strictEqual(record.readiness.parking, true);
    assert.strictEqual(record.evidenceRef.fingerprint, S.evidenceFingerprint(EVIDENCE));
    const stored = S.migrate(JSON.parse(JSON.stringify(record)));
    assert.strictEqual(stored.session.readiness.parking, true);
    assert.strictEqual(stored.session.notes, 'keep');
    // An older record without these fields still opens, with empty values rather than undefined ones.
    const legacy = S.migrate({ date: '2027-04-13', siteKey: 'camp-cadiz-campground' });
    assert.deepStrictEqual(legacy.session.readiness, {});
  });

  test('the offline field copy is one self-contained file, with no script and every fact the page shows', () => {
    const record = S.newSession({ siteKey: 'camp-cadiz-campground', date: '2027-04-13',
      site: { name: 'Camp Cadiz Campground', lat: 37.57834, lon: -88.24417, tz: 'America/Chicago' },
      pointId: 'camp-cadiz-campground',
      window: { start: Date.parse('2027-04-14T06:00:00Z'), end: Date.parse('2027-04-14T08:00:00Z'), minutes: 120, level: 'astronomical' },
      core: { bestTime: Date.parse('2027-04-14T07:30:00Z'), bestAltitudeDeg: 22.7, maxAltitudeDeg: 22.7,
        maxAzimuthDeg: 169.6, maxCompass: 'S' },
      moon: { classification: 'moon-below-horizon', detail: 'the Moon is below the horizon' },
      darkness: { achieved: 'astronomical', minutes: { astronomical: 300 } }, quality: 72,
      terrain: { state: 'clear', azimuthDeg: '169.6', horizonAngleDeg: '1.2', differenceDeg: '21.5', uncertaintyDeg: '0.6', dem: '3DEP ~31 m' },
      checklist: { tripod: true }, readiness: { rules: true }, notes: 'Gate code is on the board.\nBring the red light.',
      limitations: ['local artificial sky brightness has not been assessed here'],
      evidenceRef: { ...EVIDENCE, fingerprint: S.evidenceFingerprint(EVIDENCE) } });
    const html = S.offlinePlanHTML(record, { conditions: {
      forecast: { label: 'Forecast unavailable', whenLabel: 'fetched 20m ago', rows: [['Cloud cover', '30% (10-60%)'], ['Wind', 'up to 11 km/h']],
        lastKnown: { label: 'Last forecast saved with this plan', whenLabel: 'fetched 2h before this plan was saved', tag: 'saved', rows: [['Cloud cover', '35% (20-60%)']] } },
      access: { label: 'Published access evidence', status: 'current', verifiedAt: '2026-10-18',
        officialUrl: 'https://www.fs.usda.gov/r09/shawnee/recreation/camping-cabins',
        savedShort: 'verified · parking verified at designated campsite',
        changes: [{ field: 'parking', saved: 'unknown', current: 'verified' }] } } });
    assert.strictEqual((html.match(/<script/g) || []).length, 0, 'no script of any kind');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /Camp Cadiz Campground/);
    assert.match(html, /Observing window/);
    assert.match(html, /Best moment/);
    assert.match(html, /Cloud cover: 30%/);
    assert.match(html, /fetched 20m ago/);
    assert.match(html, /Last-known forecast/);
    assert.match(html, /Last forecast saved with this plan/);
    assert.match(html, /saved with the plan, not current/);
    assert.match(html, /Access at planning time/);
    assert.match(html, /Official source/);
    assert.match(html, /Still to do before leaving/);
    assert.match(html, /Confirm parking or campsite eligibility/);
    assert.match(html, /Gate code is on the board/);
    assert.match(html, /nothing here is a permission[^.]*promise of a photograph/i);
    assert.match(html, /Unresolved/);
    assert.ok(!/undefined|\[object Object\]/.test(html), 'no undefined or stringified object leaks into the file');
  });

  test('nothing in the builder invents brightness, seeing, transparency or travel', () => {
    const source = fs.readFileSync(path.join(root, 'overhead-sessions.js'), 'utf8').toLowerCase();
    for (const forbidden of ['bortle', 'mag/arcsec', 'drive time', 'travel time', 'departure time']) {
      assert.ok(!source.includes(forbidden), 'module mentions ' + forbidden);
    }
    assert.ok(!/skybrightness\s*[:=]\s*\d/.test(source), 'no numeric sky brightness is produced');
  });

  console.log(failures ? '\nFAILURES: ' + failures : '\nPASS: photography sessions — record, clearance, guidance, storage and the refusal to invent');
  process.exit(failures ? 1 : 0);
})();
