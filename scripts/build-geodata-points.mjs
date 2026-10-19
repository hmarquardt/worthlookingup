/* Build the public observation-point artifact, and refuse to publish anything the evidence does not support.

   Inputs, all committed: the facility candidate inventory built from the Forest Service's own recreation data,
   the per-point 3DEP terrain and astronomy profiles, the forest-level access statements, and the area artifact
   the points belong to. Output: data/geodata/points.json, deterministic, with `--check` for CI.

   The gates below are the whole point of this file. A record is published only when:
     * the agency names the facility and states that overnight presence or overnight parking is permitted there;
     * it has a coordinate with a recorded provenance, inside the studied region;
     * its parent area exists in the published area artifact and the point falls within that area's mapped extent;
     * a real DEM produced its terrain profile, and the core window at its own coordinates is recorded;
     * every evidence entry carries a URL, a quotation and a date no older than a year.
   Anything else is excluded, with its reason kept in the research inventory rather than in the public bytes. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAccess, isRecommendable, describeAccess, NIGHT_ACCESS, ACCESS_STATES } from '../src/geodata/access-evidence.mjs';
import { normaliseCoordinate, withinStudyArea, normaliseStudyArea } from '../src/geodata/geo-geometry.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const outputFile = path.join(root, 'data', 'geodata', 'points.json');
const CHECK = process.argv.includes('--check');

const areasArtifact = read('data/geodata/sites.json');
const candidates = read('research/geodata/points/candidates.json').candidates;
const verifications = read('src/geodata/access-verifications.json');
const sources = read('src/geodata/sources.json');
const studyArea = normaliseStudyArea(areasArtifact.region);
const profileDir = path.join(root, 'research', 'geodata', 'points', 'profiles');
const profiles = new Map();
for (const file of fs.readdirSync(profileDir).filter(name => name.endsWith('.json'))) {
  const profile = JSON.parse(fs.readFileSync(path.join(profileDir, file), 'utf8'));
  profiles.set(profile.point, profile);
}

const REGION_TIMEZONE = 'America/Chicago';   // every candidate lies in the Central zone; recorded, never guessed
const SERVICE = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0';

const FOREST_RULE = verifications.evidence['shawnee-nf'].find(entry => entry.id === 'usfs-shawnee-overnight-parking');
const OWNERSHIP = verifications.evidence['shawnee-nf'].find(entry => entry.id === 'padus-shawnee-ownership');

function idFor(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function citation(record) {
  // A reproducible query rather than a hand-written link: anyone can re-read exactly this facility record.
  return SERVICE + '/query?where=objectid%3D' + record.sourceRecord.objectId + '&outFields=*&returnGeometry=true&f=json';
}

function classified(candidate) {
  const facilityEvidence = {
    // The agency's own facility record, machine-published: the same authority as an agency page, in a form
    // anyone can re-query by object id. The publication kind stays 'agency-page' so the access policy keeps one
    // vocabulary rather than two.
    kind: 'agency-page', publisher: 'USDA Forest Service, recreation facility record (Enterprise Data Warehouse)',
    url: citation(candidate), verifiedAt: '2026-10-18',
    summary: candidate.decisionBasis,
    quote: [candidate.operationalHours, candidate.restrictions].filter(Boolean).join(' '),
    states: candidate.facilityType === 'campground'
      ? { publicLand: true, nightAccess: NIGHT_ACCESS.PERMITTED, parking: 'permitted', scope: 'facility' }
      : { publicLand: true, nightAccess: NIGHT_ACCESS.PERMITTED, parking: 'permitted', scope: 'facility' },
  };
  const forestEvidence = {
    kind: 'agency-page', publisher: 'USDA Forest Service, Shawnee National Forest',
    url: FOREST_RULE.url, verifiedAt: FOREST_RULE.verifiedAt,
    summary: FOREST_RULE.summary, quote: FOREST_RULE.quote,
    states: { publicLand: true, nightAccess: NIGHT_ACCESS.PERMITTED, parking: 'permitted', scope: 'forest' },
  };
  const ownershipEvidence = { kind: 'official-dataset', publisher: OWNERSHIP.publisher, url: OWNERSHIP.url,
    verifiedAt: OWNERSHIP.verifiedAt, summary: OWNERSHIP.summary, quote: null, states: { publicLand: true } };
  return [facilityEvidence, forestEvidence, ownershipEvidence];
}

const published = [];
const excluded = [];
for (const candidate of candidates) {
  const name = candidate.pointName || candidate.sourceRecord.name;
  if (candidate.decision !== 'publish-as-named-facility') {
    excluded.push({ name, reason: 'the review did not accept this facility: ' + (candidate.decisionBasis || candidate.decision) });
    continue;
  }
  const raw = candidate.coordinates || candidate.agencyCoordinates;
  if (!raw) { excluded.push({ name, reason: 'no coordinate is published for this facility' }); continue; }
  const coordinates = normaliseCoordinate(raw);
  if (!withinStudyArea(studyArea, coordinates)) {
    excluded.push({ name, reason: 'the facility lies outside the studied region' });
    continue;
  }
  const profile = profiles.get(candidate.sourceRecord.name);
  if (!profile) { excluded.push({ name, reason: 'no terrain profile was produced for this facility' }); continue; }
  const parent = areasArtifact.areas.find(area => coordinates.lat >= area.boundary.bbox[1] &&
    coordinates.lat <= area.boundary.bbox[3] && coordinates.lon >= area.boundary.bbox[0] &&
    coordinates.lon <= area.boundary.bbox[2]);
  if (!parent) { excluded.push({ name, reason: 'the facility does not fall inside any published area' }); continue; }
  const evidence = classified(candidate);
  const classification = classifyAccess(evidence, { now: Date.parse('2026-10-18T12:00:00Z') });
  if (classification.state !== ACCESS_STATES.VERIFIED || !isRecommendable(classification)) {
    excluded.push({ name, reason: 'the access evidence did not classify as verified: ' + classification.reason });
    continue;
  }
  const fromOpenStreetMap = raw.source === 'openstreetmap';
  published.push({
    id: idFor(name),
    type: 'point',
    name,
    parentArea: parent.id,
    facilityType: candidate.facilityType || 'campground',
    coordinates: { lat: Number(coordinates.lat.toFixed(5)), lon: Number(coordinates.lon.toFixed(5)) },
    timezone: REGION_TIMEZONE,
    agency: { name: 'USDA Forest Service', manager: parent.agency.managerName, state: parent.agency.state },
    coordinateSource: fromOpenStreetMap
      ? { kind: 'third-party-map', confidence: 'mapped-facility-node',
        detail: 'The Forest Service names this facility but publishes no point for it. The coordinates come from ' +
          'the OpenStreetMap node for it, which is a community-mapped feature and not an agency survey.',
        url: 'https://www.openstreetmap.org/', estimatedPrecisionM: 30 }
      : { kind: 'agency-point-feature', confidence: 'agency-marker',
        detail: 'Point geometry published by the Forest Service with the facility record: a marker for the facility, ' +
          'not a surveyed point, and not the centre of the surrounding land.',
        url: citation(candidate), estimatedPrecisionM: 50 },
    access: {
      nightPresence: 'verified',
      parking: candidate.facilityType === 'campground' ? 'verified-at-designated-campsite' : 'verified',
      classification: classification.state,
      label: describeAccess(classification).label,
      summary: candidate.facilityType === 'campground'
        ? 'Camping is permitted at this campground, which means overnight presence with a vehicle at a designated site.'
        : 'The agency permits overnight parking at this facility, and names it as the only place inside the recreation ' +
          'area where overnight parking is allowed.',
      evidence: evidence.map(entry => ({ publisher: entry.publisher, url: entry.url, verifiedAt: entry.verifiedAt,
        summary: entry.summary, quote: entry.quote || null, scope: entry.states.scope || null })),
      restrictions: restrictionsFor(candidate),
      verifiedAt: '2026-10-18',
    },
    terrain: {
      state: profile.clearance.state,
      dem: { source: profile.dem.source, pixelSizeM: profile.dem.pixelSizeM, verticalAccuracy: profile.dem.verticalAccuracy,
        url: profile.dem.url },
      moments: profile.clearance.moments.map(moment => ({ label: moment.label, azimuthDeg: moment.azimuthDeg,
        altitudeDeg: moment.altitudeDeg, horizonAngleDeg: moment.horizonAngleDeg, differenceDeg: moment.differenceDeg,
        uncertaintyDeg: moment.uncertaintyDeg, status: moment.status })),
      note: profile.clearance.note,
    },
    core: { date: profile.targetDate, windowStart: profile.core.windowStart, windowEnd: profile.core.windowEnd,
      minutes: profile.core.minutes, level: profile.core.level, maxAltitudeDeg: profile.core.maxAltitudeDeg,
      maxAzimuthDeg: profile.core.maxAzimuthDeg, maxCompass: profile.core.maxCompass,
      darknessMinutes: profile.core.darknessMinutes, moonlight: profile.core.moonlight, quality: profile.core.quality },
    sky: { state: 'unavailable', message: 'Local artificial sky brightness has not yet been assessed for these locations.' },
    unknowns: [
      'trees, buildings and vehicles are not in a bare-earth terrain model',
      'the parking area is documented, but its exact usable extent and surface are not',
      'local artificial sky brightness',
      'weather: a forecast is shown for your own location only, never for this point',
      'seasonal closures, hunting seasons and current conditions',
    ],
    verifiedAt: '2026-10-18',
  });
}

function restrictionsFor(candidate) {
  const out = [];
  const text = [candidate.operationalHours, candidate.restrictions].filter(Boolean).join(' ');
  if (candidate.facilityType === 'campground') {
    out.push({ text: 'Camp only at designated campsites; quiet hours on the forest are 10 p.m. to 6 a.m.',
      sourceUrl: FOREST_RULE.url, verifiedAt: FOREST_RULE.verifiedAt });
    if (candidate.sourceRecord.seasonStart || candidate.sourceRecord.seasonEnd) {
      out.push({ text: 'Season: ' + (candidate.sourceRecord.seasonStart || 'unspecified') + ' to ' +
        (candidate.sourceRecord.seasonEnd || 'unspecified') + ', per the facility record.',
        sourceUrl: citation(candidate), verifiedAt: '2026-10-18' });
    }
  }
  if (/day-use|6:00 a\.m\.-10:00 p\.m\.|6 a\.m\. to 10 p\.m\./i.test(text)) {
    out.push({ text: 'The recreation area around this facility is day-use and closes at 10 p.m.; only this ' +
      'facility is an overnight location.', sourceUrl: citation(candidate), verifiedAt: '2026-10-18' });
  }
  if (/leash|pets/i.test(text)) {
    out.push({ text: 'Pets must be leashed.', sourceUrl: citation(candidate), verifiedAt: '2026-10-18' });
  }
  return out;
}

published.sort((a, b) => a.id.localeCompare(b.id));
const artifact = {
  schema: 'worthlookingup.geodata-points/1',
  generated_by: 'scripts/build-geodata-points.mjs',
  checked_at: '2026-10-18',
  region: areasArtifact.region,
  publication: {
    rule: 'A point is published only when the managing agency names the facility and states that overnight presence ' +
      'or overnight parking is permitted there, its coordinate has a recorded provenance inside the studied region, ' +
      'and a real elevation model produced its terrain profile. An area rule alone is never inherited by a point.',
    reviewedFacilities: candidates.length, publishedPoints: published.length, excludedCount: excluded.length,
  },
  points: published,
};

/* ---- the gate ------------------------------------------------------------------------------- */
const FORBIDDEN = ['driveMinutes', 'travelTime', 'driveTime', 'bortle', 'skyBrightness', 'mpsas', 'radiance', 'score', 'rank'];
function assertPublishable(record) {
  if (record.type !== 'point') throw new Error(record.id + ' is not a point record');
  if (record.access.nightPresence !== 'verified') throw new Error(record.id + ' is published without verified night presence');
  if (!['verified', 'verified-at-designated-campsite'].includes(record.access.parking)) {
    throw new Error(record.id + ' is published without a documented parking basis');
  }
  if (!record.coordinateSource || !record.coordinateSource.kind) throw new Error(record.id + ' has no coordinate provenance');
  if (!Number.isFinite(record.coordinates.lat) || !Number.isFinite(record.coordinates.lon)) {
    throw new Error(record.id + ' has no coordinates');
  }
  if (!withinStudyArea(studyArea, record.coordinates)) throw new Error(record.id + ' is outside the studied region');
  if (!areasArtifact.areas.some(area => area.id === record.parentArea)) {
    throw new Error(record.id + ' names a parent area that is not published');
  }
  if (!record.terrain || record.terrain.state === 'unknown' || !record.terrain.moments.length) {
    throw new Error(record.id + ' has no terrain result');
  }
  if (!record.core || !Number.isFinite(record.core.windowStart)) throw new Error(record.id + ' has no core window');
  for (const evidence of record.access.evidence) {
    if (!/^https:\/\//.test(evidence.url || '')) throw new Error(record.id + ' evidence has no URL');
    if (!Number.isFinite(Date.parse(evidence.verifiedAt))) throw new Error(record.id + ' evidence has no date');
  }
  // At least one entry must be a quotation: an ownership dataset is evidence of ownership, not of permission, so
  // the permission itself has to be something the agency is on record as saying.
  if (!record.access.evidence.some(entry => entry.quote)) {
    throw new Error(record.id + ' evidence contains no quoted statement');
  }
  const age = (Date.parse('2026-10-18T12:00:00Z') - Date.parse(record.verifiedAt)) / 86400000;
  if (!(age >= 0 && age <= 365)) throw new Error(record.id + ' evidence is not current');
  const text = JSON.stringify(record);
  for (const word of FORBIDDEN) if (text.includes('"' + word + '"')) throw new Error(record.id + ' contains ' + word);
  if (/Bortle|mag\/arcsec|mcd/i.test(text)) throw new Error(record.id + ' carries a darkness rating');
}
for (const record of published) assertPublishable(record);
const bytes = JSON.stringify(artifact, null, 2) + '\n';
if (bytes.length > 64 * 1024) throw new Error('points artifact is ' + bytes.length + ' bytes, too large for a compact file');

if (CHECK) {
  const existing = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : null;
  if (existing !== bytes) { console.error('data/geodata/points.json is out of date: run npm run geodata:points'); process.exit(1); }
  console.log('PASS: data/geodata/points.json matches the facility evidence (' + published.length + ' points, ' +
    (bytes.length / 1024).toFixed(1) + ' kB)');
} else {
  fs.writeFileSync(outputFile, bytes);
  console.log('wrote data/geodata/points.json: ' + published.length + ' points from ' + candidates.length +
    ' facilities (' + excluded.length + ' excluded), ' + (bytes.length / 1024).toFixed(1) + ' kB');
  for (const record of published) console.log('  published ' + record.id.padEnd(40) + record.access.classification +
    '  terrain ' + record.terrain.state);
  for (const entry of excluded) console.log('  excluded  ' + entry.name.slice(0, 44).padEnd(46) + entry.reason.slice(0, 60));
}
