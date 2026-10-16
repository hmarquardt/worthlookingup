/* The mission-direction evidence contract (Phase 5C).

   This is a data contract, not a capability. Nothing in the product imports this module yet, and passing
   it is explicitly *not* permission to show a direction: it exists so that a future phase can recognise
   the difference between a direction a mission's operator published and a heading somebody derived, and
   so that the weaker kinds of evidence can be refused by machine rather than by memory.

   The five classes, in descending order of strength, are the whole point:

     1 published-mission-direction        the operator or a range authority published this mission's ascent
                                          direction, in a documented frame.
     2 reconstructed-mission-direction    derived from this mission's own evidence (for example an
                                          instrumented photograph analysis), with a method and uncertainty.
     3 physically-constrained-direction   bounded by something real - an inclination, a hazard area, a
                                          corridor - but never observed as a flown heading.
     4 vehicle-family-analogy             how this vehicle class has flown before, from this pad or any other.
     5 pad-bearing-only                   where the pad points, which is not where the rocket went.

   Only classes 1 and 2 may ever be candidates for an upcoming mission's ascent sector, and only when the
   record validates, carries at least one genuinely independent corroborating source, is not expired, and
   its provenance is not ambiguous. A class-3 record is a *constraint*: it may bound the range a reader
   could consider, and it may never be presented as the direction of flight. Classes 4 and 5 exist so
   those claims have a name and a refusal, not so they can be dressed up as evidence.

   Two rules that the validator enforces mechanically, because they are the mistakes most easily made:
   * A heading derived from an orbital inclination may only be class 3. The derived heading is not
     independent corroboration of the inclination it was derived from, so it can never support a claim
     about how a particular vehicle actually flew.
   * A hazard area or launch corridor may only be class 3, and must carry its limitation in writing. A
     hazard polygon is not a flight path.

   Pure module: no DOM, no storage, no network. See docs/mission-direction-evidence.md for the research
   findings this contract encodes. */

export const DIRECTION_SCHEMA = 'worthlookingup.mission-direction-evidence/1';

// The only frame and convention this project accepts, so a heading is never silently reinterpreted.
export const REFERENCE_FRAME = 'true-north-from-north-through-east';

export const DIRECTION_CLASSES = Object.freeze([
  Object.freeze({ code: 'published-mission-direction', level: 1, upcomingSectorEligible: true,
    label: 'A direction this mission\u2019s operator or range authority published' }),
  Object.freeze({ code: 'reconstructed-mission-direction', level: 2, upcomingSectorEligible: true,
    label: 'A direction reconstructed from this mission\u2019s own evidence, with a documented method' }),
  Object.freeze({ code: 'physically-constrained-direction', level: 3, upcomingSectorEligible: false,
    label: 'A direction bounded by real constraints, never observed as a flown heading' }),
  Object.freeze({ code: 'vehicle-family-analogy', level: 4, upcomingSectorEligible: false,
    label: 'How this vehicle class has flown before' }),
  Object.freeze({ code: 'pad-bearing-only', level: 5, upcomingSectorEligible: false,
    label: 'Where the pad points' }),
]);

export const directionClass = code => DIRECTION_CLASSES.find(entry => entry.code === code) || null;

export const SOURCE_TYPES = Object.freeze(['press-kit', 'operator-mission-page', 'environmental-assessment',
  'licence-application', 'airspace-notice', 'maritime-notice', 'webcast-briefing', 'mission-documentation',
  'instrumented-reconstruction', 'catalogue-orbit', 'hazard-area', 'launch-corridor', 'vehicle-family-history',
  'pad-position']);

// The source types that are not themselves a direction. A record citing one of these may only claim the
// matching class, so the weaker evidence can never be promoted by editing a field.
const CLASS_FOR_SOURCE_TYPE = Object.freeze({
  'catalogue-orbit': 'physically-constrained-direction',
  'hazard-area': 'physically-constrained-direction',
  'launch-corridor': 'physically-constrained-direction',
  'vehicle-family-history': 'vehicle-family-analogy',
  'pad-position': 'pad-bearing-only',
});
const NON_DIRECTIONAL_SOURCES = Object.freeze(Object.keys(CLASS_FOR_SOURCE_TYPE));

// A sector wider than this is not evidence of a direction; it is a hemisphere.
export const MAX_SECTOR_UNCERTAINTY_DEG = 45;

