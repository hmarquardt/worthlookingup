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
    assert.ok(bytes < 36 * 1024, 'module is ' + (bytes / 1024).toFixed(1) + ' kB');
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

  test('the builder renders the five steps and escapes everything a visitor typed', () => {
    const html = S.render({ state: { when: 'custom', date: '2027-04-13', where: 'home', notes: '<script>bad()</script>',
      camera: { sensor: 'aps-c', focalLength: 24 } }, todayISO: '2026-10-15', maxDateISO: '2027-10-15',
      dates: [{ id: 'tonight', label: 'Tonight', detail: 'Thursday, October 15, 2026' }], points: [],
      home: { name: 'Princeton, Indiana' }, conditions: null, checklist: { camera: true },
      guidance: S.cameraGuidance({ sensor: 'aps-c', focalLength: 24 }), saved: [], notice: null, session: null });
    for (const heading of ['When', 'Where', 'Conditions at', 'Prepare', 'Save or export']) {
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

  console.log(failures ? '\nFAILURES: ' + failures : '\nPASS: photography sessions — record, clearance, guidance, storage and the refusal to invent');
  process.exit(failures ? 1 : 0);
})();
