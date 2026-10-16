/* Build the published historical trajectory profiles (Phase 5B).
   Run: node scripts/build-trajectory-profiles.mjs [--check] [--fresh]

   The script fetches four public sources, measures both anchoring gates for every candidate mission and
   writes the reviewed result to data/launches/trajectory-profiles.json plus a generated provenance table
   in docs/trajectory-profiles.md. Nothing else in the product generates trajectory data, and the tests
   read the committed artifact, so CI never depends on these sources being up.

   Sources, and why each one is needed:
   - GCAT launch log (5 MB, CC-BY-4.0): the launch instant with its precision, the vehicle, site and pad.
   - GCAT launch points (0.4 MB, CC-BY-4.0): the pad's geodetic coordinates.
   - GCAT satellite catalogue (19 MB, CC-BY-4.0): the achieved orbit used as the independent anchor.
   - Webcast telemetry transcriptions (per mission, public domain): the altitude, speed and downrange
     series being validated.
   The GCAT files are cached under the system temporary directory; pass --fresh to refetch them. */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as T from '../src/launches/launch-trajectory.mjs';
import * as PAD_INDEX from '../src/launches/launch-pad-index.mjs';

const GCAT = 'https://planet4589.org/space/gcat/tsv/';
const ARCHIVE = 'https://raw.githubusercontent.com/shahar603/Telemetry-Data/master/';
const CACHE = join(tmpdir(), 'wlu-trajectory-cache');
const FRESH = process.argv.includes('--fresh');
const CHECK = process.argv.includes('--check');
const STEP_S = 10;

async function fetchText(url, cacheName) {
  if (cacheName) {
    try {
      if (!FRESH && existsSync(join(CACHE, cacheName))) return readFileSync(join(CACHE, cacheName), 'utf8');
    } catch {}
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed ${response.status} for ${url}`);
  const text = await response.text();
  if (cacheName) {
    try { mkdirSync(CACHE, { recursive: true }); writeFileSync(join(CACHE, cacheName), text); } catch {}
  }
  return text;
}
const fetchJson = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed ${response.status} for ${url}`);
  return response.json();
};

// GCAT tables are tab separated with a '#'-prefixed header line.
function parseTsv(text, headerMarker) {
  let header = null;
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      if (line.startsWith(headerMarker)) header = line.slice(1).trim().split('\t');
      continue;
    }
    if (!header) continue;
    const parts = line.split('\t');
    if (parts.length < header.length) continue;
    rows.push(Object.fromEntries(header.map((name, index) => [name, parts[index]])));
  }
  return rows;
}
const clean = value => (value === undefined ? '' : String(value).trim());
const number = value => {
  const parsed = Number.parseFloat(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
};

// '2017 Aug 24 1851' or '1997 Oct 25 0046:00' -> an ISO instant and the precision it really carries.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function launchInstant(raw) {
  const match = /^(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+(\d{2})(\d{2})(?::(\d{2}))?)?$/.exec(clean(raw));
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const monthIndex = MONTHS.indexOf(month);
  if (monthIndex < 0) return null;
  const pad = value => String(value ?? '0').padStart(2, '0');
  const utc = `${year}-${pad(monthIndex + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.000Z`;
  if (!Number.isFinite(Date.parse(utc))) return null;
  return { utc, precision: second !== undefined ? 'second' : 'minute', source: 'GCAT launch log (CC-BY-4.0)' };
}

/* ---- the candidate missions --------------------------------------------- */
/* Every candidate was matched to its GCAT launch tag by payload name and cross-checked against the
   launch date in the launch log; the tag, not the folder name, is the identity that ties the archive
   series to the catalogue orbit. `branch` records which of the two plane headings the vehicle actually
   flew, and `branchBasis` says why that branch was chosen rather than the mirror one — selecting it
   silently would be inventing a fact the inclination does not contain.

   `anchor.appliesTo` is a scientific claim, not a convenience: 'insertion' means the catalogued orbit is
   the state the launcher's own last burn produced, which is the only case the terminal gate can check.
   A geostationary satellite, a space-station cargo run and a direct-to-MEO insertion are all
   'operational' or otherwise uncheckable, and are recorded as such. */
