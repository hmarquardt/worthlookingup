/* The trajectory evidence audit as a pure module (Phase 5C).

   Separated from scripts/audit-trajectory-profiles.mjs on purpose: the script fetches the live sources and
   prints, and this module decides. Every rule the audit applies -- integrity, drift classification, the
   summary and the candidate review entries -- can therefore be exercised deterministically in the test
   suite without a network, which is the only way to test the failure paths honestly.

   Two rules this module enforces without exception:
   * Nothing here promotes a profile. There is no code path that raises an evidence level or restores a
     withheld output.
   * An unavailable source is never a contradiction. A check that could not read its evidence returns
     `unavailable`, which never turns into a review item. */

import { evidenceLevel, publicationPermissions, terminalStateConsistency, validateProfileArtifact,
  validateReviewRecord } from './launch-trajectory.mjs';
import { validatePadIndex } from './launch-pad-index.mjs';

export const AUDIT_SCHEMA = 'worthlookingup.trajectory-audit/1';
export const CHECK_STATUSES = Object.freeze(['pass', 'fail', 'unavailable', 'review-required']);

// Numeric tolerances for "the source moved". They are deliberately wider than the gate tolerances: this
// answers "has the record changed", not "does the reconstruction pass", and the gate is recomputed
// against the fresh record separately.
export const DRIFT = Object.freeze({ orbitKm: 1, orbitInclinationDeg: 0.05, padDeg: 0.05,
  seriesAltitudeM: 1, seriesVelocityMps: 0.1, launchInstantMs: 60000 });

/* ---- 1. integrity, from the committed files alone ------------------------ */

export function auditIntegrity({ artifact, padIndex = null, review = null, artifactDigest = null }) {
  const checks = [];
  const validation = validateProfileArtifact(artifact);
  checks.push(check('artifact', 'schema and publishable-profile rules', validation.ok ? 'pass' : 'fail',
    validation.ok ? `${(artifact.profiles || []).length} published, ${(artifact.rejected || []).length} rejected candidates`
      : validation.errors.slice(0, 4).join('; ')));

  if (padIndex) {
    const indexValidation = validatePadIndex(padIndex);
    checks.push(check('index', 'pad index validates', indexValidation.ok ? 'pass' : 'fail',
      indexValidation.ok ? `${padIndex.pad_count} pad(s), ${padIndex.profile_count} profile(s)`
        : indexValidation.errors.slice(0, 4).join('; ')));
    if (artifactDigest) {
      const matched = padIndex.artifact_digest === artifactDigest;
      checks.push(check('index', 'pad index digest matches the artifact', matched ? 'pass' : 'fail',
        matched ? 'the index was built from these bytes'
          : 'the index was built from a different revision of the profiles'));
    }
  } else {
    checks.push(check('index', 'pad index present', 'review-required',
      'the compact pad index is missing from the publication'));
  }

  if (review) {
    const reviewValidation = validateReviewRecord(review);
    checks.push(check('review', 'review record validates', reviewValidation.ok ? 'pass' : 'fail',
      reviewValidation.ok ? `${(review.entries || []).length} active review entr(ies)`
        : reviewValidation.errors.slice(0, 4).join('; ')));
  } else {
    checks.push(check('review', 'review record present', 'review-required',
      'no evidence review record was found; the audit cannot tell whether a review is pending'));
  }

  for (const profile of artifact.profiles || []) {
    // The recorded gates must follow from the profile's own numbers and its anchor.
    const terminal = terminalStateConsistency({ terminal: profile.terminal, orbit: profile.orbit });
    const recorded = profile.validation ? profile.validation.terminal : null;
    const reproducible = terminal.applicable === true && !!recorded && recorded.applicable === true &&
      typeof recorded.passes === 'boolean' && terminal.passes === recorded.passes &&
      Math.abs(terminal.speedRelativeError - recorded.speedRelativeError) < 1e-9 &&
      Math.abs(terminal.altitudeErrorKm - recorded.altitudeErrorKm) < 1e-9;
    checks.push(check(profile.id, 'gate results reproduce', reproducible ? 'pass' : 'fail',
      reproducible ? `terminal ${(recorded.speedRelativeError * 100).toFixed(2)} per cent, ${recorded.altitudeErrorKm.toFixed(1)} km`
        : 'the recorded gate result does not follow from the profile and its anchor'));

    const permissions = publicationPermissions(profile.validation);
    const consistent = permissions && JSON.stringify(permissions) === JSON.stringify(profile.validation.permissions);
    checks.push(check(profile.id, 'permissions follow the gates', consistent ? 'pass' : 'fail',
      consistent ? `elevation ${permissions.elevation}` : 'the stated permissions disagree with the gate results'));

    // An evidence level only ever stays where it is: the audit detects a change and stops there.
    let levelOk = true;
    let levelDetail = `level ${profile.evidence.level} (${profile.evidence.code})`;
    try {
      const expected = evidenceLevel(profile.evidence.level);
      levelOk = expected.code === profile.evidence.code &&
        (profile.synthetic === true || expected.provenanceKinds.includes(profile.evidence.provenanceKind));
      if (!levelOk) {
        levelDetail = `level ${profile.evidence.level} does not support ` +
          `${profile.evidence.code}/${profile.evidence.provenanceKind}`;
      }
    } catch (error) {
      levelOk = false;
      levelDetail = `level ${profile.evidence.level} is not a defined evidence level`;
    }
    checks.push(check(profile.id, 'evidence level unchanged', levelOk ? 'pass' : 'fail', levelDetail));

    const entry = review && Array.isArray(review.entries) ? review.entries.find(item => item.id === profile.id) : null;
    if (entry && entry.action !== 'none') {
      checks.push(check(profile.id, 'active evidence review', 'review-required',
        `${entry.action} since ${entry.since}: ${entry.reason}`));
    }
  }
  return checks;
}