/* ---- the validator ------------------------------------------------------- */

const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value) && Number.isFinite(Date.parse(value));
const isHttpUrl = value => typeof value === 'string' && /^https?:\/\//.test(value);
const angleInRange = value => Number.isFinite(value) && value >= 0 && value < 360;

// Returns { ok, errors, klass, permitted, reasons }. `ok` means the record is well formed and internally
// consistent; `permitted` means it may be used as an upcoming mission's ascent sector, which is stricter:
// a class-3 constraint or a family analogy is a perfectly valid record that may never be displayed.
export function validateDirectionEvidence(record, { nowIso = new Date().toISOString() } = {}) {
  const errors = [];
  const reasons = [];
  const fail = message => errors.push(message);
  if (!record || typeof record !== 'object') {
    return { ok: false, errors: ['the record must be an object'], klass: null, permitted: false,
      reasons: ['the record is not an object'], independentCorroboration: 0 };
  }

  if (record.schema !== DIRECTION_SCHEMA) fail(`the record schema must be ${DIRECTION_SCHEMA}`);
  if (!record.provider || typeof record.provider.name !== 'string' || !record.provider.name) fail('provider.name is required');
  if (!record.mission || typeof record.mission.id !== 'string' || !record.mission.id) fail('mission.id is required');
  if (!record.mission || typeof record.mission.name !== 'string' || !record.mission.name) fail('mission.name is required');
  if (typeof record.vehicle !== 'string' || !record.vehicle) fail('vehicle is required');
  const pad = record.pad || {};
  if (!Number.isFinite(pad.latDeg) || Math.abs(pad.latDeg) > 90) fail('pad.latDeg must be a finite latitude');
  if (!Number.isFinite(pad.lonDeg) || Math.abs(pad.lonDeg) > 360) fail('pad.lonDeg must be a finite longitude');
  const scheduled = record.scheduled || {};
  if (scheduled.utc !== null && scheduled.utc !== undefined && !Number.isFinite(Date.parse(scheduled.utc))) {
    fail('scheduled.utc must be an instant, or null when the time is not published');
  }
  if (typeof scheduled.precision !== 'string' || !scheduled.precision) fail('scheduled.precision is required');

  const source = record.source || {};
  if (!SOURCE_TYPES.includes(source.type)) fail(`source.type must be one of ${SOURCE_TYPES.join(', ')}`);
  if (!isHttpUrl(source.url)) fail('source.url must be an http(s) URL');
  if (typeof source.publisher !== 'string' || !source.publisher) fail('source.publisher is required');
  if (!isDate(source.retrievedUtc)) fail('source.retrievedUtc must be a date');
  if (source.publicationUtc !== undefined && source.publicationUtc !== null && !isDate(source.publicationUtc)) {
    fail('source.publicationUtc must be a date when it is present');
  }
  if (typeof source.licence !== 'string' || !source.licence) fail('source.licence is required');

  const klass = directionClass(record.evidenceClass);
  if (!klass) fail(`evidenceClass must be one of ${DIRECTION_CLASSES.map(entry => entry.code).join(', ')}`);

  // The class and the source type have to agree: this is the rule that stops an inclination-derived
  // heading, a hazard polygon or a family history from being filed as a published direction.
  const requiredForSource = CLASS_FOR_SOURCE_TYPE[source.type];
  if (requiredForSource && klass && klass.code !== requiredForSource) {
    fail(`a ${source.type} source may only be filed as ${requiredForSource}, not ${klass.code}`);
  }

  const direction = record.direction;
  if (direction !== null && direction !== undefined) {
    if (!angleInRange(direction.fromDeg) || !angleInRange(direction.toDeg)) {
      fail('direction.fromDeg/toDeg must be angles in [0,360)');
    }
    if (!Number.isFinite(direction.uncertaintyDeg) || direction.uncertaintyDeg < 0) fail('direction.uncertaintyDeg is required');
    if (Number.isFinite(direction.uncertaintyDeg) && direction.uncertaintyDeg > MAX_SECTOR_UNCERTAINTY_DEG) {
      fail(`direction.uncertaintyDeg above ${MAX_SECTOR_UNCERTAINTY_DEG} degrees is not a direction`);
    }
    if (direction.frame !== REFERENCE_FRAME) fail(`direction.frame must be ${REFERENCE_FRAME}`);
    if (!Number.isFinite(direction.centreDeg)) fail('direction.centreDeg is required');
  }

  const corroboration = Array.isArray(record.corroboration) ? record.corroboration : [];
  if (!Array.isArray(record.corroboration)) fail('corroboration must be an array (empty is allowed)');
  for (const support of corroboration) {
    if (!SOURCE_TYPES.includes(support && support.sourceType)) fail('every corroborating source needs a known sourceType');
    if (!isHttpUrl(support && support.url)) fail('every corroborating source needs an http(s) URL');
    if (typeof (support && support.publisher) !== 'string' || !support.publisher) {
      fail('every corroborating source needs a publisher, so a second document is not confused with a second author');
    }
    if (support && typeof support.independent !== 'boolean') fail('every corroborating source must state independent: true or false');
  }
  // Corroboration means a different document, from a different author or a different kind of source, and
  // never one of the types that cannot express a direction at all. A copy of the same document, a second
  // derivation from the same inclination and a restatement by the same author in the same form do not
  // corroborate anything: this is the rule that stops "self-corroboration" from being filed as support.
  const independent = corroboration.filter(support => support && support.independent === true &&
    support.url !== source.url &&
    !NON_DIRECTIONAL_SOURCES.includes(support.sourceType) &&
    (support.sourceType !== source.type || support.publisher !== source.publisher));

  if (!Array.isArray(record.limitations) || !record.limitations.length ||
      record.limitations.some(item => typeof item !== 'string' || !item)) {
    fail('limitations must be a non-empty array of strings');
  }
  if (!isDate(record.reviewBy)) fail('reviewBy must be a date');
  if (record.provenance && record.provenance.status && !['clear', 'ambiguous'].includes(record.provenance.status)) {
    fail('provenance.status must be clear or ambiguous when it is present');
  }

  if (klass && klass.upcomingSectorEligible && !direction) fail(`${klass.code} requires a direction sector`);
  if (klass && klass.upcomingSectorEligible && !independent.length) {
    fail(`${klass.code} requires at least one independent corroborating source`);
  }

  const ok = errors.length === 0;
  if (!ok) reasons.push(...errors);
  if (klass && !klass.upcomingSectorEligible) {
    reasons.push(`${klass.code} is a ${klass.level <= 3 ? 'constraint' : 'analogy'}: ` +
      "it may never be shown as an upcoming mission's ascent direction");
  }
  if (record.provenance && record.provenance.status === 'ambiguous') {
    reasons.push('the source identity or provenance is ambiguous, so the direction is not usable');
  }
  const expired = isDate(record.reviewBy) && Date.parse(record.reviewBy) < Date.parse(nowIso);
  if (expired) reasons.push('the record has passed its reviewBy date and must be re-verified before use');
  const permitted = ok && !!klass && klass.upcomingSectorEligible && independent.length > 0 &&
    (!record.provenance || record.provenance.status !== 'ambiguous') && !expired;
  return { ok, errors, klass, permitted, reasons, independentCorroboration: independent.length };
}