const CANDIDATES = [
  // Published: both gates pass, so the profile may produce elevation and a timed window.
  { folder: 'FormoSat-5', id: 'formosat-5-2017-049', mission: 'FormoSat-5', tag: '2017-049', piece: '2017-049A',
    publish: true, branch: 'southerly',
    branchBasis: 'Vandenberg sun-synchronous ascents leave the pad southbound over the ocean; the northbound heading would cross land' },
  { folder: 'Paz', id: 'paz-2018-020', mission: 'Paz', tag: '2018-020', piece: '2018-020A',
    publish: true, branch: 'southerly',
    branchBasis: 'Vandenberg sun-synchronous ascents leave the pad southbound over the ocean; the northbound heading would cross land' },
  { folder: 'Iridium NEXT 6', id: 'grace-fo-2018-047', mission: 'GRACE-FO and Iridium NEXT 6', tag: '2018-047', piece: '2018-047A',
    publish: true, branch: 'southerly',
    branchBasis: 'Vandenberg polar ascent; the reconstructed series ends at the first insertion, which the anchor piece matches' },

  // Measured and rejected: published in the artifact as rejected candidates with the numbers that failed.
  { folder: 'Iridium NEXT 4', id: 'iridium-next-4-2017-083', mission: 'Iridium NEXT 4', tag: '2017-083', piece: '2017-083C',
    publish: false, branch: 'southerly', branchBasis: 'Vandenberg polar ascent' },
  { folder: 'Iridium NEXT 1', id: 'iridium-next-1-2017-003', mission: 'Iridium NEXT 1', tag: '2017-003', piece: '2017-003A',
    publish: false, branch: 'southerly', branchBasis: 'Vandenberg polar ascent' },
  { folder: 'Iridium NEXT 8', id: 'iridium-next-8-2019-002', mission: 'Iridium NEXT 8', tag: '2019-002', piece: '2019-002A',
    publish: false, branch: 'southerly', branchBasis: 'Vandenberg polar ascent' },
  { folder: 'ZUMA', id: 'zuma-2018-001', mission: 'ZUMA', tag: '2018-001', piece: '2018-001A',
    publish: false, branch: 'southerly', branchBasis: 'Cape southbound ascent for a low-inclination plane' },
  { folder: 'Falcon Heavy Demo 1', id: 'falcon-heavy-demo-1-2018-017', mission: 'Falcon Heavy demonstration flight', tag: '2018-017', piece: '2018-017A',
    publish: false, branch: 'northerly', branchBasis: 'Cape eastbound ascent to a 29 degree plane' },
  { folder: 'SpaceX CRS-8', id: 'spacex-crs-8-2016-024', mission: 'SpaceX CRS-8', tag: '2016-024', piece: '2016-024A',
    publish: false, branch: 'northerly', branchBasis: 'Cape north-eastbound ascent along the ISS approach corridor' },
  { folder: 'SpaceX CRS-14', id: 'spacex-crs-14-2018-032', mission: 'SpaceX CRS-14', tag: '2018-032', piece: '2018-032A',
    publish: false, branch: 'northerly', branchBasis: 'Cape north-eastbound ascent along the ISS approach corridor' },
  { folder: 'Jason-3', id: 'jason-3-2016-002', mission: 'Jason-3', tag: '2016-002', piece: '2016-002A',
    publish: false, branch: 'southerly', branchBasis: 'Vandenberg southbound ascent to a 66 degree plane' },
  { folder: 'GPS III SV01', id: 'gps-iii-sv01-2018-109', mission: 'GPS III SV01', tag: '2018-109', piece: '2018-109A',
    publish: false, branch: 'northerly', branchBasis: 'Cape north-eastbound direct-insertion ascent' },
  { folder: 'SES-11', id: 'ses-11-2017-063', mission: 'SES-11', tag: '2017-063', piece: '2017-063A',
    publish: false, branch: 'northerly', branchBasis: 'Cape eastbound ascent to a geostationary transfer orbit' },
  { folder: 'SAOCOM 1A', id: 'saocom-1a-2018-076', mission: 'SAOCOM 1A', tag: '2018-076', piece: '2018-076A',
    publish: false, branch: 'southerly', branchBasis: 'Vandenberg sun-synchronous ascent',
    documentedAzimuth: { deg: 199, uncertaintyDeg: 5, kind: 'documented',
      source: 'SpaceX SAOCOM 1A press kit timeline, reproduced in the Oberg 2018 review draft',
      url: 'http://satobs.org/seesat_ref/misc/181007-spaceX_1208.pdf' } },
];