const check = (scope, name, status, detail) => ({ scope, name, status, detail });

/* ---- 2. drift, given whatever the live sources returned ------------------ */
/* The caller fetches; this decides. Every argument is allowed to be missing, and a missing one produces
   `unavailable` rather than a contradiction, so a provider outage can never be mistaken for drift. */

export function auditAnchor(profile, live = {}) {
  const checks = [];
  let changed = null;
  const note = reason => { if (!changed) changed = reason; };

  // 2a. the launch instant, as the launch log publishes it today. Only a real time difference counts: a
  // log that has since added seconds to a record committed to the minute is a refinement, not drift.
  const instant = live.launchInstant || {};
  if (!instant.available) {
    checks.push(check(profile.id, 'launch instant unchanged', 'unavailable', instant.detail || 'the launch log could not be read'));
  } else if (!instant.utc) {
    checks.push(check(profile.id, 'launch instant still published', 'review-required',
      `the launch log no longer lists ${profile.orbit ? profile.orbit.piece : 'this profile'}`));
    note('the launch log no longer lists this flight');
  } else {
    const same = Math.abs(Date.parse(instant.utc) - Date.parse(profile.launch.utc)) <= DRIFT.launchInstantMs;
    checks.push(check(profile.id, 'launch instant unchanged', same ? 'pass' : 'review-required',
      `committed ${profile.launch.utc} (${profile.launch.precision}); the log now lists ${instant.utc}`));
    if (!same) note(`the launch instant moved to ${instant.utc}`);
  }

  // 2b. the orbit anchor, and the terminal gate recomputed against it.
  const orbit = live.orbit || {};
  if (!orbit.available) {
    checks.push(check(profile.id, 'orbit anchor unchanged', 'unavailable', orbit.detail || 'the satellite catalogue could not be read'));
  } else if (!orbit.found) {
    checks.push(check(profile.id, 'orbit anchor present', 'review-required',
      `the catalogue no longer lists ${profile.orbit ? profile.orbit.piece : 'the anchor piece'}`));
    note('the catalogued orbit is gone');
  } else {
    const moved = Math.abs(orbit.perigeeKm - profile.orbit.perigeeKm) > DRIFT.orbitKm ||
      Math.abs(orbit.apogeeKm - profile.orbit.apogeeKm) > DRIFT.orbitKm ||
      Math.abs(orbit.inclinationDeg - profile.orbit.inclinationDeg) > DRIFT.orbitInclinationDeg;
    checks.push(check(profile.id, 'orbit anchor unchanged', moved ? 'review-required' : 'pass',
      moved ? `catalogue now ${orbit.perigeeKm}x${orbit.apogeeKm} km at ${orbit.inclinationDeg} deg; committed ` +
        `${profile.orbit.perigeeKm}x${profile.orbit.apogeeKm} at ${profile.orbit.inclinationDeg}`
        : `still ${orbit.perigeeKm}x${orbit.apogeeKm} km at ${orbit.inclinationDeg} deg`));
    if (moved) note(`the catalogued orbit moved to ${orbit.perigeeKm}x${orbit.apogeeKm} km at ${orbit.inclinationDeg} deg`);
    const fresh = { perigeeKm: orbit.perigeeKm, apogeeKm: orbit.apogeeKm, inclinationDeg: orbit.inclinationDeg,
      appliesTo: profile.orbit.appliesTo };
    // A catalogue row that is not a physically ordered orbit is reported, never allowed to throw: the
    // audit must survive a malformed upstream record and still say what it could not check.
    const usable = [fresh.perigeeKm, fresh.apogeeKm, fresh.inclinationDeg].every(Number.isFinite) &&
      fresh.apogeeKm > 0 && fresh.perigeeKm <= fresh.apogeeKm;
    if (!usable) {
      checks.push(check(profile.id, 'terminal gate passes against the live anchor', 'review-required',
        'the catalogue row is not a physically ordered orbit, so the gate could not be recomputed'));
      note('the catalogued orbit is not a usable orbit record');
    } else {
      const regate = terminalStateConsistency({ terminal: profile.terminal, orbit: fresh });
      const passes = regate.applicable === true && regate.passes === true;
      checks.push(check(profile.id, 'terminal gate passes against the live anchor', passes ? 'pass' : 'review-required',
        passes ? `within tolerance (${(regate.speedRelativeError * 100).toFixed(2)} per cent, ${regate.altitudeErrorKm.toFixed(1)} km)`
          : `the gate would now fail in ${(regate.failures || []).join(' and ') || 'an unstated way'}`));
      if (!passes) note('the terminal gate no longer passes against the live catalogued orbit');
    }
  }

  // 2c. the pad row: a fixed fact that a catalogue revision would move.
  const pad = live.pad || {};
  if (!pad.looked) {
    checks.push(check(profile.id, 'pad coordinates unchanged', 'unavailable', pad.detail || 'the launch point catalogue could not be read'));
  } else if (!pad.found) {
    checks.push(check(profile.id, 'pad coordinates unchanged', 'unavailable',
      'the launch point catalogue lists no row with this exact name'));
  } else {
    const moved = !Number.isFinite(pad.latDeg) || !Number.isFinite(pad.lonDeg) ||
      Math.abs(pad.latDeg - profile.site.latDeg) > DRIFT.padDeg || Math.abs(pad.lonDeg - profile.site.lonDeg) > DRIFT.padDeg;
    checks.push(check(profile.id, 'pad coordinates unchanged', moved ? 'review-required' : 'pass',
      moved ? `catalogue now ${pad.latDeg}, ${pad.lonDeg}`
        : `${pad.latDeg}, ${pad.lonDeg}`));
    if (moved) note('the pad coordinates in the catalogue changed');
  }

  // 2d. the transcription itself: a withdrawn or edited series must be visible to this audit.
  const series = live.series || {};
  if (!series.available) {
    checks.push(check(profile.id, 'source series reachable', 'unavailable', series.detail || 'the source series could not be read'));
  } else if (!series.terminal) {
    checks.push(check(profile.id, 'source series unchanged', 'unavailable', series.detail || 'the source series was not readable'));
  } else {
    const same = Math.abs(series.terminal.altitudeM - profile.terminal.altitudeM) <= DRIFT.seriesAltitudeM &&
      Math.abs(series.terminal.velocityMps - profile.terminal.velocityMps) <= DRIFT.seriesVelocityMps;
    checks.push(check(profile.id, 'source series unchanged', same ? 'pass' : 'review-required',
      same ? `still ends at ${(series.terminal.altitudeM / 1000).toFixed(1)} km`
        : `now ends at ${(series.terminal.altitudeM / 1000).toFixed(1)} km and ${series.terminal.velocityMps} m/s; ` +
          `committed ${(profile.terminal.altitudeM / 1000).toFixed(1)} km and ${profile.terminal.velocityMps} m/s`));
    if (!same) note('the published telemetry transcription changed');
  }

  return { checks, changed };
}


