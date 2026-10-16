/* The compact pad-to-profile index (Phase 5C).

   Purpose: answer one question cheaply, in the launch calendar, before any trajectory data is loaded —
   "does this launch pad have a reviewed historical ascent profile?". The answer drives a link, never a
   claim: nothing here carries a direction, an elevation, a sample or a time below the mission date, so
   an index that is missing, stale or wrong can only ever remove a link, never add a number.

   Generated from the validated profile artifact by scripts/build-trajectory-profiles.mjs (see
   buildPadIndex) and validated at read time by the interface with the same validatePadIndex used by the
   generator and the tests. Pure module: no DOM, no storage, no network.

   Deliberately absent, with tests asserting it: any altitude, downrange, speed, elevation, sample or
   illumination field. The full artifact stays the only source of trajectory geometry, and it is loaded
   only when a reader opens the historical explorer. */

export const PAD_INDEX_SCHEMA = 'worthlookingup.trajectory-pad-index/1';

// Two published coordinates count as the same pad when they agree to about 5 km. The launch feed and the
// orbit catalogue publish the same pads to different precision (SLC-4E appears as 34.632/-120.6106 and
// sometimes as 34.632/-120.611), and a pad's position is a fixed fact, so a tolerance is the honest
// comparison; it is far tighter than the distance between any two launch pads on Earth.
export const PAD_MATCH_TOLERANCE_DEG = 0.05;

const OUTPUT_CLASSES = Object.freeze(['elevation-and-window', 'direction-only']);

// The output a profile may produce, taken from its own permission record rather than inferred from its
// evidence level: level 2 evidence that failed a gate is direction-only, and the index must not pretend
// otherwise.
const outputClassFor = profile => profile.validation && profile.validation.permissions &&
  profile.validation.permissions.elevation === true ? 'elevation-and-window' : 'direction-only';

export const padKey = (latDeg, lonDeg) => `${Number(latDeg).toFixed(3)},${Number(lonDeg).toFixed(3)}`;

// One entry per pad, in a stable order, with the minimum a caller needs. `artifact_digest` is the
// SHA-256 of the exact artifact bytes this index was built from, so a stale index is detectable rather
// than merely suspected.
export function buildPadIndex(artifact, { digest = null, generatedUtc = new Date().toISOString() } = {}) {
  const pads = new Map();
  for (const profile of artifact.profiles || []) {
    const key = padKey(profile.site.latDeg, profile.site.lonDeg);
    if (!pads.has(key)) {
      pads.set(key, { key, pad: profile.site.pad, lat_deg: profile.site.latDeg, lon_deg: profile.site.lonDeg, profiles: [] });
    }
    pads.get(key).profiles.push({
      id: profile.id, mission: profile.mission, launch_utc: profile.launch.utc,
      evidence_level: profile.evidence.level, output: outputClassFor(profile),
    });
  }
  const ordered = [...pads.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const pad of ordered) {
    pad.profile_count = pad.profiles.length;
    pad.profiles.sort((a, b) => a.launch_utc.localeCompare(b.launch_utc));
    pad.capabilities = {
      elevation: pad.profiles.some(profile => profile.output === 'elevation-and-window') ? 'available' : 'withheld',
      direction: 'available',
    };
  }
  return {
    schema: PAD_INDEX_SCHEMA,
    generated_utc: generatedUtc,
    artifact_schema: artifact.schema,
    artifact_digest: digest,
    artifact_generated_utc: artifact.generated_utc,
    profile_count: (artifact.profiles || []).length,
    pad_count: ordered.length,
    pads: ordered,
  };
}