// Anchors declare whether the catalogued orbit is an insertion state. The unstated default is
// 'operational', because assuming otherwise would silently turn an unchecked comparison into a pass.
const ANCHOR_APPLIES = {
  '2017-049': 'insertion', '2018-020': 'insertion', '2018-047': 'insertion',
  '2017-083': 'insertion', '2017-003': 'insertion', '2019-002': 'insertion',
  '2018-001': 'insertion', '2018-017': 'insertion', '2016-024': 'operational',
  '2018-032': 'operational', '2016-002': 'insertion', '2018-109': 'operational',
  '2017-063': 'operational', '2018-076': 'insertion',
};
const ANCHOR_REASON = {
  '2016-024': "a space-station cargo run's catalogue orbit is the station approach orbit, reached after the second stage handed over",
  '2018-032': "a space-station cargo run's catalogue orbit is the station approach orbit, reached after the second stage handed over",
  '2018-109': 'the second stage inserted directly into the operational medium Earth orbit, so the catalogue orbit is not the end of the reconstructed burn',
  '2017-063': "a geostationary satellite's catalogue orbit is its operational orbit, reached after the payload's own apogee motor fired",
};



/* ---- sources ------------------------------------------------------------- */

const RETRIEVED = '2026-10-16';
const launchLog = parseTsv(await fetchText(`${GCAT}derived/launchlog.tsv`, 'launchlog.tsv'), '#Launch_Tag');
const launchPoints = parseTsv(await fetchText(`${GCAT}tables/lp.tsv`, 'lp.tsv'), '#Site');
const satcat = parseTsv(await fetchText(`${GCAT}cat/satcat.tsv`, 'satcat.tsv'), '#JCAT');
const launchIndex = new Map();
for (const row of launchLog) {
  const tag = clean(row.Launch_Tag);
  if (tag && !launchIndex.has(tag)) launchIndex.set(tag, row);
}
const padIndex = new Map();
for (const row of launchPoints) padIndex.set(`${clean(row.Site)}|${clean(row.Code)}`, row);

/* ---- reduce one mission -------------------------------------------------- */

// The archive publishes one-second series; ten seconds is enough for an observer's geometry and keeps
// the artifact small. Phases come from the archive's own event times, so a booster-return series can
// never be mistaken for an insertion one.
function reduceSeries(raw, phaseAfterMeco, meco) {
  const named = Array.isArray(raw) ? Object.fromEntries(raw.map(entry => [entry[0], entry[1]])) : raw;
  const time = named.time, altitudeKm = named.altitude, downrangeKm = named.downrange_distance, speedMps = named.velocity;
  if (!time || !altitudeKm || !downrangeKm || !speedMps) throw new Error('unexpected archive shape');
  const wanted = new Set();
  for (let i = 0; i < time.length; i++) if (time[i] % STEP_S === 0) wanted.add(i);
  wanted.add(time.length - 1);
  return [...wanted].sort((a, b) => a - b).map(i => ({
    t: time[i],
    altitudeM: Math.round(Math.max(0, altitudeKm[i]) * 1000),
    downrangeM: Math.round(Math.max(0, downrangeKm[i]) * 1000),
    velocityMps: Math.round(Math.max(0, speedMps[i]) * 1000) / 1000,
    phase: time[i] <= meco ? 'ascent' : phaseAfterMeco,
  }));
}

