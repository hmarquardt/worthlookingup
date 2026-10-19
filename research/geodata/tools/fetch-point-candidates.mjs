/* Build the observation-point candidate inventory from the Forest Service's own recreation data.

   The source is the USFS Enterprise Data Warehouse "Recreation Opportunities" feature service: every facility
   carries its name, a point, an activity group, operational hours and restrictions, in the agency's own words.
   That is what makes a facility-level decision possible at all — a forest-wide rule can say "overnight parking
   at trailheads" but only the facility record can say which trailhead, or that a picnic area closes at 10 p.m.

   This tool records every facility and my decision about it, including the refusals. Nothing here is derived
   from OSM: OSM appears later, and only as a coordinate source for one facility the agency names but does not
   place.

   Run: node research/geodata/tools/fetch-point-candidates.mjs
   Network required; never part of `npm test`. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, '..', 'points', 'candidates.json');
const SERVICE = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query';

/* Decisions are by facility name. `publish` means the agency's own record permits overnight presence at that
   named facility; `reject` means it forbids it or places it somewhere that is not reachable or not open;
   `unverified` means nothing in the record addresses overnight use, which is not the same as permission. */
const DECISIONS = {
  'Garden of the Gods Recreation Area': {
    decision: 'publish-as-named-facility',
    // The recreation area itself is day-use; the record names a different, eligible facility inside it.
    pointName: "Garden of the Gods backpacker parking (Indian Point Trailhead)",
    facilityType: 'trailhead-parking',
    coordinates: { lat: 37.6001, lon: -88.38117, source: 'openstreetmap',
      note: 'The Forest Service names this lot but publishes no point for it; the coordinates come from the ' +
        'OpenStreetMap node "Backpackers Parking", about 300 m west of the recreation-area marker.' },
    reasoning: 'The facility record permits overnight parking at this lot only, and closes the picnic area and ' +
      'Observation Trail from 10 p.m. to 6 a.m.',
  },
  'Panther Den Wilderness': {
    decision: 'publish-as-named-facility',
    pointName: 'Panther Den Wilderness trailhead',
    facilityType: 'trailhead-parking',
    reasoning: 'The agency marks this as a trailhead, and the forest\'s camping page permits overnight parking at ' +
      'trailheads such as this; vehicles cannot enter the wilderness itself.',
  },
  'Camp Cadiz Campground': { decision: 'publish-as-named-facility', facilityType: 'campground',
    reasoning: 'Camping is permitted year-round at designated campsites, which is overnight presence with a vehicle.' },
  'Pine Hills Campground': { decision: 'publish-as-named-facility', facilityType: 'campground',
    reasoning: 'Listed as open year-round and used for camping.' },
  'Tower Rock Campground': { decision: 'publish-as-named-facility', facilityType: 'campground',
    reasoning: 'Camping is free and limited to 14 continuous days; the season runs 1 May to 15 December.' },
  'Bell Smith Springs Recreation Area': {
    decision: 'publish-as-named-facility', pointName: 'Redbud Campground (Bell Smith Springs)',
    facilityType: 'campground',
    reasoning: 'The record states that Redbud Campground is open 15 March to 15 December; the trail system is open ' +
      'year-round, but the overnight facility is the campground.' },
  'Illinois Iron Furnace Historic Site': { decision: 'reject',
    reason: 'The agency record says "No overnight parking", which is an explicit prohibition at this facility.',
    parking: 'prohibited' },
  'High Knob Lookout': { decision: 'reject',
    reason: 'Day-use only, 6 a.m. to 10 p.m. The record allows overnight parking outside the site near the stone ' +
      'pillar entrance, but the agency publishes no point for that spot, so there is nothing to place on a map.' },
  'Oakwood Bottoms & Turkey Bayou Campground': { decision: 'reject',
    reason: 'The agency record reports the campground and boat launch temporarily closed due to flooding, so a ' +
      'camping permission there cannot be relied on until it reopens.' },
  'Trigg Observation Tower': { decision: 'reject',
    reason: 'The forest\'s own alerts page listed the tower as temporarily closed, and the facility record says ' +
      'nothing about overnight use.' },
  'Lusk Creek Canoe/Kayak Access': { decision: 'unverified',
    reason: 'No statement addresses overnight presence; camping is prohibited in the natural areas of the ' +
      'wilderness, so the access point cannot be assumed to be an overnight location.', parking: 'unknown' },
};

