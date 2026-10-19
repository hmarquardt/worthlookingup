/* Phase 7A: deterministic tests for the object-specific difficulty model. These are product heuristics,
   not a limiting-magnitude calculation. Run: node tests/equipment-difficulty.cjs */
const assert = require('node:assert/strict');
const path = require('node:path');
require(path.join(__dirname, '..', 'overhead-difficulty.js'));
const D = globalThis.OverheadDifficulty;
let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log('ok   ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name + '\n     ' + error.message); }
};
const comet = (overrides = {}) => ({
  measured: { magnitude: 13.7, date: '2026-10-18T19:40:48Z', method: 'CCD', median30d: 13.3,
    observerCount: 1, trend: { direction: 'brightening', magnitudesPerDay: -0.0361 } },
  measurementAgeDays: 1, altitudeDeg: 64, darknessAchieved: 'astronomical',
  coma: { value: 1.2, unit: null, unitVerified: false }, ...overrides,
});
const profile = (types, extra = {}) => D.normaliseProfile({ types, ...extra });

test('a magnitude-13.7 comet is an advanced visual target, not an easy one', () => {
  const a = D.assessComet(comet());
  assert.equal(a.type, 'comet');
  assert.equal(a.visual.level, 5);
  assert.equal(a.visual.label, 'Advanced');
  assert.match(a.visual.detail, /diffuse|total magnitude/i);
  assert.equal(a.surfaceBrightness, null);
});

test('a magnitude-14.5 comet is also advanced and never sold as easy', () => {
  const a = D.assessComet(comet({ measured: { magnitude: 14.5, date: '2026-10-17T00:00:00Z', method: 'CCD', median30d: 14.2 } }));
  assert.equal(a.visual.level, 5);
  assert.notEqual(a.visual.label, 'Easy');
});

test('a magnitude-14.3 comet is also advanced, matching the conservative comet tier', () => {
  const a = D.assessComet(comet({ measured: { magnitude: 14.3, date: '2026-10-17T00:00:00Z', method: 'CCD', median30d: 14.1 } }));
  assert.equal(a.visual.level, 5);
  assert.notEqual(a.visual.label, 'Easy');
});

test('a bright comet can be accessible, but never guarantee naked-eye detection', () => {
  const a = D.assessComet(comet({ measured: { magnitude: 4.0, date: '2026-10-18T00:00:00Z', method: 'VISUAL', median30d: 4.2 }, measurementAgeDays: 1 }));
  assert.ok(a.visual.level <= 2);
  assert.ok(!/guarantee|will see|definitely/i.test(JSON.stringify(a)));
});

test('a diffuse comet is not treated like a point-source star of the same magnitude', () => {
  const c = D.assessComet(comet({ measured: { magnitude: 10.6, date: '2026-10-18T00:00:00Z', method: 'VISUAL', median30d: 10.6 }, measurementAgeDays: 1 }));
  const planet = D.assessPlanet({ name: 'Jupiter', magnitude: 10, angularDiameterArcsec: 40 });
  assert.equal(c.type, 'comet');
  assert.equal(planet.type, 'planet');
  assert.notEqual(c.visual.level, planet.visual.level);
  assert.ok(c.reasons.some(text => /diffuse|spread over a coma/i.test(text)));
});

test('recent and stale photometry carry different confidence', () => {
  const recent = D.assessComet(comet({ measurementAgeDays: 2 }));
  const stale = D.assessComet(comet({ measurementAgeDays: 120 }));
  assert.equal(recent.visual.confidence.level, 'high');
  assert.equal(stale.visual.confidence.level, 'low');
  assert.ok(stale.limitations.some(text => /more than a month old/i.test(text)));
});

test('a measured/predicted disagreement is reported, not resolved by fiat', () => {
  const a = D.assessComet(comet({ predicted: { magnitude: 10.0 } }));
  assert.ok(a.limitations.some(text => /differ by .* mag/i.test(text)));
  assert.equal(a.surfaceBrightness, null);
});

test('an unverified coma unit never becomes a surface-brightness estimate', () => {
  const a = D.assessComet(comet({ coma: { value: 1.2, unit: 'arcmin', unitVerified: false } }));
  assert.equal(a.surfaceBrightness, null);
  assert.ok(a.limitations.some(text => /unit is not verified/i.test(text)));
  assert.ok(!/surface brightness of .*mag/i.test(JSON.stringify(a)));
});