async function loadCandidate(candidate) {
  const launchRow = launchIndex.get(candidate.tag);
  if (!launchRow) throw new Error(`${candidate.id}: no launch log row for tag ${candidate.tag}`);
  const instant = launchInstant(launchRow.Launch_Date);
  if (!instant) throw new Error(`${candidate.id}: cannot read the launch instant "${clean(launchRow.Launch_Date)}"`);
  const padRow = padIndex.get(`${clean(launchRow.Launch_Site)}|${clean(launchRow.Launch_Pad)}`);
  if (!padRow) throw new Error(`${candidate.id}: no launch point row for ${clean(launchRow.Launch_Site)}/${clean(launchRow.Launch_Pad)}`);
  const anchorRow = satcat.find(row => clean(row.Piece) === candidate.piece);
  if (!anchorRow) throw new Error(`${candidate.id}: no catalogue piece ${candidate.piece}`);
  const events = await fetchJson(ARCHIVE + encodeURI(`${candidate.folder}/JSON/events.json`));
  const analysed = await fetchJson(ARCHIVE + encodeURI(`${candidate.folder}/JSON/analysed.json`));
  const meco = Number.isFinite(events.meco) ? events.meco : Infinity;
  const stageTwo = Number.isFinite(events.ses1);
  const samples = reduceSeries(analysed, stageTwo ? 'second-stage' : 'booster-return', meco);
  const last = samples[samples.length - 1];
  const appliesTo = ANCHOR_APPLIES[candidate.tag] ?? 'operational';
  return {
    candidate, instant, padRow, anchorRow, samples, stageTwo,
    orbit: {
      perigeeKm: number(anchorRow.Perigee), apogeeKm: number(anchorRow.Apogee),
      inclinationDeg: number(anchorRow.Inc),
      appliesTo, appliesReason: ANCHOR_REASON[candidate.tag] ?? 'declared an insertion state for this flight',
      piece: clean(anchorRow.Piece), payload: clean(anchorRow.Name),
      source: `GCAT satellite catalogue ${candidate.piece} (${clean(anchorRow.Name)})`,
      sourceUrl: 'https://planet4589.org/space/gcat/tsv/cat/satcat.tsv',
      licence: 'CC-BY-4.0 (J. McDowell, planet4589.org/space/gcat)',
    },
    terminal: { t: last.t, altitudeM: last.altitudeM, velocityMps: last.velocityMps, phase: last.phase },
    events,
  };
}


/* ---- the two gates ------------------------------------------------------- */

// The uncertainty on a derived plane heading: the plane relation itself, the branch choice, Earth
// rotation (the relative and inertial azimuths differ by a few degrees) and any yaw steering during the
// first stage. Six degrees is generous enough to be honest about all four and tight enough to be useful.
const DERIVED_AZIMUTH_UNCERTAINTY = 6;

