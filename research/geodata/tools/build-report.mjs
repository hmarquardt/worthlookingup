/* Builds the research report: one JSON artefact and one self-contained HTML page.

   No network, no build step, no framework: the report reads the committed candidate inventory, the committed
   terrain profiles and the source inventory, evaluates each site through the prototype modules, and writes
   `research/geodata/report.json` and `research/geodata/report.html`. The HTML has no map tiles and no
   external requests at all — it draws the candidates in a local equirectangular projection so the page works
   offline and cannot imply a basemap endorsement.

   Run: node research/geodata/tools/build-report.mjs [--origin 38.3553,-87.5675] */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAccess } from '../../../src/geodata/access-evidence.mjs';
import { evaluateSite, compareSites } from '../../../src/geodata/site-evaluation.mjs';
import { gateReport, attributionFor } from '../../../src/geodata/geo-sources.mjs';
import { normaliseStudyArea, withinStudyArea } from '../../../src/geodata/geo-geometry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(fs.readFileSync(path.join(here, '..', name), 'utf8'));
const candidates = read('candidates/southern-indiana.json');
const sources = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'src', 'geodata', 'sources.json'), 'utf8'));
const profiles = new Map();
for (const file of fs.readdirSync(path.join(here, '..', 'profiles'))) {
  if (!file.endsWith('.json')) continue;
  const profile = JSON.parse(fs.readFileSync(path.join(here, '..', 'profiles', file), 'utf8'));
  profiles.set(profile.candidate, profile);
}

// The origin a reader would start from: the pilot region's own centre, or a coordinate given on the command line.
const originArg = process.argv.includes('--origin') ? process.argv[process.argv.indexOf('--origin') + 1] : null;
const origin = originArg ? { lat: Number(originArg.split(',')[0]), lon: Number(originArg.split(',')[1]) }
  : { lat: 38.3553, lon: -87.5675 };

const studyArea = normaliseStudyArea(candidates.studyArea);
const rows = [];
for (const candidate of candidates.candidates) {
  const profile = profiles.get(candidate.id) || null;
  const access = classifyAccess(candidate.accessEvidence, { now: Date.parse('2026-10-18T00:00:00Z') });
  const row = evaluateSite({ candidate, access, profile, core: profile ? profile.core : null,
    sky: { unit: null, value: null, reason: 'no licensed, machine-readable sky-brightness dataset is available' },
    origin, now: Date.parse('2026-10-18T00:00:00Z') });
  // A unit can intersect the study box while its largest polygon sits outside it. That is recorded rather
  // than dropped: silently removing a candidate is how a boundary problem becomes invisible.
  if (!withinStudyArea(studyArea, candidate.coordinates)) {
    row.outsideStudyArea = true;
    row.warnings.push('the polygon centroid lies outside the study box, although the unit intersects it');
  }
  rows.push(row);
}

