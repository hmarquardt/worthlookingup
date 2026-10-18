/* Build a terrain horizon profile for every candidate, from a real DEM, on a real night.

   For each candidate: fetch a 3DEP elevation extract around the point, keep it in memory only, compute the
   horizon profile with the prototype module, ask the existing Milky Way engine where the core is at its best
   moment on the target night, and store the profile, the clearance and the provenance as a small JSON file.
   The DEM itself is not committed: 1 MB per site of third-party raster adds nothing a re-run cannot
   reproduce, while the derived profile is the evidence worth keeping.

   Run: node research/geodata/tools/build-profiles.mjs [--target 2027-04-13]
   Network required; never part of `npm test`. */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readGeoTiff } from './geotiff.mjs';
import { makeRaster, rasterSampler } from '../../../src/geodata/geo-raster.mjs';
import { horizonProfile, horizonAtAzimuth, clearanceFor, horizonUncertaintyDeg, HORIZON_DEFAULTS } from '../../../src/geodata/terrain-horizon.mjs';
import { normaliseCoordinate } from '../../../src/geodata/geo-geometry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.join(here, '..', '..', '..');
const candidateFile = path.join(here, '..', 'candidates', 'southern-indiana.json');
const profileDir = path.join(here, '..', 'profiles');

// The production engines, used read-only, so the core's position here is the core's position on the site.
globalThis.Astronomy = require(path.join(root, 'vendor', 'overhead', 'astronomy-2.1.19.min.js'));
globalThis.SunCalc = require(path.join(root, 'vendor', 'overhead', 'suncalc-1.9.0.js'));
require(path.join(root, 'overhead-engine.js'));
const Astro = require(path.join(root, 'overhead-astro.js'));
globalThis.OverheadAstro = Astro;
const MilkyWay = require(path.join(root, 'overhead-milkyway.js'));

const TARGET_DATE = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : '2027-04-13';
const TIMEZONE = 'America/Chicago';   // every candidate in this box is in the Central zone
const DEM_SIZE = 1024;                // pixels per side: about 31 m per pixel over a 32 km box
const SEARCH_RADIUS_M = 16000;

async function fetchDem(origin) {
  const dLat = SEARCH_RADIUS_M / 111320;
  const dLon = SEARCH_RADIUS_M / (111320 * Math.cos(origin.lat * Math.PI / 180));
  const bbox = [origin.lon - dLon, origin.lat - dLat, origin.lon + dLon, origin.lat + dLat].map(v => v.toFixed(6));
  const url = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage' +
    '?bbox=' + bbox.join(',') + '&bboxSR=4326&imageSR=4326&size=' + DEM_SIZE + ',' + DEM_SIZE + '&format=tiff' +
    '&interpolation=RSP_BilinearInterpolation&f=image';
  // The ImageServer occasionally answers 504 on a first request and succeeds on the next, so a small bounded
  // retry with a delay is the difference between a reproducible artefact and an afternoon of re-runs.
  let response = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    response = await fetch(url, { headers: { 'user-agent': 'worthlookingup-geodata-research/0.1' } });
    if (response.ok) break;
    if (attempt === 3) throw new Error('3DEP request failed after ' + attempt + ' attempts: HTTP ' + response.status);
    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tiff = readGeoTiff(buffer);
  if (tiff.crs !== null && tiff.crs !== 2) throw new Error('3DEP returned a non-geographic raster (GTModelType ' + tiff.crs + ')');
  const pixelSizeM = (tiff.bbox[2] - tiff.bbox[0]) * 111320 * Math.cos(origin.lat * Math.PI / 180) / tiff.width;
  const raster = makeRaster({ width: tiff.width, height: tiff.height, values: tiff.values, bbox: tiff.bbox,
    source: 'usgs-3dep', units: 'm', resolutionM: Number(pixelSizeM.toFixed(1)) });
  return { raster, bytes: buffer.length };
}