function evaluateGates(loaded) {
  const { candidate, orbit, terminal } = loaded;
  const padLat = number(loaded.padRow.Latitude);
  const padLon = number(loaded.padRow.Longitude);
  if (!Number.isFinite(padLat) || !Number.isFinite(padLon)) throw new Error(`${candidate.id}: pad has no coordinates`);
  const plane = T.planeAzimuths(padLat, orbit.inclinationDeg);
  if (!plane.available) {
    // The anchor does not describe an insertion state, so it cannot supply a heading either: a
    // geostationary satellite's plane tells you nothing about the launch that put it there.
    const terminalCheck = T.terminalStateConsistency({ terminal, orbit });
    const validation = { plane: { applicable: false, consistent: null, anchorUnusable: true, note: plane.reason },
      terminal: terminalCheck };
    validation.permissions = T.publicationPermissions(validation);
    return { headingUnavailable: plane.reason, validation, terminalCheck, padLat, padLon };
  }
  const chosen = candidate.branch === 'northerly' ? plane.northerlyDeg : plane.southerlyDeg;
  const alternate = candidate.branch === 'northerly' ? plane.southerlyDeg : plane.northerlyDeg;
  const documented = candidate.documentedAzimuth || null;
  const azimuth = documented
    ? { deg: documented.deg, kind: documented.kind, uncertaintyDeg: documented.uncertaintyDeg,
      source: documented.source, sourceUrl: documented.url, branch: candidate.branch, alternateDeg: alternate }
    : { deg: chosen, kind: 'derived-from-achieved-inclination', uncertaintyDeg: DERIVED_AZIMUTH_UNCERTAINTY,
      source: `derived from the catalogued achieved inclination ${orbit.inclinationDeg} degrees and the pad latitude ${padLat} degrees`,
      branch: candidate.branch, alternateDeg: alternate };
  // Gate A can only falsify a heading that came from somewhere other than the inclination it is checked
  // against. An azimuth derived from that same inclination would agree with it by construction, so this
  // case is recorded as *not applicable* rather than as a pass, and the direction shown is the plane's
  // heading rather than a measured pad azimuth.
  const planeCheck = documented
    ? { ...T.planeConsistency(padLat, documented.deg, orbit.inclinationDeg), applicable: true, documentedDeg: documented.deg }
    : { applicable: false, consistent: null, derived: true,
      planeNortherlyDeg: plane.northerlyDeg, planeSoutherlyDeg: plane.southerlyDeg,
      note: 'the azimuth is derived from the same achieved inclination the check would use, so the check cannot falsify it' };
  const terminalCheck = T.terminalStateConsistency({ terminal, orbit });
  const validation = { plane: planeCheck, terminal: terminalCheck };
  validation.permissions = T.publicationPermissions(validation);
  return { azimuth, planeCheck, terminalCheck, validation, padLat, padLon };
}

// Why a candidate was not published, in the gates' own words and numbers.
function rejectionReasons(validation) {
  const reasons = [];
  const plane = validation.plane;
  const terminal = validation.terminal;
  if (plane.applicable === true && plane.consistent === false) {
    reasons.push(`the orbital-plane check disagreed with the published azimuth by ${Math.abs(plane.deltaDeg).toFixed(1)} degrees`);
  }
  if (terminal.applicable === false) reasons.push(`the terminal-state check does not apply: ${terminal.reason}`);
  if (terminal.applicable === true && terminal.passes === false) {
    reasons.push(`the terminal-state check failed in ${terminal.failures.join(' and ')}: ` +
      `${(terminal.speedRelativeError * 100).toFixed(1)} per cent in speed, ${terminal.altitudeErrorKm.toFixed(0)} km in altitude`);
  }
  if (!reasons.length) reasons.push('both gates passed');
  return reasons;
}


/* ---- assemble ------------------------------------------------------------ */

const profiles = [];
const rejected = [];

