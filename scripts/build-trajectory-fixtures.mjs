/* Build the committed trajectory fixtures from the public-domain webcast-telemetry archive.
   Run: node scripts/build-trajectory-fixtures.mjs
   This script is the only thing that touches the network; the tests read the committed fixture, so CI
   never depends on the archive being up. It reduces each flight to a 10-second series of altitude and
   downrange, records the event times the archive also publishes, and keeps the provenance, licence and
   reduction method in the file so the derivation can be repeated or challenged.

   Source: shahar603/Telemetry-Data, "A collection of telemetry captured from SpaceX Launch Webcasts",
   released into the public domain (Unlicense). No SpaceX material is copied here: these are numbers
   read off webcast telemetry displays by a third party. */
import { writeFileSync } from 'node:fs';

const SOURCE = 'https://raw.githubusercontent.com/shahar603/Telemetry-Data/master/';
const RETRIEVED = '2026-10-16';
const STEP_S = 10;

async function getJson(path) {
  const response = await fetch(SOURCE + encodeURI(path));
  if (!response.ok) throw new Error(`fetch failed ${response.status} for ${path}`);
  return response.json();
}

// The archive uses two shapes: an object of parallel arrays, and a list of [name, values] pairs.
function columns(payload) {
  if (Array.isArray(payload)) return Object.fromEntries(payload.map(entry => [entry[0], entry[1]]));
  return payload;
}

function reduce(payload, { mission, events, phaseAfterMeco = 'booster-return' }) {
  const named = columns(payload);
  const time = named.time, altitudeKm = named.altitude, downrangeKm = named.downrange_distance, speedMps = named.velocity;
  if (!time || !altitudeKm || !downrangeKm) throw new Error(`${mission}: expected time/altitude/downrange columns`);
  const meco = Number.isFinite(events.meco) ? events.meco : Infinity;
  const wanted = new Set();
  for (let i = 0; i < time.length; i++) if (time[i] % STEP_S === 0) wanted.add(i);
  wanted.add(time.length - 1);
  const samples = [];
  for (const i of [...wanted].sort((a, b) => a - b)) {
    // A negative altitude in the source is a telemetry artefact around the pad; the profile contract
    // requires altitude >= 0, so those samples are clamped and this is the record of it.
    samples.push({ t: time[i], altitudeM: Math.round(Math.max(0, altitudeKm[i]) * 1000),
      downrangeM: Math.round(Math.max(0, downrangeKm[i]) * 1000),
      velocityMps: Math.round(Math.max(0, speedMps[i]) * 1000) / 1000,
      phase: time[i] <= meco ? 'ascent' : phaseAfterMeco });
  }
  return samples;
}

const MISSIONS = [
  { id: 'saocom-1a-2018-076', folder: 'SAOCOM 1A', mission: 'SAOCOM 1A', vehicle: 'Falcon 9 Block 5',
    stage: 1, pad: 'Space Launch Complex 4E', latDeg: 34.632, lonDeg: -120.611,
    launchUtc: '2018-10-08T02:21:00.000Z', launchPrecision: 'minute',
    achievedInclinationDeg: 97.9, achievedInclinationSource: 'GCAT satcat 2018-076A (615 x 634 km, 97.90 deg)',
    orbit: { perigeeKm: 615, apogeeKm: 634, inclinationDeg: 97.9, source: 'GCAT satcat 2018-076A (CC-BY-4.0)' },
    azimuth: { deg: 199, kind: 'documented', uncertaintyDeg: 5,
      source: 'SpaceX SAOCOM 1A press kit timeline, reproduced in Oberg 2018 review draft',
      url: 'http://satobs.org/seesat_ref/misc/181007-spaceX_1208.pdf' },
    disagreements: [{ field: 'launch azimuth', resolution: 'reported',
      values: [{ value: '199 deg (press kit)', source: 'spacex-saocom1a-press-kit' },
        { value: '189.6 deg (implied by the achieved 97.90 deg inclination at 34.632 N)', source: 'derived-gcat-2018-076' }],
      note: 'A fixed-azimuth ascent on 199 deg would reach 105.5 deg inclination. The 9.4 deg gap is the ' +
        'signature of the yaw steering these Vandenberg sun-synchronous ascents fly, so the pad azimuth is ' +
        'a first-leg direction and not the plane of the orbit.' }],
    notes: 'The first stage returned to Landing Zone 4, so this series covers the ascent and the booster ' +
      'return; the second stage, which carried the visible twilight plume after staging, is not in it.' },
  { id: 'falcon-heavy-demo-1-2018-017', folder: 'Falcon Heavy Demo 1', mission: 'Falcon Heavy Demo 1',
    vehicle: 'Falcon Heavy', stage: 2, phaseAfterMeco: 'second-stage',
    pad: 'Launch Complex 39A', latDeg: 28.608, lonDeg: -80.604,
    launchUtc: '2018-02-06T20:45:00.000Z', launchPrecision: 'minute',
    achievedInclinationDeg: 29.02, achievedInclinationSource: 'GCAT satcat 2018-017A (180 x 6939 km parking orbit, 29.02 deg)',
    orbit: { perigeeKm: 180, apogeeKm: 6939, inclinationDeg: 29.02, source: 'GCAT satcat 2018-017A (CC-BY-4.0)' },
    azimuth: { deg: 84.9, kind: 'derived-from-achieved-inclination', uncertaintyDeg: 3,
      source: 'derived from GCAT achieved parking-orbit inclination 29.02 deg and the WGS-84 pad latitude',
      url: 'https://planet4589.org/space/gcat/' },
    disagreements: [{ field: 'launch azimuth', resolution: 'reported',
      values: [{ value: '84.9 deg (plane implied by the achieved 29.02 deg inclination)', source: 'derived-gcat-2018-017' },
        { value: 'no published pad azimuth found', source: 'source-search-2026-10' }],
      note: 'The 180 x 6939 km parking orbit fixes the plane but not the ascent history; the second stage ' +
        'coasted and burned again, which this profile does not contain.' }],
    notes: 'This is the daylit, less favourable end of the observing range: the vehicle is sunlit at the ' +
      'parking orbit but the sky behind it is bright, which the assessment reports as unknown detectability ' +
      'rather than as visibility.' },
  { id: 'iridium-next-4-2017-083', folder: 'Iridium NEXT 4', mission: 'Iridium NEXT 4', vehicle: 'Falcon 9 Block 5',
    stage: 2, phaseAfterMeco: 'second-stage', pad: 'Space Launch Complex 4E', latDeg: 34.632, lonDeg: -120.611,
    launchUtc: '2017-12-23T01:27:23.000Z', launchPrecision: 'second',
    achievedInclinationDeg: 86.69, achievedInclinationSource: 'GCAT satcat 2017-083A..K (609-611 x 625-627 km, 86.69 deg)',
    orbit: { perigeeKm: 610, apogeeKm: 626, inclinationDeg: 86.69, source: 'GCAT satcat 2017-083A..K (CC-BY-4.0)' },
    azimuth: { deg: 176.0, kind: 'derived-from-achieved-inclination', uncertaintyDeg: 3,
      source: 'derived from GCAT achieved inclination 86.69 deg and the WGS-84 pad latitude',
      url: 'https://planet4589.org/space/gcat/' },
    disagreements: [{ field: 'launch azimuth', resolution: 'reported',
      values: [{ value: '176.0 deg (plane implied by the achieved 86.69 deg inclination)', source: 'derived-gcat-2017-083' },
        { value: 'no published pad azimuth found', source: 'source-search-2026-10' }],
      note: 'The bearing is derived from the achieved orbit rather than documented, and the profile carries ' +
        'that derivation instead of a measured value.' }],
    notes: 'The series runs from liftoff to second-stage cutoff and reaches about 197 km and 1490 km ' +
      'downrange. Its terminal altitude and speed do not agree with the achieved 610 x 626 km orbit, which ' +
      'the tests check and the feasibility report discusses.' },
];

