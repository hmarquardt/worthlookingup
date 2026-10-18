/* Build the public "where to go" artifact from verified evidence, and refuse to publish anything else.

   Inputs, all committed: the Phase 6B.1 candidate inventory (real PAD-US records), the simplified PAD-US
   boundaries, the re-verified agency statements in src/geodata/access-verifications.json, the licence
   inventory in src/geodata/sources.json, and the pilot terrain profiles.

   Output: data/geodata/sites.json, deterministic and byte-stable. `--check` regenerates in memory and fails
   if the committed file differs, which is what CI runs.

   The rules below are enforced here, not merely documented: a record without verified after-dark access is
   excluded, an area is never given a point's coordinates, no parking is invented, no drive time or sky
   brightness is emitted, and every claim carries its source and date. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAccess, isRecommendable, describeAccess } from '../src/geodata/access-evidence.mjs';
import { normaliseStudyArea, withinStudyArea } from '../src/geodata/geo-geometry.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const outputFile = path.join(root, 'data', 'geodata', 'sites.json');
const CHECK = process.argv.includes('--check');

const inventory = read('research/geodata/candidates/southern-indiana.json');
const verifications = read('src/geodata/access-verifications.json');
const sources = read('src/geodata/sources.json');
const studyArea = normaliseStudyArea(inventory.studyArea);

// Regional terrain context comes from the pilot profiles, so the public artifact quotes numbers that the
// repository can reproduce rather than numbers typed into a template.
const profileDir = path.join(root, 'research', 'geodata', 'profiles');
const profiles = fs.readdirSync(profileDir).filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(fs.readFileSync(path.join(profileDir, name), 'utf8')));
const horizons = profiles.flatMap(profile => profile.profile.map(entry => entry.maxAngleDeg)).filter(Number.isFinite);
const regionalTerrain = {
  state: 'regional-context-only',
  note: 'A parcel has no single horizon, and the centre of a parcel has no verified observation point. These are ' +
    'the steepest modelled direction at each of the pilot\'s sampled points, offered as regional context only; ' +
    'a clearance angle needs a specific observation point, which this release does not have.',
  steepestDirectionMinDeg: Number(Math.min(...horizons).toFixed(2)),
  steepestDirectionMaxDeg: Number(Math.max(...horizons).toFixed(2)),
  sampledPoints: profiles.length,
  source: 'usgs-3dep', demoPixelSizeM: Math.round(profiles[0].dem.pixelSizeM),
  bareEarth: 'Bare earth only: trees, crops, buildings, levees and vehicles are not in the model.',
};

/* Evidence for one unit is the Phase 6B.1 inventory's ownership record plus every re-verified agency
   statement that says it applies to this unit. The classifier then decides, so an exclusion states its own
   reason (private land, public land with no hours, or nothing at all) rather than a generic one. */
function evidenceFor(unitId, candidate) {
  const out = (candidate.accessEvidence || []).map(statement => ({
    id: statement.id || null, kind: statement.kind, publisher: statement.publisher, url: statement.url,
    verifiedAt: statement.verifiedAt, summary: statement.summary, quote: statement.quote || null,
    states: statement.states || {},
  }));
  for (const list of Object.values(verifications.evidence)) {
    for (const statement of list) {
      if (!Array.isArray(statement.appliesTo) || !statement.appliesTo.includes(unitId)) continue;
      if (out.some(entry => entry.id === statement.id)) continue;
      out.push({
        id: statement.id, kind: statement.kind, publisher: statement.publisher, url: statement.url,
        verifiedAt: statement.verifiedAt, summary: statement.summary, quote: statement.quote || null,
        states: statement.states || {},
      });
    }
  }
  return out;
}

function boundaryFor(unitId) {
  const file = path.join(root, 'research', 'geodata', 'boundaries', unitId + '.json');
  if (!fs.existsSync(file)) return null;
  const boundary = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    rings: boundary.rings, bbox: boundary.bbox,
    provenance: {
      source: boundary.source.id, objectId: boundary.source.objectId,
      url: 'https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview',
      method: boundary.source.method, note: boundary.source.note,
      ringsKept: boundary.source.ringsKept, ringsTotal: boundary.source.ringsTotal,
    },
  };
}

const DESIGNATION_LABELS = {
  NF: 'National Forest', WA: 'Wilderness Area', SCA: 'State conservation area',
  SP: 'State Park', WMA: 'Wildlife Management Area', NRA: 'National Recreation Area',
};
function designationLabel(code) {
  return DESIGNATION_LABELS[code] || String(code || 'unclassified');
}