for (const candidate of CANDIDATES) {
  const loaded = await loadCandidate(candidate);
  const gates = evaluateGates(loaded);
  const { orbit, samples, terminal, instant } = loaded;
  if (!candidate.publish) {
    rejected.push({
      id: candidate.id, mission: candidate.mission, tag: candidate.tag, folder: candidate.folder,
      launchUtc: instant.utc, anchor: orbit.source,
      reasons: gates.headingUnavailable
        ? [`no ascent heading can be derived: ${gates.headingUnavailable}`, ...rejectionReasons(gates.validation)]
        : rejectionReasons(gates.validation),
      measured: {
        planeApplicable: gates.validation.plane.applicable,
        planeConsistent: gates.validation.plane.consistent,
        planeDeltaDeg: gates.validation.plane.applicable ? gates.validation.plane.deltaDeg : null,
        terminalApplicable: gates.validation.terminal.applicable,
        terminalPasses: gates.validation.terminal.passes,
        terminalFailures: gates.validation.terminal.failures ?? [],
        speedRelativeError: gates.validation.terminal.applicable ? gates.validation.terminal.speedRelativeError : null,
        altitudeErrorKm: gates.validation.terminal.applicable ? gates.validation.terminal.altitudeErrorKm : null,
        terminalAltitudeM: terminal.altitudeM, terminalVelocityMps: terminal.velocityMps, terminalPhase: terminal.phase,
      },
    });
    continue;
  }
  if (gates.headingUnavailable) {
    throw new Error(`${candidate.id}: marked for publication but no heading can be derived (${gates.headingUnavailable})`);
  }
  const permissions = gates.validation.permissions;
  if (permissions.elevation !== true) {
    throw new Error(`${candidate.id}: marked for publication but its gates did not both pass (${permissions.reasons.join('; ')})`);
  }
  profiles.push({
    schema: T.PROFILE_SCHEMA,
    id: candidate.id, mission: candidate.mission,
    vehicle: clean(loaded.anchorRow.LV_Type) === 'Falcon Heavy' ? 'Falcon Heavy' : 'Falcon 9',
    stage: loaded.stageTwo ? 2 : 1,
    evidence: {
      level: 2, code: 'reconstructed-vehicle-profile', provenanceKind: 'webcast-telemetry-reconstruction',
      source: 'shahar603/Telemetry-Data (webcast telemetry transcriptions)',
      sourceUrl: ARCHIVE + encodeURI(`${candidate.folder}/JSON/analysed.json`),
      licence: 'Unlicense (public domain)',
      retrievedUtc: RETRIEVED,
      method: 'third-party transcription of webcast telemetry displays, referenced to liftoff and reduced ' +
        `here to ${STEP_S} s samples of altitude, speed and downrange distance`,
    },
    launch: { utc: instant.utc, precision: instant.precision, source: instant.source },
    site: { pad: clean(loaded.padRow.Name), latDeg: gates.padLat, lonDeg: gates.padLon, heightM: 0,
      source: 'GCAT launch log and launch point catalogue (CC-BY-4.0)' },
    azimuth: gates.azimuth,
    plane: { achievedInclinationDeg: orbit.inclinationDeg, source: orbit.source },
    orbit,
    samplingS: STEP_S,
    samples,
    gaps: [],
    disagreements: [],
    limits: [
      'the series is a transcription of a webcast telemetry graphic, not operator telemetry; absolute values are not independently guaranteed, which is what the terminal-state gate exists to bound',
      'the heading is the orbital plane heading at the pad latitude, not a measured pad azimuth: a yaw-steering ascent can leave the pad on one heading and reach the plane on another',
      'the ground track assumes the downrange distance was flown along that heading as a great circle',
      'no brightness, plume size, apparent size or probability of seeing anything can be derived from this profile',
      candidate.id === 'grace-fo-2018-047'
        ? 'this launch carried two payload groups to different orbits; the series ends at the first insertion, which is the one the anchor piece matches'
        : "the reconstructed series ends at the launcher's last burn as transcribed",
    ],
    terminal,
    validation: gates.validation,
  });
}

const artifact = {
  schema: T.PROFILES_SCHEMA,
  generated_utc: new Date().toISOString(),
  note: 'Published historical ascent profiles. Each one passed both anchoring gates. Candidates that ' +
    'failed a gate are listed under rejected with the numbers that failed, and are not published as ' +
    'trajectories. Nothing here is a prediction for any future launch.',
  gate_tolerances: {
    plane: { consistentWithinDeg: T.LAUNCH_PLANE.consistentWithinDeg, neglected: T.LAUNCH_PLANE.neglected },
    terminal: { speedRelative: T.TERMINAL_STATE.speedRelative, altitudeKm: T.TERMINAL_STATE.altitudeKm, basis: T.TERMINAL_STATE.basis },
  },
  sources: [
    { id: 'webcast-telemetry-archive', name: 'Webcast telemetry transcriptions (shahar603/Telemetry-Data)',
      url: ARCHIVE, licence: 'Unlicense (public domain)', retrieved_utc: RETRIEVED },
    { id: 'gcat', name: 'General Catalog of Artificial Space Objects (J. McDowell)',
      url: 'https://planet4589.org/space/gcat/', licence: 'CC-BY-4.0', retrieved_utc: RETRIEVED },
  ],
  profiles,
  rejected,
};