export function assertDirectionEvidence(record, options) {
  const result = validateDirectionEvidence(record, options);
  if (!result.ok) throw new Error('Invalid mission-direction evidence record: ' + result.errors.join('; '));
  return result;
}

// The single place a caller may ask for a sector, so no other code path can decide this for itself. A
// caller must still match the mission identity against the live schedule before showing anything: this
// function answers "is this record strong enough", not "is this the flight on the card".
export function directionSectorForUpcomingMission(record, { nowIso = new Date().toISOString() } = {}) {
  const result = validateDirectionEvidence(record, { nowIso });
  if (!result.permitted) {
    return { permitted: false, sector: null, reasons: result.reasons, klass: result.klass ? result.klass.code : null };
  }
  return { permitted: true, klass: result.klass.code, reasons: [],
    sector: { centreDeg: record.direction.centreDeg, fromDeg: record.direction.fromDeg, toDeg: record.direction.toDeg,
      uncertaintyDeg: record.direction.uncertaintyDeg, frame: REFERENCE_FRAME },
    provenance: { source: record.source.url, publisher: record.source.publisher,
      retrievedUtc: record.source.retrievedUtc, publicationUtc: record.source.publicationUtc || null,
      corroboration: record.corroboration.filter(support => support.independent === true).map(support => support.url) } };
}

