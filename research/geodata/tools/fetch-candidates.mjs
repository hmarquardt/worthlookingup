/* Builds the pilot candidate inventory from authoritative data, reproducibly.

   Every candidate is a real record: coordinates come from the PAD-US 4.1 polygon centroid returned by the
   service (never typed in from memory), ownership and protection attributes come from the same record, and
   the access evidence is a quotation from the managing agency's own page with its URL and the date it was
   read. Run with `node research/geodata/tools/fetch-candidates.mjs`; it needs the network and is never part
   of `npm test`.

   What this script will not do: invent a site, upgrade an access state because a dataset carries a
   public-access flag, or fill a gap with a plausible-looking coordinate. If a unit cannot be found it fails
   loudly rather than dropping it. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, '..', 'candidates', 'southern-indiana.json');
const PADUS = 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/PADUS_Management_Areas/FeatureServer/0/query';

// Southern Indiana, western Kentucky and southeastern Illinois, centred on the Princeton/Evansville reach
// of the Wabash and Ohio rivers. A box is enough for a pilot and is trivially replaceable by a polygon.
export const STUDY_AREA = { west: -88.60, south: 37.30, east: -86.30, north: 38.70,
  label: 'Southern Indiana, western Kentucky and southeastern Illinois' };

const WANTED = [
  { key: 'shawnee-nf', match: 'Shawnee National Forest', type: 'federal-forest', rules: ['access.shawnee'] },
  { key: 'garden-of-the-gods', match: 'Garden Of The Gods Wilderness', type: 'federal-wilderness', rules: ['access.shawnee'] },
  { key: 'lusk-creek', match: 'Lusk Creek Wilderness', type: 'federal-wilderness', rules: ['access.shawnee'] },
  { key: 'sugar-ridge-fwa', match: 'Sugar Ridge Fish And Wildlife Area', type: 'state-fish-and-wildlife-area', rules: ['access.sugarridge'] },
  { key: 'glendale-fwa', match: 'Glendale Fish And Wildlife Area', type: 'state-fish-and-wildlife-area', rules: [] },
  { key: 'hovey-lake-fwa', match: 'Hovey Lake Fish And Wildlife Area', type: 'state-fish-and-wildlife-area', rules: [] },
  { key: 'harmonie', match: 'Harmonie State Park', type: 'state-park', rules: [] },
  { key: 'patoka-lake', match: 'Patoka Lake', type: 'federal-reservoir-recreation-area', rules: [] },
  { key: 'higginson-henry', match: 'Higginson-Henry Wildlife Management Area', type: 'state-wildlife-management-area', rules: [] },
  { key: 'wabash-mount-carmel', match: 'Wabash River - Mount Carmel', type: 'private-conservation-area', rules: [] },
  { key: 'aep-rockport', match: 'American Electric Power - Rockport', type: 'private-industrial-land', rules: [] },
];

async function padusQuery(match) {
  const params = new URLSearchParams({
    where: `Unit_Nm LIKE '%${match.replace(/'/g, "''")}%'`,
    geometry: JSON.stringify({ xmin: STUDY_AREA.west, ymin: STUDY_AREA.south, xmax: STUDY_AREA.east,
      ymax: STUDY_AREA.north, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Unit_Nm,Loc_Nm,Own_Type,Own_Name,Mang_Type,Mang_Name,Des_Tp,Loc_Ds,GAP_Sts,Pub_Access,GIS_AcreD,State_Nm,OBJECTID',
    returnCentroid: 'true', returnGeometry: 'false', outSR: '4326', f: 'json',
  });
  const response = await fetch(PADUS + '?' + params, { headers: { 'user-agent': 'worthlookingup-geodata-research/0.1' } });
  if (!response.ok) throw new Error('PAD-US query for ' + match + ' failed: HTTP ' + response.status);
  const body = await response.json();
  if (!body.features || !body.features.length) throw new Error('PAD-US returned no unit matching ' + match);
  const features = body.features.filter(feature => feature.centroid && Number.isFinite(feature.centroid.x));
  if (!features.length) throw new Error('PAD-US returned no centroid for ' + match);
  features.sort((a, b) => (b.attributes.GIS_AcreD || 0) - (a.attributes.GIS_AcreD || 0));
  return features[0];
}

// Access evidence, as quotations from the managing agency with the date read. Only facts and a short quote
// are stored; page text is not republished.
const EVIDENCE = {
  'access.shawnee': {
    kind: 'agency-page', publisher: 'USDA Forest Service, Shawnee National Forest',
    url: 'https://www.fs.usda.gov/r09/shawnee/recreation/camping-cabins', verifiedAt: '2026-10-18',
    summary: 'Overnight parking is permitted where posted, such as trailheads, for overnight camping; day-use areas signed 6 a.m. to 10 p.m. are closed to overnight parking.',
    quote: 'When camping overnight be sure you park where overnight parking is allowed, such as trailheads and do not block roads or gates. Areas signed as Day-Use Areas - open 6am to 10pm are closed to overnight parking.',
    states: { publicLand: true, nightAccess: 'permitted', parking: 'permitted',
      nightWindow: 'trailhead parking for overnight camping; day-use areas closed 22:00-06:00' },
  },
  // Sugar Ridge states its property hours as 24/7, which is permission to be there after dark. Parking is
  // covered by the same whole-property statement rather than documented separately, and the record says so.
  'access.sugarridge': {
    kind: 'agency-rule', publisher: 'Indiana Department of Natural Resources',
    url: 'https://www.in.gov/dnr/fish-and-wildlife/properties/sugar-ridge-fwa/', verifiedAt: '2026-10-18',
    summary: 'The property page states 24/7 property hours, which permits presence on the property after dark; parking is covered by the same statement and is not documented separately.',
    quote: 'Property hours 24/7. Some activities may have specific open times, especially if there is a draw.',
    states: { publicLand: true, nightAccess: 'permitted', parking: 'on-site-by-property-hours', scope: 'property',
      nightWindow: '24/7 property hours, with activity-specific exceptions posted at the property' },
  },
  'access.dnr': {
    kind: 'agency-rule', publisher: 'Indiana Department of Natural Resources',
    url: 'https://www.in.gov/dnr/fish-and-wildlife/properties/atterbury-fwa/', verifiedAt: '2026-10-18',
    summary: 'Indiana DNR fish and wildlife properties state hours of 7 a.m. to 11 p.m. unless engaged in an authorized activity, so the property is closed well before a spring core window reaches its best.',
    quote: 'Property: 7 a.m. to 11 p.m. unless engaged in authorized activity.',
    states: { publicLand: true, nightAccess: 'restricted', nightWindow: '07:00-23:00' },
  },
  'padus.public': {
    kind: 'official-dataset', publisher: 'USGS PAD-US 4.1', verifiedAt: '2026-10-18',
    url: 'https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview',
    summary: 'PAD-US records ownership, management, protection status and an agency-reported public-access flag. It does not record opening hours or nighttime permission.',
    quote: null, states: { publicLand: true },
  },
  'padus.private': {
    kind: 'official-dataset', publisher: 'USGS PAD-US 4.1', verifiedAt: '2026-10-18',
    url: 'https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview',
    summary: 'PAD-US records non-governmental ownership or management for this unit, with no public permission recorded.',
    quote: null, states: { publicLand: false, ownership: 'private' },
  },
};

function evidenceFor(unit, rules) {
  const own = String(unit.Own_Type || '').toUpperCase(), manager = String(unit.Mang_Type || '').toUpperCase();
  const isPrivate = ['PVT', 'NGO'].includes(own) || ['PVT', 'NGO'].includes(manager);
  return [EVIDENCE[isPrivate ? 'padus.private' : 'padus.public'], ...rules.map(rule => EVIDENCE[rule]).filter(Boolean)];
}

const candidates = [];
for (const wanted of WANTED) {
  const feature = await padusQuery(wanted.match);
  const unit = feature.attributes;
  candidates.push({
    id: wanted.key,
    name: unit.Unit_Nm,
    type: wanted.type,
    coordinates: { lat: Number(feature.centroid.y.toFixed(6)), lon: Number(feature.centroid.x.toFixed(6)) },
    coordinateSource: { sourceId: 'usgs-padus-4-1',
      method: 'largest matching polygon centroid returned by the PAD-US service (returnCentroid, EPSG:4326)',
      unitName: unit.Unit_Nm, objectId: unit.OBJECTID },
    ownership: { ownerType: unit.Own_Type, ownerName: unit.Own_Name, managerType: unit.Mang_Type,
      managerName: unit.Mang_Name, designation: unit.Des_Tp, designationDetail: unit.Loc_Ds,
      gapStatus: unit.GAP_Sts, publicAccessFlag: unit.Pub_Access, acres: Math.round(unit.GIS_AcreD || 0),
      state: unit.State_Nm, sourceId: 'usgs-padus-4-1' },
    accessEvidence: evidenceFor(unit, wanted.rules),
    unresolved: wanted.rules.length ? [] : ['no authoritative statement about access after dark was found for this unit'],
    verifiedAt: '2026-10-18',
  });
}

const inventory = {
  schema: 'worthlookingup.geodata-candidates/1',
  generated_by: 'research/geodata/tools/fetch-candidates.mjs',
  generated_at: new Date().toISOString(),
  studyArea: STUDY_AREA,
  status: 'research-only: not a recommendation, not published, and not verified on the ground',
  sources: ['usgs-padus-4-1', 'usfs-shawnee', 'indiana-dnr-properties'],
  candidates,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(inventory, null, 2) + '\n');
console.log('wrote ' + candidates.length + ' candidates to ' + path.relative(process.cwd(), outFile));
for (const c of candidates) {
  console.log('  ' + c.id.padEnd(24) + String(c.name).slice(0, 38).padEnd(40) +
    c.coordinates.lat.toFixed(4) + ',' + c.coordinates.lon.toFixed(4) + '  ' +
    c.ownership.ownerType + '/' + c.ownership.managerType + '  ' + Math.round(c.ownership.acres) + ' ac  ' +
    'Pub_Access=' + c.ownership.publicAccessFlag);
}