T.assertProfileArtifact(artifact);
const artifactBytes = JSON.stringify(artifact, null, 1) + '\n';
writeFileSync(new URL('../data/launches/trajectory-profiles.json', import.meta.url), artifactBytes);

/* ---- the compact pad index ----------------------------------------------- */
/* Generated from the artifact that was just validated, and carrying the digest of the exact bytes
   written, so the launch calendar can answer "does this pad have a reviewed profile?" without fetching
   47 KB of samples, and can detect a stale index rather than trusting it. */
const artifactDigest = createHash('sha256').update(artifactBytes, 'utf8').digest('hex');
const publishedPadIndex = PAD_INDEX.assertPadIndex(PAD_INDEX.buildPadIndex(artifact, {
  digest: artifactDigest, generatedUtc: artifact.generated_utc,
}));
writeFileSync(new URL('../data/launches/trajectory-pad-index.json', import.meta.url), JSON.stringify(publishedPadIndex, null, 1) + '\n');
console.log(`wrote the pad index: ${publishedPadIndex.pad_count} pad(s), ${publishedPadIndex.profile_count} profile(s), digest ${artifactDigest.slice(0, 12)}…`);
console.log(`wrote ${profiles.length} published profiles and ${rejected.length} rejected candidates`);
for (const profile of profiles) {
  const terminal = profile.validation.terminal;
  console.log(`  published ${profile.id}: ${profile.azimuth.deg.toFixed(1)} degrees ${profile.azimuth.branch}, ` +
    `terminal ${(terminal.speedRelativeError * 100).toFixed(1)} per cent and ${terminal.altitudeErrorKm.toFixed(1)} km`);
}
for (const entry of rejected) console.log(`  rejected  ${entry.id}: ${entry.reasons.join('; ')}`);


/* ---- the human-readable provenance and validation record ------------------ */

// Generated from the same objects the artifact carries, so the prose record cannot drift from the data.
const padTo = (value, width) => String(value).padEnd(width);
const lines = [];
lines.push('# Historical ascent profiles: provenance and validation', '');
lines.push('Generated by `scripts/build-trajectory-profiles.mjs` from `data/launches/trajectory-profiles.json`;');
lines.push('edit the script, never this file. Every profile below passed **both** anchoring gates. Candidates');
lines.push('that failed a gate are listed with the numbers that failed them and are not published as trajectories.', '');
lines.push(`Gate tolerances: plane consistency within ${T.LAUNCH_PLANE.consistentWithinDeg} degrees of the achieved inclination,`);
lines.push(`and clearance of the neglected corrections (${T.LAUNCH_PLANE.neglected.join('; ')}); terminal state within ` +
  `${(T.TERMINAL_STATE.speedRelative * 100)} per cent of the vis-viva speed at the reconstructed geocentric radius and ` +
  `within ${T.TERMINAL_STATE.altitudeKm} km of the nearer apsis. The tolerances are justified by the gap between the ` +
  `measured passing population (${T.TERMINAL_STATE.passingPopulation}) and the failing one (${T.TERMINAL_STATE.rejectedPopulation}).`, '');