export function validatePadIndex(index) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!index || typeof index !== 'object') return { ok: false, errors: ['the pad index must be an object'] };
  if (index.schema !== PAD_INDEX_SCHEMA) fail(`the pad index schema must be ${PAD_INDEX_SCHEMA}`);
  if (typeof index.artifact_digest !== 'string' || !/^[0-9a-f]{64}$/.test(index.artifact_digest)) {
    fail('the pad index must carry the sha256 digest of the artifact it was built from');
  }
  if (!Array.isArray(index.pads)) fail('the pad index must carry a pads array');
  let counted = 0;
  for (const pad of index.pads || []) {
    const label = pad && pad.key ? pad.key : 'unnamed pad';
    if (typeof pad.key !== 'string' || !pad.key) fail(`${label}: every pad needs a stable key`);
    if (!Number.isFinite(pad.lat_deg) || Math.abs(pad.lat_deg) > 90) fail(`${label}: lat_deg must be a finite latitude`);
    if (!Number.isFinite(pad.lon_deg) || Math.abs(pad.lon_deg) > 360) fail(`${label}: lon_deg must be a finite longitude`);
    if (padKey(pad.lat_deg, pad.lon_deg) !== pad.key) fail(`${label}: the key must be the rounded pad coordinate`);
    if (typeof pad.pad !== 'string' || !pad.pad) fail(`${label}: every pad must name itself`);
    if (!Array.isArray(pad.profiles) || !pad.profiles.length) fail(`${label}: every pad entry needs at least one profile`);
    if (pad.profile_count !== (pad.profiles || []).length) fail(`${label}: profile_count must equal the number of profiles`);
    counted += (pad.profiles || []).length;
    for (const profile of pad.profiles || []) {
      if (typeof profile.id !== 'string' || !profile.id) fail(`${label}: every profile needs an id`);
      if (!Number.isFinite(Date.parse(profile.launch_utc))) fail(`${label}/${profile.id}: launch_utc must be an instant`);
      if (!Number.isInteger(profile.evidence_level) || profile.evidence_level < 1 || profile.evidence_level > 5) {
        fail(`${label}/${profile.id}: evidence_level must be 1..5`);
      }
      if (!OUTPUT_CLASSES.includes(profile.output)) fail(`${label}/${profile.id}: output must be ${OUTPUT_CLASSES.join(' or ')}`);
    }
    if (!pad.capabilities || pad.capabilities.direction !== 'available') {
      fail(`${label}: a pad with a profile always offers a direction`);
    }
  }
  if (index.profile_count !== counted) fail('profile_count must equal the number of profile entries in the index');
  if (index.pad_count !== (index.pads || []).length) fail('pad_count must equal the number of pad entries');
  // A trajectory sample must never appear here: the index decides whether a link is drawn, and the
  // artifact remains the only source of geometry.
  const text = JSON.stringify(index);
  for (const forbidden of ['altitudeM', 'downrangeM', 'velocityMps', 'elevationDeg', 'azimuthDeg', 'slantRangeM', 'shadow']) {
    if (text.includes(forbidden)) fail(`the pad index must not carry trajectory data (found ${forbidden})`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertPadIndex(index) {
  const result = validatePadIndex(index);
  if (!result.ok) throw new Error('Invalid pad index: ' + result.errors.join('; '));
  return index;
}

// The published profiles attached to a launch pad, matched by coordinate within the tolerance. Returns
// an empty array for a pad that has none, an unknown pad, or an unusable index, so a caller can only
// lose the link by passing something bad.
export function profilesForPad(index, pad) {
  if (!index || !Array.isArray(index.pads) || !pad) return [];
  const lat = Number.isFinite(pad.latitude) ? pad.latitude : pad.lat;
  const lon = Number.isFinite(pad.longitude) ? pad.longitude : pad.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const found = [];
  for (const entry of index.pads) {
    if (Math.abs(entry.lat_deg - lat) <= PAD_MATCH_TOLERANCE_DEG && Math.abs(entry.lon_deg - lon) <= PAD_MATCH_TOLERANCE_DEG) {
      found.push(...entry.profiles);
    }
  }
  return found.sort((a, b) => a.launch_utc.localeCompare(b.launch_utc));
}