const inside = candidates.candidates.filter(candidate => withinStudyArea(studyArea, candidate.coordinates)).length;
const comparison = compareSites(rows);
const gate = gateReport(sources);
const report = {
  schema: 'worthlookingup.geodata-report/1',
  generated_at: new Date().toISOString(),
  generated_by: 'research/geodata/tools/build-report.mjs',
  status: 'research-only',
  disclaimer: 'Not a recommendation, not a safety or access guarantee, and not part of the public site. ' +
    'Every entry is a candidate for further investigation; only entries whose after-dark access is documented ' +
    'by an authoritative source appear in the recommendable group, and even those need a site visit.',
  studyArea: candidates.studyArea,
  origin,
  targetNight: rows.find(row => row.core) ? rows.find(row => row.core).core.day : null,
  gate,
  comparison,
  checks: { candidatesInsideStudyArea: inside,
    candidatesOutsideStudyArea: rows.filter(row => row.outsideStudyArea).map(row => row.id),
    profilesPresent: rows.filter(row => row.terrain.state !== 'unknown').length },
};
fs.writeFileSync(path.join(here, '..', 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('report.json: ' + comparison.counts.total + ' candidates, ' + comparison.counts.recommendable +
  ' recommendable, ' + comparison.counts.needsVerification + ' need verification, ' +
  comparison.counts.unsuitable + ' unsuitable, ' + comparison.counts.terrainClear + ' terrain-clear, ' +
  comparison.counts.skySampled + ' with sky evidence');
console.log('gate: production-eligible ' + gate.eligible.join(', '));
console.log('gate: blocked ' + gate.blocked.map(entry => entry.id).join(', '));
export { rows, comparison, gate, sources, candidates, origin };

/* ---- the research page ---------------------------------------------------------------
   One self-contained file: inline CSS, no scripts, no tiles, no network. It is a research artefact that
   can be opened from disk, and it says so at the top before anything else. */
const esc = (value) => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const box = studyArea.type === 'Box' ? studyArea : null;
const bounds = box ? { west: box.west, east: box.east, north: box.north, south: box.south } : null;
function project(point) {
  const x = (point.lon - bounds.west) / (bounds.east - bounds.west) * 640 + 40;
  const y = (bounds.north - point.lat) / (bounds.north - bounds.south) * 420 + 30;
  return { x, y };
}
const groupOf = new Map();
for (const row of comparison.recommendable) groupOf.set(row.id, 'recommendable');
for (const row of comparison.needsVerification) groupOf.set(row.id, 'verify');
for (const row of comparison.unsuitable) groupOf.set(row.id, 'unsuitable');
const palette = { recommendable: '#d3ed95', verify: '#ebbd83', unsuitable: '#e08f8f' };
const markers = rows.filter(row => bounds).map(row => {
  const at = project(row.coordinates);
  const group = groupOf.get(row.id);
  return `<g><circle cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="6" fill="${palette[group]}" ` +
    `stroke="#10191d" stroke-width="1.5"><title>${esc(row.name)} — ${esc(row.access.label)}</title></circle>` +
    `<text x="${(at.x + 9).toFixed(1)}" y="${(at.y + 4).toFixed(1)}" font-size="9" fill="#a6b6ba">${esc(row.id)}</text></g>`;
}).join('');
const originMark = bounds ? (() => {
  const at = project(origin);
  const core = rows.find(row => row.core);
  const azimuth = core ? core.core.azimuthDeg : 180;
  const rad = azimuth * Math.PI / 180;
  const tip = { x: at.x + Math.sin(rad) * 120, y: at.y - Math.cos(rad) * 120 };
  return `<circle cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="4" fill="#91c9da">` +
    `<title>Origin ${origin.lat}, ${origin.lon}</title></circle>` +
    `<line x1="${at.x.toFixed(1)}" y1="${at.y.toFixed(1)}" x2="${tip.x.toFixed(1)}" y2="${tip.y.toFixed(1)}" ` +
    `stroke="#91c9da" stroke-width="1.5" stroke-dasharray="6 4"><title>Galactic core direction, azimuth ${azimuth}°</title></line>`;
})() : '';

function tableRow(row) {
  const terrain = row.terrain;
  const sky = row.sky;
  const terrainText = terrain.state === 'clear'
    ? `clear by ${terrain.differenceDeg.toFixed(1)}°±${terrain.uncertaintyDeg}° (horizon ${terrain.horizonAngleDeg}°)`
    : terrain.state === 'obstructed' ? `blocked (horizon ${terrain.horizonAngleDeg}° > core ${terrain.coreAltitudeDeg}°)`
      : `unknown: ${esc(terrain.reason)}`;
  const provenance = row.provenance.map(entry => `<li>${esc(entry.claim)}: ${esc(entry.source)}` +
    (entry.url ? ` — <a href="${esc(entry.url)}">${esc(entry.url.replace(/^https?:\/\//, ''))}</a>` : '') +
    (entry.quote ? `<br><q>${esc(entry.quote)}</q>` : '') + (entry.verifiedAt ? ` <span class="muted">(${esc(entry.verifiedAt)})</span>` : '') + '</li>').join('');
  return `<tr>
    <th scope="row"><strong>${esc(row.name)}</strong><div class="muted">${esc(row.id)} · ${esc(row.type)}</div>
      <div class="muted">${esc(row.coordinates.lat)}, ${esc(row.coordinates.lon)} · ${esc(row.distance ? row.distance.km + ' km straight-line' : '')}</div></th>
    <td><span class="pill" style="border-color:${palette[groupOf.get(row.id)]}">${esc(row.access.label)}</span>
      <div class="muted">${esc(row.access.reason)}</div></td>
    <td>${esc(terrainText)}<div class="muted">${esc(terrain.caveat || '')}</div></td>
    <td>${sky.state === 'sampled' ? esc(sky.value + ' ' + sky.unit) : '<em>unavailable</em>'}
      <div class="muted">${esc(sky.state === 'sampled' ? sky.note : sky.reason)}</div></td>
    <td>${row.warnings.length ? '<ul>' + row.warnings.map(w => `<li>${esc(w)}</li>`).join('') + '</ul>' : '<span class="muted">none</span>'}
      <details><summary>evidence</summary><ul>${provenance}</ul></details></td>
  </tr>`;
}

const groupTable = (title, blurb, list) => list.length ? `<h3>${esc(title)} <span class="muted">(${list.length})</span></h3>
  <p class="muted">${esc(blurb)}</p>
  <table><caption>${esc(title)}</caption><thead><tr><th scope="col">Candidate</th><th scope="col">After-dark access</th>
  <th scope="col">Modelled terrain vs the core</th><th scope="col">Sky brightness</th><th scope="col">Warnings and evidence</th></tr></thead>
  <tbody>${list.map(tableRow).join('')}</tbody></table>` : '';

const gateRows = sources.sources.map(source => `<tr><th scope="row">${esc(source.id)}</th><td>${esc(source.publisher)}</td>
  <td>${esc(source.licence.name)}</td><td>${esc(source.licence.class)}</td>
  <td>${source.licence.commercialUse === true ? 'yes' : esc(source.licence.commercialUse)}</td>
  <td>${source.access.automatable === true ? 'automatable' : 'no automated access'}</td>
  <td>${gate.eligible.includes(source.id) ? 'production-eligible' : 'blocked: ' + esc((gate.blocked.find(b => b.id === source.id) || {}).blockers.join('; '))}</td></tr>`).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worth Looking Up — geodata research (not a recommendation)</title>
<style>
:root{color-scheme:dark;--bg:#10191d;--panel:#152126;--line:#304047;--ink:#e9eee7;--muted:#a6b6ba;--lime:#d3ed95;--blue:#91c9da;--amber:#ebbd83}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 'Avenir Next',Avenir,'Segoe UI',sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 20px 60px}h1{font-size:1.5rem;letter-spacing:.5px}h2{font-size:1.1rem;margin-top:34px}h3{font-size:.98rem;margin-top:22px}
.banner{border:1px solid var(--amber);background:#1d1a12;color:var(--amber);padding:12px 16px;border-radius:8px;margin:16px 0 24px}
.muted{color:var(--muted);font-size:.82rem}table{width:100%;border-collapse:collapse;margin:10px 0 6px;font-size:.88rem}
caption{text-align:left;color:var(--muted);font-size:.78rem;padding-bottom:6px}th,td{border-top:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}
th{font-weight:600}thead th{color:var(--muted);font-size:.74rem;letter-spacing:.6px;text-transform:uppercase}
.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 9px;font-size:.74rem}
ul{margin:4px 0 0 16px;padding:0}li{margin:2px 0}q{color:var(--muted);font-style:italic}details{margin-top:6px}summary{cursor:pointer;font-size:.78rem;color:var(--blue)}
svg{width:100%;height:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px}
a{color:var(--blue)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:8px;padding:12px 14px;background:var(--panel)}
@media(max-width:720px){table{font-size:.8rem}th,td{padding:8px 5px}}
</style></head><body><main>
<h1>Worth Looking Up — geographic data feasibility</h1>
<div class="banner"><strong>Research only, and not a recommendation.</strong> These locations are candidates for
further investigation. Being listed here does not mean a place is safe, open after dark, reachable, dark, or
suitable for photography. Only the group marked verified has a documented after-dark statement, and even that
needs a site visit. Nothing on this page is part of the public Worth Looking Up site.</div>
<p class="muted">Generated ${esc(report.generated_at)} from the committed candidate inventory and terrain
profiles. Study area: ${esc(studyArea.label || '')}. Target night: ${esc(report.targetNight || 'none')}.
Origin for straight-line distance: ${esc(origin.lat)}, ${esc(origin.lon)}.</p>
<div class="grid">
<div class="card"><div class="muted">Candidates</div><div>${comparison.counts.total} (${comparison.counts.recommendable} with documented after-dark access)</div></div>
<div class="card"><div class="muted">Terrain clear of the modelled horizon</div><div>${comparison.counts.terrainClear} of ${comparison.counts.total}</div></div>
<div class="card"><div class="muted">With sky-brightness evidence</div><div>${comparison.counts.skySampled} of ${comparison.counts.total} — no licensed dataset is available yet</div></div>
<div class="card"><div class="muted">Sources blocked by the licensing gate</div><div>${gate.blocked.length} of ${sources.sources.length}</div></div>
</div>
<h2>The study area</h2>
<svg viewBox="0 0 720 480" role="img" aria-label="Study area map of candidate locations, with the galactic core direction from the origin">
<rect x="40" y="30" width="640" height="420" fill="none" stroke="#304047"/>
${originMark}
${markers}
<text x="46" y="466" font-size="10" fill="#a6b6ba">${esc(bounds.west)}° to ${esc(bounds.east)}° longitude, ${esc(bounds.south)}° to ${esc(bounds.north)}° latitude · no basemap, no tiles: a local equirectangular sketch</text>
</svg>
<p class="muted">The dashed line is the Galactic core's azimuth at its best moment on the target night, from the
origin. Straight-line distance is a distance on the ground as the crow flies and is not a drive; no travel time
is computed anywhere in this prototype.</p>
${groupTable('Documented after-dark access', 'An authoritative source states that the place may be used after dark, with a legal place to leave a vehicle (or a whole-property hours statement that covers it). Still needs a site visit.', comparison.recommendable)}
${groupTable('Access needs verification', 'Public land, but no authoritative statement about after-dark use was found. Do not treat these as recommendations.', comparison.needsVerification)}
${groupTable('Not suitable as candidates', 'Restricted after dark, or private land with no public permission established.', comparison.unsuitable)}
<h2>Sources and the licensing gate</h2>
<p class="muted">Availability and redistribution are separate facts. A source is production-eligible only when its
licence permits commercial use and redistribution <em>and</em> it can be read by an automated job. The gate is
computed from these fields, not typed in by hand.</p>
<table><caption>Data sources checked ${esc(sources.checked_at)}</caption><thead><tr><th scope="col">Source</th><th scope="col">Publisher</th>
<th scope="col">Licence</th><th scope="col">Class</th><th scope="col">Commercial</th><th scope="col">Access</th><th scope="col">Verdict</th></tr></thead>
<tbody>${gateRows}</tbody></table>
<h2>Method and limits</h2>
<ul class="muted">
<li>Astronomy: the site's own Milky Way engine (unchanged) gives the core's altitude and azimuth on the target night.</li>
<li>Terrain: USGS 3DEP bare-earth elevation, 1024×1024 pixels over a 32 km box (about 31 m), bilinear sampling every 60 m, Earth curvature and standard refraction, eye height 1.6 m above the ground at the point.</li>
<li>Terrain does not model trees, crops, buildings, levees or vehicles. A low modelled horizon is not a clear view.</li>
<li>Access comes from USGS PAD-US ownership records plus the managing agency's own published statements, quoted with their URLs and the date read. PAD-US's public-access flag is not treated as permission.</li>
<li>Sky brightness is <em>unavailable</em> for every candidate. Upward radiance is not sky brightness, and no licensed, machine-readable sky-brightness dataset was obtainable without an account or a non-commercial licence.</li>
<li>Distances are great-circle on a sphere. No road distance, drive time or routing is computed.</li>
</ul>
</main></body></html>`;
fs.writeFileSync(path.join(here, '..', 'report.html'), html);
console.log('report.html: ' + (html.length / 1024).toFixed(1) + ' kB, self-contained');
