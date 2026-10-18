/* Nighttime public access: what may be claimed, from what evidence, and for how long.

   The rule this module enforces is deliberately narrow. Ownership is not permission, a public-access
   designation is not opening hours, and a third-party map annotation is not evidence of anything legal.
   Only an authoritative statement that somebody may be on the land after dark, with a legal place to
   leave a vehicle, supports an affirmative nighttime recommendation — and only while that evidence is
   recent. Everything else is reported as unknown, restricted or private, with the reason attached. */

export const ACCESS_STATES = Object.freeze({
  VERIFIED: 'verified-night-access',
  PUBLIC_UNKNOWN: 'public-night-unknown',
  RESTRICTED: 'restricted-after-dark',
  PRIVATE: 'private-no-permission',
  INSUFFICIENT: 'insufficient-evidence',
});

export const NIGHT_ACCESS = Object.freeze({ PERMITTED: 'permitted', RESTRICTED: 'restricted', UNKNOWN: 'unknown' });

// Authority, highest first. A third-party map can raise a question but can never answer one, and an
// unverified observation is not evidence at all — it is a note for the next field check.
export const EVIDENCE_AUTHORITY = Object.freeze({
  'agency-rule': 4,          // a published regulation or statute (hours of operation, closure order)
  'agency-page': 3,          // an agency page that states access, hours or a parking rule
  'official-dataset': 2,     // PAD-US and similar: ownership, management, protection and an access flag
  'third-party-map': 1,      // OSM tags, commercial maps, blogs
  observation: 0,            // somebody saw it once; useful, not verifiable, never sufficient
});

export const MAX_VERIFICATION_AGE_DAYS = 365;

export function authorityOf(evidence) {
  const rank = EVIDENCE_AUTHORITY[evidence && evidence.kind];
  if (rank === undefined) throw new Error('access: unknown evidence kind ' + (evidence && evidence.kind));
  return rank;
}

/* Evidence ages. A closure, a gate or a change of manager can appear at any time, so a verified state
   expires; the interface then says access is unverified rather than quietly keeping the old answer. */
export function evidenceAgeDays(evidence, now = Date.now()) {
  const at = Date.parse(evidence && evidence.verifiedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, (now - at) / 86400000);
}

/* The classification. Order matters and is safety-first: a restriction always wins over a permission, and a
   permission without a documented legal parking place is not enough to cross a road on foot at 2 a.m. */
export function classifyAccess(evidenceList, { now = Date.now(), maxAgeDays = MAX_VERIFICATION_AGE_DAYS } = {}) {
  const evidence = (evidenceList || []).filter(Boolean);
  for (const entry of evidence) authorityOf(entry);
  const authoritative = evidence.filter(entry => authorityOf(entry) >= EVIDENCE_AUTHORITY['official-dataset']);
  const stated = authoritative.filter(entry => entry.states && entry.states.nightAccess &&
    entry.states.nightAccess !== NIGHT_ACCESS.UNKNOWN);
  const ages = stated.map(entry => evidenceAgeDays(entry, now)).filter(Number.isFinite);
  const oldest = ages.length ? Math.max(...ages) : null;
  const stale = oldest !== null && oldest > maxAgeDays;
  const permits = stated.filter(entry => entry.states.nightAccess === NIGHT_ACCESS.PERMITTED);
  const restricts = stated.filter(entry => entry.states.nightAccess === NIGHT_ACCESS.RESTRICTED);
  const privateOwnership = authoritative.some(entry => entry.states && entry.states.ownership === 'private');
  const publicLand = authoritative.some(entry => entry.states && entry.states.publicLand === true);
  // A whole-property hours statement covers the property's own parking areas; that inference is recorded
  // rather than hidden, because the lot itself is still not independently documented.
  const parking = permits.find(entry => entry.states && (entry.states.parking === 'permitted' ||
    (entry.states.parking === 'on-site-by-property-hours' && entry.states.scope === 'property')));
  const parkingInferred = Boolean(parking && parking.states.parking === 'on-site-by-property-hours');

  if (restricts.length) {
    const rule = restricts[0];
    return { state: ACCESS_STATES.RESTRICTED, stale: Boolean(stale),
      reason: rule.summary || 'an authoritative source limits access hours',
      evidence: restricts, oldestEvidenceDays: oldest,
      nightWindow: rule.states.nightWindow || null, conflict: permits.length > 0 };
  }
  if (permits.length && parking && !stale) {
    return { state: ACCESS_STATES.VERIFIED, stale: false,
      reason: parking.summary || permits[0].summary || 'an authoritative source permits after-dark access where a legal place to park exists',
      evidence: [parking, ...permits.filter(entry => entry !== parking)], oldestEvidenceDays: oldest,
      parkingInferred };
  }
  if (permits.length && parking) {
    return { state: ACCESS_STATES.PUBLIC_UNKNOWN, stale: true,
      reason: 'the evidence for after-dark access is ' + Math.round(oldest) + ' days old and must be re-checked',
      evidence: permits, oldestEvidenceDays: oldest };
  }
  if (permits.length) {
    return { state: ACCESS_STATES.PUBLIC_UNKNOWN, stale: Boolean(stale),
      reason: 'after-dark access is stated, but no legal place to leave a vehicle is documented',
      evidence: permits, oldestEvidenceDays: oldest };
  }
  if (privateOwnership && !publicLand) {
    return { state: ACCESS_STATES.PRIVATE, stale: false,
      reason: 'ownership evidence shows private or non-governmental land, and no public permission is recorded',
      evidence: authoritative, oldestEvidenceDays: oldest };
  }
  if (publicLand) {
    return { state: ACCESS_STATES.PUBLIC_UNKNOWN, stale: false,
      reason: 'public land is documented, but no authoritative statement about access after dark was found',
      evidence: authoritative, oldestEvidenceDays: oldest };
  }
  return { state: ACCESS_STATES.INSUFFICIENT, stale: false,
    reason: 'no authoritative source establishes ownership, access or hours', evidence,
    oldestEvidenceDays: oldest };
}

/* Only a verified state may ever support an affirmative recommendation, and a stale one may not. */
export function isRecommendable(classification) {
  return Boolean(classification && classification.state === ACCESS_STATES.VERIFIED && !classification.stale);
}

export function describeAccess(classification) {
  const label = {
    [ACCESS_STATES.VERIFIED]: 'Public access after dark documented',
    [ACCESS_STATES.PUBLIC_UNKNOWN]: 'Public access, after-dark rules not established',
    [ACCESS_STATES.RESTRICTED]: 'Access restricted after dark',
    [ACCESS_STATES.PRIVATE]: 'Private land, no permission established',
    [ACCESS_STATES.INSUFFICIENT]: 'Access evidence insufficient',
  }[classification.state] || 'Access unknown';
  return { label, reason: classification.reason, stale: Boolean(classification.stale) };
}