test('a missing magnitude produces uncertainty, not a fabricated tier', () => {
  const a = D.assessComet({ measured: null, predicted: null, measurementAgeDays: null });
  assert.equal(a.visual.level, null);
  assert.equal(a.visual.label, 'Difficulty uncertain');
  assert.equal(a.evidence, 'missing');
  assert.equal(a.surfaceBrightness, null);
});

test('lower altitude and missing astronomical darkness make the same comet harder', () => {
  const high = D.assessComet(comet({ measured: { magnitude: 8, date: '2026-10-18T00:00:00Z', method: 'VISUAL', median30d: 8 }, measurementAgeDays: 1, altitudeDeg: 60 }));
  const low = D.assessComet(comet({ measured: { magnitude: 8, date: '2026-10-18T00:00:00Z', method: 'VISUAL', median30d: 8 }, measurementAgeDays: 1, altitudeDeg: 10, darknessAchieved: 'nautical' }));
  assert.ok(low.visual.level > high.visual.level);
});

test('visual and imaging difficulty are separate for a moderately faint comet', () => {
  const a = D.assessComet(comet({ measured: { magnitude: 11, date: '2026-10-18T00:00:00Z', method: 'VISUAL', median30d: 11 }, measurementAgeDays: 1 }));
  assert.ok(a.visual.level > a.imaging.level);
  assert.match(a.imaging.detail, /tracked|camera|exposure/i);
});

test('a small telescope and a large telescope receive different qualified guidance', () => {
  const base = D.assessComet(comet());
  const small = D.applyProfile(base, profile({ telescope: true }, { telescope: { apertureMm: 80 } }));
  const middle = D.applyProfile(base, profile({ telescope: true }, { telescope: { apertureMm: 150 } }));
  const large = D.applyProfile(base, profile({ telescope: true }, { telescope: { apertureMm: 250 } }));
  assert.equal(small.status, 'not-suitable');
  assert.equal(middle.status, 'challenging');
  assert.equal(large.status, 'possible');
  assert.ok(!/guarantee|will show/i.test(JSON.stringify([small, middle, large])));
});

test('a smart telescope receives imaging-oriented guidance for a faint comet', () => {
  const fit = D.applyProfile(D.assessComet(comet()), profile({ smartTelescope: true }));
  assert.equal(fit.status, 'possible');
  assert.match(fit.label + ' ' + fit.detail, /imaging|exposure/i);
});

test('binoculars are useful for the sky but not for a faint comet', () => {
  const base = D.assessComet(comet());
  const fit = D.applyProfile(base, profile({ binoculars: true }, { binoculars: { magnification: 10, objectiveMm: 50 } }));
  assert.equal(fit.status, 'not-suitable');
  assert.match(fit.detail, /beyond the range|not .*instrument/i);
});

test('no equipment profile still receives a useful explanation', () => {
  const a = D.assessComet(comet());
  assert.equal(a.profileFit.status, 'no-profile');
  assert.match(a.profileFit.detail, /Add your equipment/i);
  assert.ok(a.visual.detail.length > 20);
});

test('a bright planet and a faint comet receive different guidance', () => {
  const planet = D.assessPlanet({ name: 'Jupiter', magnitude: -2.4, angularDiameterArcsec: 48, altitudeDeg: 40 });
  const faint = D.assessComet(comet());
  assert.ok(planet.visual.level < faint.visual.level);
  assert.ok(planet.visual.level <= 2);
  assert.equal(faint.visual.level, 5);
  assert.notEqual(planet.equipment.primary, faint.equipment.primary);
});

test('planetary angular size changes the detail tier', () => {
  const jupiter = D.assessPlanet({ name: 'Jupiter', magnitude: -2.4, angularDiameterArcsec: 48 });
  const mars = D.assessPlanet({ name: 'Mars', magnitude: 0.5, angularDiameterArcsec: 6 });
  assert.ok(D.angularDiameterArcsec('Jupiter', 4) > D.angularDiameterArcsec('Mars', 1));
  assert.ok(mars.visual.level >= jupiter.visual.level);
});