/* ---- 3. summary and the review proposal ---------------------------------- */

export function summarize(checks) {
  const counts = { pass: 0, fail: 0, unavailable: 0, 'review-required': 0 };
  for (const entry of checks) counts[entry.status] = (counts[entry.status] || 0) + 1;
  const verdict = counts.fail ? 'integrity-failure' : counts['review-required'] ? 'review-required' : 'clean';
  return { verdict, counts,
    failures: checks.filter(entry => entry.status === 'fail'),
    reviews: checks.filter(entry => entry.status === 'review-required'),
    unavailable: checks.filter(entry => entry.status === 'unavailable') };
}

// A candidate is a proposal for a human, never a publication: the audit does not write the review record,
// and this function is the only place a suppression is even described.
export function candidateReviewEntries(checks, date) {
  const entries = new Map();
  for (const entry of checks) {
    if (entry.status !== 'review-required') continue;
    if (entry.name === 'active evidence review') continue; // already reviewed; nothing to propose
    const id = entry.scope;
    const reason = `${entry.name}: ${entry.detail}`;
    if (!entries.has(id)) {
      entries.set(id, { id, action: 'suppress-elevation', since: date,
        reason: `evidence drift detected by the ${date} audit: ${reason}`,
        evidence: 'scripts/audit-trajectory-profiles.mjs - review the drift table before committing this entry' });
    }
  }
  return [...entries.values()];
}

export function reviewRecordFor(entries, date) {
  if (!entries.length) return null;
  return {
    schema: 'worthlookingup.trajectory-review/1',
    reviewed_utc: date,
    note: 'Candidate entries produced by the trajectory evidence audit. A human reviews the drift table and ' +
      'commits the entries that are justified; the audit itself never writes this file.',
    entries,
  };
}