const profiles = [];
for (const mission of MISSIONS) {
  const events = await getJson(`${mission.folder}/JSON/events.json`);
  const analysed = await getJson(`${mission.folder}/JSON/analysed.json`);
  profiles.push({
    schema: 'worthlookingup.trajectory-profile/1',
    id: mission.id,
    mission: mission.mission,
    vehicle: mission.vehicle,
    stage: mission.stage,
    evidence: { level: 2, code: 'reconstructed-vehicle-profile',
      provenanceKind: 'webcast-telemetry-reconstruction',
      source: 'shahar603/Telemetry-Data (webcast telemetry transcriptions)',
      sourceUrl: SOURCE + encodeURI(`${mission.folder}/JSON/analysed.json`),
      licence: 'Unlicense (public domain)',
      retrievedUtc: RETRIEVED,
      method: `third-party transcription of webcast telemetry displays, reduced here to ${STEP_S} s samples ` +
        'of altitude and downrange distance, referenced to liftoff' },
    launch: { utc: mission.launchUtc, precision: mission.launchPrecision, source: 'GCAT launch log (CC-BY-4.0)' },
    site: { pad: mission.pad, latDeg: mission.latDeg, lonDeg: mission.lonDeg,
      source: 'GCAT launch point catalogue (CC-BY-4.0)' },
    azimuth: mission.azimuth,
    plane: { achievedInclinationDeg: mission.achievedInclinationDeg, source: mission.achievedInclinationSource },
    orbit: mission.orbit,
    samplingS: STEP_S,
    samples: reduce(analysed, { mission: mission.mission, events, phaseAfterMeco: mission.phaseAfterMeco }),
    gaps: [],
    disagreements: mission.disagreements,
    limits: [mission.notes,
      'Derived from a public webcast, not from operator telemetry: absolute altitude and velocity are not ' +
      'independently validated, which is why this is evidence level 2 and not level 1.'],
    sourceEvents: events,
  });
}

const output = {
  schema: 'worthlookingup.trajectory-fixtures/1',
  generated_by: 'scripts/build-trajectory-fixtures.mjs',
  retrieved_utc: RETRIEVED,
  source: { name: 'shahar603/Telemetry-Data', url: 'https://github.com/shahar603/Telemetry-Data',
    licence: 'Unlicense (public domain)', description: 'webcast telemetry transcriptions for Falcon 9 and Falcon Heavy flights' },
  note: 'Generated file: change the script, not this file. Altitudes and downranges are metres; times are seconds after liftoff.',
  profiles,
};
const target = new URL('../tests/fixtures/launches/trajectory-profiles.json', import.meta.url);
writeFileSync(target, JSON.stringify(output, null, 1) + '\n');
console.log(`wrote ${profiles.length} profiles (${profiles.map(p => p.samples.length).join(' + ')} samples) to ${target.pathname}`);