function coreAtBest(origin, date) {
  const site = { lat: origin.lat, lon: origin.lon, tz: TIMEZONE };
  const noon = Date.parse(date + 'T18:00:00Z');
  const sun = Astro.sunsetSunrise(site, noon);
  const night = { day: date, start: sun.sunset, end: sun.sunrise };
  const analysis = MilkyWay.analyseNight(night, site, { thresholdDeg: MilkyWay.RULES.core.goodDeg });
  const core = analysis.core;
  return { night: { day: date, start: night.start, end: night.end },
    bestTime: core.maxTime, altitudeDeg: core.maxAltitude, azimuthDeg: core.maxAzimuth,
    compass: core.maxCompass, observable: analysis.observable,
    windowMinutes: analysis.window ? analysis.window.minutes : 0,
    moonlight: analysis.moon ? analysis.moon.classification : null };
}

fs.mkdirSync(profileDir, { recursive: true });
const inventory = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
const written = [];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
for (const candidate of inventory.candidates.filter(entry => !only || entry.id === only)) {
  const origin = normaliseCoordinate(candidate.coordinates);
  process.stdout.write(candidate.id.padEnd(24));
  const { raster, bytes } = await fetchDem(origin);
  const profile = horizonProfile({ origin, sampler: rasterSampler(raster), maxDistanceM: SEARCH_RADIUS_M,
    stepM: HORIZON_DEFAULTS.stepM, eyeHeightM: 1.6, azimuthCount: 16 });
  const core = coreAtBest(origin, TARGET_DATE);
  // Uncertainty belongs to the direction being judged, at the distance of the terrain that sets the angle
  // there — not to whichever obstruction anywhere in the profile happens to be nearest.
  const facing = horizonAtAzimuth(profile, core.azimuthDeg);
  const uncertaintyDeg = horizonUncertaintyDeg({ verticalRmseM: 1.55,
    distanceM: facing.atM || profile.maxDistanceM, roughnessM: facing.roughnessM || 0 });
  const clearance = clearanceFor(profile, { azimuthDeg: core.azimuthDeg, altitudeDeg: core.altitudeDeg, uncertaintyDeg });
  const record = {
    schema: 'worthlookingup.geodata-profile/1',
    candidate: candidate.id,
    origin,
    generated_at: new Date().toISOString(),
    generated_by: 'research/geodata/tools/build-profiles.mjs',
    dem: { source: 'usgs-3dep', url: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer',
      product: '3DEPElevation ImageServer exportImage, EPSG:4326, bilinear resample',
      bbox: raster.bbox, pixelSizeM: raster.resolutionM, width: raster.width, height: raster.height, bytes,
      verticalAccuracy: 'lidar-derived bare earth, resampled for this prototype: treat the angle as indicative at about 1-2 m vertical' },
    eyeHeightM: profile.eyeHeightM, observerElevationM: profile.groundElevationM,
    searchRadiusM: SEARCH_RADIUS_M,
    profile: profile.azimuths.map(entry => ({ azimuthDeg: entry.azimuthDeg,
      maxAngleDeg: Number(entry.maxAngleDeg.toFixed(3)), maxAtM: entry.maxAtM,
      maxElevationM: entry.maxElevationM === null ? null : Number(entry.maxElevationM.toFixed(1)),
      groundElevationM: entry.groundElevationM === null ? null : Number(entry.groundElevationM.toFixed(1)),
      coverage: Number(entry.coverage.toFixed(3)), status: entry.status })),
    core,
    clearance: { status: clearance.status,
      differenceDeg: clearance.differenceDeg === undefined ? null : Number(clearance.differenceDeg.toFixed(2)),
      horizonAngleDeg: Number(clearance.horizon.horizonAngleDeg.toFixed(2)),
      marginDeg: Number(clearance.marginDeg.toFixed(2)),
      uncertaintyDeg: Number(uncertaintyDeg.toFixed(2)), reason: clearance.reason || null,
      note: 'terrain only: vegetation, buildings and vehicles are not in a bare-earth model' },
  };
  fs.writeFileSync(path.join(profileDir, candidate.id + '.json'), JSON.stringify(record, null, 2) + '\n');
  written.push(record);
  console.log(' dem ' + (bytes / 1024).toFixed(0) + ' kB  ' + raster.width + 'x' + raster.height +
    ' @' + raster.resolutionM + ' m  core ' + core.altitudeDeg.toFixed(1) + ' deg ' + core.compass +
    '  horizon ' + record.clearance.horizonAngleDeg + ' deg  ' + clearance.status);
}
console.log('wrote ' + written.length + ' profiles for ' + TARGET_DATE);
