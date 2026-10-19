/* Terrain and astronomy for each observation point, from a real DEM and the real engine.

   For every candidate the pipeline decided to publish, this fetches a 3DEP extract around the point, builds the
   horizon profile with the prototype module, asks the Milky Way engine where the core is during that night's
   window, and evaluates the clearance at three moments — the start of the window, its best moment and its end —
   because the core moves. A single angle at the best moment is a snapshot, not a horizon, and the artifact says
   so.

   Run: node research/geodata/tools/build-point-profiles.mjs [--target 2027-04-13]
   Network required; never part of `npm test`. */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readGeoTiff } from './geotiff.mjs';
import { makeRaster, rasterSampler } from '../../../src/geodata/geo-raster.mjs';
import { horizonProfile, horizonAtAzimuth, clearanceFor, horizonUncertaintyDeg, HORIZON_DEFAULTS } from '../../../src/geodata/terrain-horizon.mjs';
import { normaliseCoordinate, withinStudyArea, normaliseStudyArea } from '../../../src/geodata/geo-geometry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.join(here, '..', '..', '..');
const candidateFile = path.join(here, '..', 'points', 'candidates.json');
const studyFile = path.join(root, 'research', 'geodata', 'candidates', 'southern-indiana.json');
const outputDir = path.join(here, '..', 'points', 'profiles');

// The production engines, read-only, so the positions here are the positions the site computes.
globalThis.Astronomy = require(path.join(root, 'vendor', 'overhead', 'astronomy-2.1.19.min.js'));
globalThis.SunCalc = require(path.join(root, 'vendor', 'overhead', 'suncalc-1.9.0.js'));
require(path.join(root, 'overhead-engine.js'));
const Astro = require(path.join(root, 'overhead-astro.js'));
globalThis.OverheadAstro = Astro;
const MilkyWay = require(path.join(root, 'overhead-milkyway.js'));

const TARGET_DATE = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : '2027-04-13';
const DEM_SIZE = 1024;
const SEARCH_RADIUS_M = 16000;
const studyArea = normaliseStudyArea(JSON.parse(fs.readFileSync(studyFile, 'utf8')).studyArea);

async function fetchDem(origin) {
  const dLat = SEARCH_RADIUS_M / 111320;
  const dLon = SEARCH_RADIUS_M / (111320 * Math.cos(origin.lat * Math.PI / 180));
  const bbox = [origin.lon - dLon, origin.lat - dLat, origin.lon + dLon, origin.lat + dLat].map(v => v.toFixed(6));
  const url = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage' +
    '?bbox=' + bbox.join(',') + '&bboxSR=4326&imageSR=4326&size=' + DEM_SIZE + ',' + DEM_SIZE + '&format=tiff' +
    '&interpolation=RSP_BilinearInterpolation&f=image';
  let response = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    response = await fetch(url, { headers: { 'user-agent': 'worthlookingup-geodata-research/0.1' } });
    if (response.ok) break;
    if (attempt === 3) throw new Error('3DEP request failed after ' + attempt + ' attempts: HTTP ' + response.status);
    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tiff = readGeoTiff(buffer);
  const pixelSizeM = (tiff.bbox[2] - tiff.bbox[0]) * 111320 * Math.cos(origin.lat * Math.PI / 180) / tiff.width;
  const raster = makeRaster({ width: tiff.width, height: tiff.height, values: tiff.values, bbox: tiff.bbox,
    source: 'usgs-3dep', units: 'm', resolutionM: Number(pixelSizeM.toFixed(1)) });
  return { raster, bytes: buffer.length };
}