const published = [];
const excluded = [];
for (const candidate of inventory.candidates) {
  const evidence = evidenceFor(candidate.id, candidate);
  const classification = classifyAccess(evidence, { now: Date.parse(verifications.checked_at + 'T12:00:00Z') });
  const boundary = boundaryFor(candidate.id);
  const review = verifications.review[candidate.id];
  if (!isRecommendable(classification)) {
    excluded.push({ id: candidate.id, state: classification.state, reason: classification.reason,
      reviewed: review ? review.reason : null });
    continue;
  }
  if (review && review.outcome === 'excluded') {
    excluded.push({ id: candidate.id, state: classification.state, reason: 'excluded by review', reviewed: review.reason });
    continue;
  }
  if (!boundary) throw new Error(candidate.id + ' is verified but has no boundary; run the boundary fetch tool');
  const described = describeAccess(classification);
  const restrictions = [];
  for (const statement of evidence) {
    if (statement.states && statement.states.vehicleAccess === 'prohibited') {
      restrictions.push({ text: 'Vehicles and mechanized equipment are prohibited inside the wilderness; entry is on foot.',
        sourceUrl: statement.url, verifiedAt: statement.verifiedAt, quote: statement.quote });
    }
    if (statement.states && statement.states.nightWindow) {
      restrictions.push({ text: statement.states.nightWindow, sourceUrl: statement.url, verifiedAt: statement.verifiedAt,
        quote: statement.quote });
    }
  }
  // The USFS day-use rule is part of the same page as the parking permission, and it is a restriction on where
  // a vehicle may stay overnight, so it is surfaced even when the statement itself is the permission.
  const dayUse = evidence.find(statement => statement.id === 'usfs-shawnee-overnight-parking');
  if (dayUse) {
    restrictions.push({ text: 'Day-use areas signed 6 a.m. to 10 p.m. are closed to overnight parking.',
      sourceUrl: dayUse.url, verifiedAt: dayUse.verifiedAt, quote: dayUse.quote });
  }
  published.push({
    id: candidate.id,
    type: 'area',
    name: candidate.name,
    agency: { owner: candidate.ownership.ownerType, manager: candidate.ownership.managerType,
      managerName: candidate.ownership.managerName, designation: designationLabel(candidate.ownership.designation),
      designationCode: candidate.ownership.designation,
      state: candidate.ownership.state, acres: Math.round(candidate.ownership.acres),
      source: 'usgs-padus-4-1' },
    boundary,
    access: {
      state: classification.state,
      label: described.label,
      nightWindow: classification.nightWindow || null,
      parkingInferred: Boolean(classification.parkingInferred),
      verifiedAt: verifications.checked_at,
      evidence: evidence.map(statement => ({ id: statement.id, publisher: statement.publisher, url: statement.url,
        verifiedAt: statement.verifiedAt, summary: statement.summary, quote: statement.quote })),
    },
    restrictions: dedupe(restrictions),
    terrain: regionalTerrain,
    sky: {
      state: 'unavailable',
      message: 'Local artificial sky brightness has not yet been assessed for these locations.',
      note: 'No commercially licensed, machine-readable sky-brightness dataset is available. Upward satellite ' +
        'radiance is not ground sky brightness and is not converted here.',
    },
    distance: { kind: 'great-circle', reference: 'nearest mapped boundary',
      note: 'Straight-line distance to the nearest mapped edge of the area. An edge is a management boundary, ' +
        'not an entrance, not a road, and not a destination; no driving distance or travel time is computed.' },
    unknowns: [
      'no verified observation point, trailhead, gate or parking place for this release',
      'local horizon: bare-earth terrain only, vegetation not modelled',
      'local artificial sky brightness',
      'road access, driving distance and travel time',
      'seasonal closures, hunting seasons and current conditions',
    ],
    verifiedAt: verifications.checked_at,
  });
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(entry => {
    const key = entry.text + '|' + entry.sourceUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

published.sort((a, b) => a.id.localeCompare(b.id));
const artifact = {
  schema: 'worthlookingup.geodata-sites/1',
  generated_by: 'scripts/build-geodata-sites.mjs',
  checked_at: verifications.checked_at,
  region: { id: 'southern-indiana', label: studyArea.label, west: studyArea.west, east: studyArea.east,
    south: studyArea.south, north: studyArea.north,
    note: 'Location exploration is available only in this researched region. Milky Way calculations continue ' +
      'worldwide for the location you choose.' },
  publication: {
    rule: 'Only areas whose after-dark access is documented by the managing agency, with a legal place to park ' +
      'or a documented standing permission, are published. Ownership alone is not permission.',
    publishedAreas: published.length, reviewedCandidates: inventory.candidates.length,
    excludedCount: excluded.length,
  },
  terrain: regionalTerrain,
  sky: { state: 'unavailable', message: 'Local artificial sky brightness has not yet been assessed for these locations.' },
  limitations: [
    'These are areas, not observation points: no parking place, trailhead, gate or tripod position is verified.',
    'An area has no single horizon; a clearance angle needs a specific observation point.',
    'Bare-earth terrain only: trees, crops, buildings and levees are not modelled.',
    'No artificial sky brightness is assessed, so no area is described as dark.',
    'Distances are straight-line to the nearest mapped boundary: not a drive, and no travel time is implied.',
    'Check the agency source and current conditions before travelling; seasonal closures and hunting seasons apply.',
  ],
  attribution: [attributionFor('usgs-padus-4-1'), attributionFor('usgs-3dep')],
  areas: published,
};

function attributionFor(id) {
  const source = sources.sources.find(entry => entry.id === id);
  return { id, publisher: source.publisher, product: source.product,
    attribution: source.licence.attribution, licence: source.licence.name };
}

/* ---- the gate ------------------------------------------------------------------------------- */
const FORBIDDEN = ['coordinates', 'latitude', 'longitude', 'parkingLot', 'trailhead', 'travelTime',
  'driveMinutes', 'driveTime', 'bortle', 'skyBrightness', 'mpsas', 'radiance', 'score', 'rank'];
function assertPublishable(record) {
  if (record.type !== 'area') throw new Error(record.id + ' is not an area record');
  if (record.access.state !== 'verified-night-access') throw new Error(record.id + ' is published without verified access');
  if (!record.boundary || !Array.isArray(record.boundary.rings) || !record.boundary.rings.length) {
    throw new Error(record.id + ' has no mapped boundary');
  }
  for (const ring of record.boundary.rings) {
    if (!Array.isArray(ring) || ring.length < 4) throw new Error(record.id + ' has a degenerate ring');
    for (const pair of ring) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite)) {
        throw new Error(record.id + ' has a malformed boundary coordinate');
      }
    }
  }
  // The studied box is where candidates were searched, not a clip: a real forest crosses its edge, so the
  // requirement is that the mapped extent actually overlaps the region, not that it fits inside it.
  const xs = record.boundary.rings.flat().map(pair => pair[0]), ys = record.boundary.rings.flat().map(pair => pair[1]);
  const overlaps = Math.max(...xs) >= studyArea.west && Math.min(...xs) <= studyArea.east &&
    Math.max(...ys) >= studyArea.south && Math.min(...ys) <= studyArea.north;
  if (!overlaps) throw new Error(record.id + ' does not overlap the studied region');
  if (!record.access.evidence.length) throw new Error(record.id + ' has no access evidence');
  for (const evidence of record.access.evidence) {
    if (!/^https:\/\//.test(evidence.url || '')) throw new Error(record.id + ' has evidence without a URL');
    if (!Number.isFinite(Date.parse(evidence.verifiedAt))) throw new Error(record.id + ' has evidence without a date');
  }
  const text = JSON.stringify(record).toLowerCase();
  for (const word of FORBIDDEN) {
    if (text.includes('"' + word.toLowerCase() + '"')) throw new Error(record.id + ' contains a forbidden field: ' + word);
  }
}
for (const record of artifact.areas) assertPublishable(record);
const bytes = JSON.stringify(artifact, null, 2) + '\n';
if (bytes.length > 96 * 1024) throw new Error('artifact is ' + bytes.length + ' bytes, which is larger than a compact static file should be');

if (CHECK) {
  const existing = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : null;
  if (existing !== bytes) {
    console.error('data/geodata/sites.json is out of date: run npm run geodata:sites');
    process.exit(1);
  }
  console.log('PASS: data/geodata/sites.json matches the verified evidence (' + artifact.areas.length +
    ' areas, ' + (bytes.length / 1024).toFixed(1) + ' kB)');
} else {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, bytes);
  console.log('wrote data/geodata/sites.json: ' + artifact.areas.length + ' areas from ' +
    inventory.candidates.length + ' reviewed candidates (' + excluded.length + ' excluded), ' +
    (bytes.length / 1024).toFixed(1) + ' kB');
  for (const record of artifact.areas) console.log('  published ' + record.id.padEnd(22) + record.access.state);
  for (const entry of excluded) console.log('  excluded  ' + entry.id.padEnd(22) + entry.state);
}