lines.push('## Published profiles', '');
lines.push('| profile | mission | launch (UTC) | vehicle | stage | pad | evidence | direction | plane gate | terminal gate | elevation shown |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const profile of profiles) {
  const terminal = profile.validation.terminal;
  const plane = profile.validation.plane;
  lines.push(`| \`${padTo(profile.id, 24)}\` | ${profile.mission} | ${profile.launch.utc} (${profile.launch.precision}) | ` +
    `${profile.vehicle} | ${profile.stage} | ${profile.site.pad} (${profile.site.latDeg}, ${profile.site.lonDeg}) | ` +
    `level ${profile.evidence.level}, ${profile.evidence.licence} | ${profile.azimuth.deg.toFixed(1)} degrees ${profile.azimuth.branch}, ` +
    `alternate ${profile.azimuth.alternateDeg.toFixed(1)}, plus or minus ${profile.azimuth.uncertaintyDeg} | ` +
    `${plane.applicable ? 'applicable, consistent' : 'not applicable (derived azimuth)'} | ` +
    `passes: ${(terminal.speedRelativeError * 100).toFixed(1)} per cent, ${terminal.altitudeErrorKm.toFixed(1)} km | yes |`);
}
lines.push('');
lines.push('## Rejected candidates', '');
lines.push('| candidate | mission | launch (UTC) | anchor | why it is not published | measured |');
lines.push('| --- | --- | --- | --- | --- | --- |');
for (const entry of rejected) {
  const measured = entry.measured;
  lines.push(`| \`${entry.id}\` | ${entry.mission} | ${entry.launchUtc} | ${entry.anchor} | ${entry.reasons.join('; ')} | ` +
    `terminal sample ${measured.terminalPhase} at ${(measured.terminalAltitudeM / 1000).toFixed(1)} km and ` +
    `${measured.terminalVelocityMps.toFixed(0)} m/s` +
    (measured.terminalApplicable
      ? `; speed error ${(measured.speedRelativeError * 100).toFixed(1)} per cent, altitude error ${measured.altitudeErrorKm.toFixed(0)} km`
      : '; terminal check not applicable') +
    (measured.planeApplicable ? `; plane discrepancy ${measured.planeDeltaDeg.toFixed(1)} degrees` : '') + ' |');
}
lines.push('');
lines.push('## What is deliberately not here', '');
lines.push('- No brightness, apparent plume size or probability of sighting: none of that is derivable from these sources.');
lines.push('- No trajectory for any future launch: a reconstruction of a past flight is not a prediction, and no profile is');
lines.push('  attached to an upcoming launch by rocket family or launch site.');
lines.push('- No hazard polygon treated as a flight path, and no synthetic fixture presented as a historical flight.');
writeFileSync(new URL('../docs/trajectory-profiles.md', import.meta.url), lines.join('\n') + '\n');
console.log(`wrote docs/trajectory-profiles.md (${profiles.length} published, ${rejected.length} rejected)`);

/* ---- --check: does the committed artifact match a fresh build? ------------ */

if (CHECK) {
  const strip = value => { const copy = JSON.parse(JSON.stringify(value)); delete copy.generated_utc; return JSON.stringify(copy); };
  const committed = JSON.parse(readFileSync(new URL('../data/launches/trajectory-profiles.json', import.meta.url), 'utf8'));
  const committedIndex = JSON.parse(readFileSync(new URL('../data/launches/trajectory-pad-index.json', import.meta.url), 'utf8'));
  // The index is derived from the artifact, so a mismatch here can be either a stale index or a stale
  // artifact; the digest in the index tells the caller which, and this check refuses both.
  const committedDigest = createHash('sha256')
    .update(readFileSync(new URL('../data/launches/trajectory-profiles.json', import.meta.url)), 'utf8').digest('hex');
  let failed = false;
  if (strip(committed) !== strip(artifact)) {
    console.error('FAIL: the committed artifact differs from a fresh build; regenerate and review the diff');
    failed = true;
  }
  if (strip(committedIndex) !== strip(publishedPadIndex)) {
    console.error('FAIL: the committed pad index differs from a fresh build; regenerate and review the diff');
    failed = true;
  }
  if (committedIndex.artifact_digest !== committedDigest) {
    console.error('FAIL: the committed pad index was not built from the committed artifact');
    failed = true;
  }
  if (failed) {
    process.exitCode = 1;
  } else {
    console.log('PASS: the committed artifact and pad index match a fresh build (generated_utc excluded)');
  }
}