const DEFAULT = { decision: 'unverified',
  reason: 'The facility record does not address overnight presence, which is not permission.' };

const params = new URLSearchParams({
  where: "forestname = 'Shawnee National Forest'", outSR: '4326', returnGeometry: 'true', f: 'json',
  outFields: 'objectid,recareaname,recareaid,markeractivitygroup,operational_hours,restrictions,recareaurl,open_season_start,open_season_end,openstatus,longitude,latitude',
});
const response = await fetch(SERVICE + '?' + params, { headers: { 'user-agent': 'worthlookingup-geodata-research/0.1' } });
if (!response.ok) throw new Error('USFS recreation service failed: HTTP ' + response.status);
const body = await response.json();
const features = body.features || [];
if (!features.length) throw new Error('the USFS recreation service returned no features');

const strip = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const candidates = features.map((feature) => {
  const a = feature.attributes;
  const decision = DECISIONS[a.recareaname] || DEFAULT;
  const geometry = feature.geometry || {};
  return {
    sourceRecord: { objectId: a.objectid, recAreaId: a.recareaid, recAreaUrl: a.recareaurl,
      name: a.recareaname, activityGroup: a.markeractivitygroup, openStatus: a.openstatus,
      seasonStart: a.open_season_start, seasonEnd: a.open_season_end },
    agencyCoordinates: Number.isFinite(geometry.y) && Number.isFinite(geometry.x)
      ? { lat: Number(geometry.y.toFixed(5)), lon: Number(geometry.x.toFixed(5)) } : null,
    operationalHours: strip(a.operational_hours) || null,
    restrictions: strip(a.restrictions) || null,
    decision: decision.decision,
    decisionBasis: decision.reasoning || decision.reason,
    ...(decision.decision === 'publish-as-named-facility'
      ? { pointName: decision.pointName || a.recareaname } : {}),
    ...(decision.facilityType ? { facilityType: decision.facilityType } : {}),
    ...(decision.coordinates ? { coordinates: decision.coordinates } : {}),
    ...(decision.parking ? { parking: decision.parking } : {}),
  };
});

const inventory = {
  schema: 'worthlookingup.geodata-point-candidates/1',
  fetchedAt: new Date().toISOString(),
  source: { id: 'usfs-edw-recreation-opportunities', publisher: 'USDA Forest Service',
    service: SERVICE, note: 'Facility names, points, hours and restrictions as published by the agency. The ' +
      'recarea URLs in this dataset redirect to a general page, so they are recorded as a reference and not as ' +
      'the evidence: the evidence is the facility record itself, which anyone can re-query.' },
  counts: { facilities: candidates.length,
    publish: candidates.filter(c => c.decision === 'publish-as-named-facility').length,
    reject: candidates.filter(c => c.decision === 'reject').length,
    unverified: candidates.filter(c => c.decision === 'unverified').length },
  candidates,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(inventory, null, 2) + '\n');
console.log('wrote ' + candidates.length + ' facilities: ' + JSON.stringify(inventory.counts));
for (const c of candidates.filter(c => c.decision === 'publish-as-named-facility')) {
  console.log('  publish  ' + c.sourceRecord.name + ' -> ' + (c.pointName || '') + ' @ ' +
    JSON.stringify(c.coordinates || c.agencyCoordinates));
}
for (const c of candidates.filter(c => c.decision === 'reject')) console.log('  reject   ' + c.sourceRecord.name);
