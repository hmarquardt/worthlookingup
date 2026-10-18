/* Fetch the mapped boundary of each published area, simplify it, and record the provenance.

   An area record needs an extent, not a point: a national forest centroid is not an entrance and must never
   be used as one. This tool asks PAD-US for the polygon of each unit and simplifies it locally, because the
   server's own maxAllowableOffset returned an empty geometry for every unit tested on 2026-10-18.

   The simplification is Douglas-Peucker at about 60 m, which keeps a coastline of the forest's scale inside a
   few kilobytes while leaving the outline recognisable. Nothing downstream treats the outline as a property
   boundary: it is "the mapped extent from PAD-US", and the explorer says so.

   Run: node research/geodata/tools/fetch-boundaries.mjs
   Network required; never part of `npm test`. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'boundaries');
const PADUS = 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/PADUS_Management_Areas/FeatureServer/0/query';
const STUDY = { west: -88.6, south: 37.3, east: -86.3, north: 38.7 };

const UNITS = [
  { id: 'shawnee-nf', match: 'Shawnee National Forest' },
  { id: 'garden-of-the-gods', match: 'Garden Of The Gods Wilderness' },
  { id: 'lusk-creek', match: 'Lusk Creek Wilderness' },
  { id: 'sugar-ridge-fwa', match: 'Sugar Ridge Fish And Wildlife Area' },
];

// Tolerances in degrees, coarse to fine. The outline is displayed at about 320 m per pixel, so a 60 m
// tolerance buys detail nobody can see and costs 90 kB; the tool takes the finest tolerance that keeps the
// record under the point budget, and records which one it used.
const TOLERANCES = [0.0003, 0.0006, 0.001, 0.002, 0.004, 0.008, 0.01, 0.015, 0.02, 0.03];
const POINT_BUDGET = 320;

/* Douglas-Peucker, on a closed ring: keep the ends, drop every point within tolerance of the chord. */
function simplifyRing(ring, tolerance) {
  if (ring.length < 5) return ring.slice();
  const first = ring[0], last = ring[ring.length - 1];
  const squared = tolerance * tolerance;
  const distanceSquared = (point, a, b) => {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = point[0] - x; dy = point[1] - y;
    return dx * dx + dy * dy;
  };
  const keep = new Uint8Array(ring.length);
  keep[0] = 1; keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let farthest = 0, index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceSquared(ring[i], ring[start], ring[end]);
      if (d > farthest) { farthest = d; index = i; }
    }
    if (index > 0 && farthest > squared) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring.slice();
}

async function fetchUnit(match) {
  const params = new URLSearchParams({
    where: `Unit_Nm LIKE '%${match.replace(/'/g, "''")}%'`,
    geometry: JSON.stringify({ xmin: STUDY.west, ymin: STUDY.south, xmax: STUDY.east, ymax: STUDY.north,
      spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Unit_Nm,State_Nm,Own_Type,Mang_Type,Mang_Name,Des_Tp,GIS_AcreD,OBJECTID',
    returnGeometry: 'true', outSR: '4326', f: 'json',
  });
  const response = await fetch(PADUS + '?' + params, { headers: { 'user-agent': 'worthlookingup-geodata-research/0.1' } });
  if (!response.ok) throw new Error('PAD-US boundary query for ' + match + ' failed: HTTP ' + response.status);
  const body = await response.json();
  const features = (body.features || []).filter(feature => feature.geometry && feature.geometry.rings);
  if (!features.length) throw new Error('PAD-US returned no polygon for ' + match);
  features.sort((a, b) => (b.attributes.GIS_AcreD || 0) - (a.attributes.GIS_AcreD || 0));
  return features[0];
}

fs.mkdirSync(outDir, { recursive: true });
for (const unit of UNITS) {
  const feature = await fetchUnit(unit.match);
  const raw = feature.geometry.rings.reduce((total, ring) => total + ring.length, 0);
  // A fragmented unit can arrive as hundreds of parcels. The map is drawn at about 320 m per pixel, so the
  // largest bodies carry the shape and the rest are noise at this scale; they are counted and reported.
  const area = (ring) => Math.abs(ring.reduce((total, [x, y], index) => {
    const [nextX, nextY] = ring[(index + 1) % ring.length];
    return total + (x * nextY - nextX * y);
  }, 0) / 2);
  const allRings = feature.geometry.rings.map(ring => ring.map(([lon, lat]) => [Number(lon), Number(lat)]))
    .sort((a, b) => area(b) - area(a));
  const largestArea = area(allRings[0]);
  const kept = allRings.filter((ring, index) => index === 0 || (area(ring) >= largestArea * 0.05 && index < 30));
  // Finest tolerance first, so a small unit keeps its shape and a sprawling one degrades only as far as it must.
  let rings = [], usedTolerance = null;
  for (const tolerance of TOLERANCES) {
    rings = kept.map(ring => simplifyRing(ring, tolerance)).filter(ring => ring.length >= 4);
    usedTolerance = tolerance;
    if (rings.reduce((sum, ring) => sum + ring.length, 0) <= POINT_BUDGET) break;
  }
  let decimated = 0;
  const afterSimplify = rings.reduce((sum, ring) => sum + ring.length, 0);
  if (afterSimplify > POINT_BUDGET) {
    const stride = Math.ceil(afterSimplify / POINT_BUDGET);
    rings = rings.map(ring => {
      const thinned = ring.filter((_, index) => index % stride === 0 || index === ring.length - 1);
      return thinned.length >= 4 ? thinned : ring;
    });
    decimated = stride;
  }
  rings = rings.map(ring => ring.map(([lon, lat]) => [Number(lon.toFixed(4)), Number(lat.toFixed(4))]));
  const points = rings.reduce((total, ring) => total + ring.length, 0);
  const lons = rings.flat().map(pair => pair[0]), lats = rings.flat().map(pair => pair[1]);
  const record = {
    schema: 'worthlookingup.geodata-boundary/1',
    id: unit.id,
    fetchedAt: new Date().toISOString(),
    source: { id: 'usgs-padus-4-1',
      url: 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/PADUS_Management_Areas/FeatureServer',
      objectId: feature.attributes.OBJECTID, toleranceDegrees: usedTolerance,
      method: 'PAD-US polygon, Douglas-Peucker simplified locally to a point budget, EPSG:4326, 4 decimal places',
      decimationStride: decimated || null, ringsTotal: allRings.length, ringsKept: rings.length,
      note: 'a mapped management extent, simplified for display; not a surveyed property boundary' },
    attributes: { unitName: feature.attributes.Unit_Nm, state: feature.attributes.State_Nm,
      ownerType: feature.attributes.Own_Type, managerType: feature.attributes.Mang_Type,
      managerName: feature.attributes.Mang_Name, designation: feature.attributes.Des_Tp,
      acres: Math.round(feature.attributes.GIS_AcreD || 0) },
    pointsBefore: raw,
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)].map(v => Number(v.toFixed(4))),
    rings,
  };
  fs.writeFileSync(path.join(outDir, unit.id + '.json'), JSON.stringify(record) + '\n');
  console.log(unit.id.padEnd(22) + String(raw).padStart(6) + ' -> ' + String(points).padStart(4) + ' points  ' +
    (JSON.stringify(record).length / 1024).toFixed(1) + ' kB');
}