const candidates = JSON.parse(fs.readFileSync(candidateFile, 'utf8')).candidates;
const publishable = candidates.filter(candidate => candidate.decision === 'publish-as-named-facility');
fs.mkdirSync(outputDir, { recursive: true });
const written = [];
for (const candidate of publishable) {
  const coordinates = normaliseCoordinate(candidate.coordinates || candidate.agencyCoordinates);
  if (!withinStudyArea(studyArea, coordinates)) {
    console.log(candidate.sourceRecord.name.padEnd(42) + ' outside the studied region: skipped');
    continue;
  }
  const site = { lat: coordinates.lat, lon: coordinates.lon, tz: 'America/Chicago' };
  const sun = Astro.sunsetSunrise(site, Date.parse(TARGET_DATE + 'T18:00:00Z'));
  const night = { day: TARGET_DATE, start: sun.sunset, end: sun.sunrise };
  const analysis = MilkyWay.analyseNight(night, site, { thresholdDeg: MilkyWay.RULES.core.goodDeg });
  if (!analysis.observable || !analysis.window) {
    console.log(candidate.sourceRecord.name.padEnd(42) + ' no core window on ' + TARGET_DATE + ': skipped');
    continue;
  }
  const { raster, bytes } = await fetchDem(coordinates);
  const profile = horizonProfile({ origin: coordinates, sampler: rasterSampler(raster),
    maxDistanceM: SEARCH_RADIUS_M, stepM: HORIZON_DEFAULTS.stepM, eyeHeightM: 1.6, azimuthCount: 16 });
  // The core moves through the window, so the clearance is checked at its start, its best moment and its end.
  const series = analysis.series || [];
  const at = (time) => {
    let closest = series[0] || null;
    for (const sample of series) if (Math.abs(sample.t - time) < Math.abs(closest.t - time)) closest = sample;
    return closest;
  };
  const moments = [
    { label: 'window opens', time: analysis.window.start, azimuthDeg: at(analysis.window.start).azimuth,
      altitudeDeg: at(analysis.window.start).altitude },
    { label: 'core at its highest', time: analysis.core.maxTime, azimuthDeg: analysis.core.maxAzimuth,
      altitudeDeg: analysis.core.maxAltitude },
    { label: 'window closes', time: analysis.window.end, azimuthDeg: at(analysis.window.end).azimuth,
      altitudeDeg: at(analysis.window.end).altitude },
  ].map((moment) => {
    const facing = horizonAtAzimuth(profile, moment.azimuthDeg);
    const uncertaintyDeg = horizonUncertaintyDeg({ verticalRmseM: 1.55, roughnessM: facing.roughnessM || 0,
      distanceM: facing.atM || SEARCH_RADIUS_M });
    const clearance = clearanceFor(profile, { azimuthDeg: moment.azimuthDeg, altitudeDeg: moment.altitudeDeg,
      uncertaintyDeg });
    return { label: moment.label, time: moment.time, azimuthDeg: Number(moment.azimuthDeg.toFixed(2)),
      altitudeDeg: Number(moment.altitudeDeg.toFixed(2)), status: clearance.status,
      differenceDeg: clearance.differenceDeg === undefined ? null : Number(clearance.differenceDeg.toFixed(2)),
      horizonAngleDeg: Number(clearance.horizon.horizonAngleDeg.toFixed(2)),
      uncertaintyDeg: Number(uncertaintyDeg.toFixed(2)), reason: clearance.reason || null };
  });
  const statuses = moments.map(moment => moment.status);
  const overall = statuses.every(status => status === 'clear') ? 'clear'
    : statuses.some(status => status === 'obstructed') ? 'obstructed'
      : statuses.some(status => status === 'unknown') ? 'unknown' : 'marginal';
  const record = {
    schema: 'worthlookingup.geodata-point-profile/1',
    point: candidate.sourceRecord.name,
    pointName: candidate.pointName || candidate.sourceRecord.name,
    coordinates,
    generatedAt: new Date().toISOString(),
    targetDate: TARGET_DATE,
    dem: { source: 'usgs-3dep', url: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer',
      bbox: raster.bbox, width: raster.width, height: raster.height, pixelSizeM: raster.resolutionM, bytes,
      verticalAccuracy: 'lidar-derived bare earth, resampled: treat the angle as indicative at about 1-2 m vertical' },
    observer: { eyeHeightM: profile.eyeHeightM, groundElevationM: Number(profile.groundElevationM.toFixed(1)) },
    profile: profile.azimuths.map(entry => ({ azimuthDeg: entry.azimuthDeg,
      maxAngleDeg: Number(entry.maxAngleDeg.toFixed(2)), maxAtM: entry.maxAtM,
      coverage: Number(entry.coverage.toFixed(3)), status: entry.status })),
    core: { windowStart: analysis.window.start, windowEnd: analysis.window.end, minutes: analysis.window.minutes,
      level: analysis.window.level, maxAltitudeDeg: Number(analysis.core.maxAltitude.toFixed(2)),
      maxAzimuthDeg: Number(analysis.core.maxAzimuth.toFixed(2)), maxCompass: analysis.core.maxCompass,
      maxTime: analysis.core.maxTime, darknessMinutes: analysis.darkness.minutes,
      darknessAchieved: analysis.darkness.achieved, moonlight: analysis.moon ? analysis.moon.classification : null,
      quality: analysis.quality.value },
    clearance: { state: overall, moments,
      note: 'Bare-earth terrain only. Trees, crops, buildings, fences and vehicles are not in the model, and in a ' +
        'wooded campground they are the likely horizon. A snapshot at each moment, not a promise of a clear view.' },
  };
  fs.writeFileSync(path.join(outputDir, (candidate.pointName || candidate.sourceRecord.name)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json'), JSON.stringify(record, null, 2) + '\n');
  written.push(record);
  console.log((candidate.pointName || candidate.sourceRecord.name).padEnd(56) + ' dem ' + (bytes / 1024).toFixed(0) + ' kB @' + raster.resolutionM +
    ' m  core ' + record.core.maxAltitudeDeg + ' deg ' + record.core.maxCompass + '  ' + overall +
    '  worst ' + Math.min(...moments.map(m => m.differenceDeg ?? 99)).toFixed(1) + ' deg');
}
console.log('wrote ' + written.length + ' point profiles for ' + TARGET_DATE);