test('meteor showers prefer naked-eye wide-field observation', () => {
  const a = D.assessMeteor({ zhr: 100, radiantAltitudeDeg: 60 });
  assert.equal(a.visual.level, 1);
  assert.equal(a.equipment.primary, 'naked-eye');
  assert.ok(a.limitations.some(text => /binoculars and telescopes narrow the field/i.test(text)));
  const fit = D.applyProfile(a, profile({ telescope: true }));
  assert.equal(fit.status, 'not-suitable');
});

test('satellites distinguish naked-eye passes from telescope tracking', () => {
  const a = D.assessSatellite({ brightness: 0.95, peakAltitudeDeg: 60, durationSeconds: 300 });
  assert.equal(a.visual.level, 1);
  assert.ok(a.limitations.some(text => /high-magnification telescope/i.test(text)));
  const fit = D.applyProfile(a, profile({ telescope: true }));
  assert.equal(fit.status, 'challenging');
});

test('the Milky Way recommends a wide-field camera, not a telescope', () => {
  const a = D.assessMilkyWay({ coreAltitudeDeg: 25, darknessAchieved: 'astronomical' });
  assert.equal(a.equipment.primary, 'camera-widefield');
  const camera = D.applyProfile(a, profile({ camera: true }, { camera: { sensor: 'aps-c', focalLengthMm: 24 } }));
  assert.equal(camera.status, 'suitable');
  const telescope = D.applyProfile(a, profile({ telescope: true }));
  assert.equal(telescope.status, 'not-suitable');
});

test('a solar eclipse requires a certified filter and cannot verify it', () => {
  const a = D.assessEclipse({ solar: true });
  assert.equal(a.equipment.primary, 'solar-filter');
  assert.ok(a.limitations.some(text => /cannot verify/i.test(text)));
});

test('unknown object types return uncertainty rather than a universal magnitude rule', () => {
  const a = D.assessGeneric({ magnitude: 8 });
  assert.equal(a.visual.level, null);
  assert.equal(a.visual.label, 'Difficulty uncertain');
  assert.match(a.limitations[0], /general magnitude threshold/i);
});


test('assessing an opportunity never mutates it or changes its score', () => {
  const opportunity = { category: 'comets', type: 'comet', objects: ['C/2026 A2 (Bok)'], best: Date.parse('2026-10-19T00:00:00Z'),
    positions: [{ name: 'C/2026 A2 (Bok)', altitude: 64, geoDistanceAu: 1.6 }],
    observing: { value: 83 }, attributes: { measuredBrightness: { magnitude: 13.7, date: '2026-10-18T00:00:00Z', method: 'CCD' }, predictedBrightness: { magnitude: 13.74 }, altitudeAtBest: 64, darknessAchieved: 'astronomical' } };
  const before = JSON.stringify(opportunity);
  const a = D.assessOpportunity(opportunity);
  assert.equal(JSON.stringify(opportunity), before);
  assert.equal(opportunity.observing.value, 83);
  assert.equal(a.visual.level, 5);
  assert.ok(!Object.prototype.hasOwnProperty.call(a, 'observing'));
});

test('the profile is normalised, migrates a legacy kind and refuses malformed values', () => {
  const p = D.normaliseProfile({ kind: 'telescope', telescope: { apertureMm: '150' } });
  assert.equal(p.types.telescope, true);
  assert.equal(p.telescope.apertureMm, 150);
  const bad = D.normaliseProfile({ types: { binoculars: true }, binoculars: { magnification: 'not a number', objectiveMm: 9999 } });
  assert.equal(bad.binoculars.magnification, null);
  assert.equal(bad.binoculars.objectiveMm, null);
  const empty = D.normaliseProfile(null);
  assert.equal(D.profileHasAny(empty), false);
  assert.equal(D.profileSummary(empty), 'No equipment profile');
});

test('a complete profile summary reports binoculars, telescope and camera details', () => {
  const p = D.normaliseProfile({ types: { binoculars: true, telescope: true, camera: true },
    binoculars: { magnification: 10, objectiveMm: 50 }, telescope: { apertureMm: 150 },
    camera: { sensor: 'aps-c', focalLengthMm: 24, aperture: 2.8, tracking: true } });
  const summary = D.profileSummary(p);
  assert.match(summary, /Binoculars 10×50/);
  assert.match(summary, /150 mm telescope/);
  assert.match(summary, /Camera/);
});

console.log(failures ? '\nFAILURES: ' + failures : '\nPASS: equipment difficulty — conservative, object-specific and score-independent');
process.exit(failures ? 1 : 0);

