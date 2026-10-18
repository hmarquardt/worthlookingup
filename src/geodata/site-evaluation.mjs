/* One candidate, evaluated on three separate axes, and a comparison that never fuses them.

   The output deliberately has no overall number. A dark site with no legal access, a legal site whose
   horizon is blocked by trees the DEM cannot see, and a good site three hours away are different answers to
   different questions, and averaging them into a score would make all three look like one thing. What this
   module produces instead is a verdict per axis, the evidence behind each verdict, the gaps, and a grouping
   that puts anything without documented after-dark access outside the recommendable group. */

import { distanceMetres } from './geo-geometry.mjs';
import { describeAccess, isRecommendable, ACCESS_STATES } from './access-evidence.mjs';

/* Sky evidence is either a real sample with its unit and source, or explicitly unavailable. There is no third
   state and no default value: an absent dataset is never rendered as darkness. */
function skyVerdict(sky) {
  if (!sky || sky.value === null || sky.value === undefined) {
    return { state: 'unavailable', value: null, unit: sky ? sky.unit : null,
      reason: (sky && sky.reason) || 'no licensed, machine-readable sky-brightness dataset is available for this location',
      note: 'unavailable is not the same as dark' };
  }
  return { state: 'sampled', value: sky.value, unit: sky.unit, mpsas: sky.mpsas ?? null,
    totalMpsas: sky.totalMpsas ?? null, source: sky.source || null, note: sky.note || null };
}

function terrainVerdict(profile, core) {
  if (!profile || !profile.clearance) {
    return { state: 'unknown', reason: 'no elevation profile was computed for this candidate' };
  }
  const clearance = profile.clearance;
  return { state: clearance.status,
    horizonAngleDeg: clearance.horizonAngleDeg,
    coreAltitudeDeg: core ? Number(core.altitudeDeg.toFixed(1)) : null,
    coreAzimuthDeg: core ? Number(core.azimuthDeg.toFixed(1)) : null,
    differenceDeg: clearance.differenceDeg,
    uncertaintyDeg: clearance.uncertaintyDeg,
    reason: clearance.reason || null,
    demSource: profile.dem ? profile.dem.source : null,
    pixelSizeM: profile.dem ? profile.dem.pixelSizeM : null,
    caveat: 'modelled bare-earth terrain only: trees, buildings, levees and vehicles are not in the model' };
}

export function evaluateSite({ candidate, access, profile, core, sky, origin = null, now = Date.now() }) {
  if (!candidate || !candidate.coordinates) throw new Error('site: a candidate with coordinates is required');
  const described = describeAccess(access);
  const terrain = terrainVerdict(profile, core);
  const skyState = skyVerdict(sky);
  const warnings = [];
  const provenance = [];

  if (!isRecommendable(access)) {
    warnings.push(access.state === ACCESS_STATES.RESTRICTED
      ? 'access is restricted after dark by an authoritative source' + (access.nightWindow ? ' (' + access.nightWindow + ')' : '')
      : 'after-dark access is not verified, so this is not a recommendation');
  }
  if (access && access.stale) warnings.push('the access evidence is stale and must be re-checked before use');
  if (candidate.ownership && candidate.ownership.publicAccessFlag === 'RA' && isRecommendable(access)) {
    warnings.push('PAD-US records restricted access for this unit (' + candidate.ownership.designation +
      '), so the property rules must be confirmed on the ground');
  }
  if (terrain.state === 'unknown') warnings.push('terrain clearance is unresolved: ' + terrain.reason);
  if (terrain.state === 'obstructed') warnings.push('modelled terrain rises above the core in this direction');
  if (skyState.state === 'unavailable') warnings.push('sky brightness is unavailable, not dark: ' + skyState.reason);

  provenance.push({ claim: 'ownership and management', source: 'usgs-padus-4-1',
    detail: candidate.ownership ? [candidate.ownership.ownerType, candidate.ownership.managerType,
      candidate.ownership.designation, Math.round(candidate.ownership.acres) + ' ac'].join(' / ') : null });
  for (const evidence of (candidate.accessEvidence || [])) {
    provenance.push({ claim: 'access', source: evidence.kind + ':' + evidence.publisher, url: evidence.url,
      verifiedAt: evidence.verifiedAt, quote: evidence.quote || null });
  }
  if (profile && profile.dem) {
    provenance.push({ claim: 'terrain horizon', source: profile.dem.source, url: profile.dem.url,
      detail: profile.dem.pixelSizeM + ' m pixels; ' + profile.dem.product });
  }
  if (skyState.source) provenance.push({ claim: 'sky brightness', source: skyState.source, detail: skyState.unit });

  const metres = origin ? distanceMetres(origin, candidate.coordinates) : null;
  return {
    id: candidate.id, name: candidate.name, type: candidate.type,
    coordinates: candidate.coordinates,
    distance: origin ? { metres: Math.round(metres), km: Number((metres / 1000).toFixed(1)), kind: 'great-circle',
      caveat: 'straight-line distance, not a drive; no road distance or travel time is computed' } : null,
    access: { state: access.state, label: described.label, reason: described.reason, stale: Boolean(access.stale),
      recommendable: isRecommendable(access), nightWindow: access.nightWindow || null,
      conflict: Boolean(access.conflict), oldestEvidenceDays: access.oldestEvidenceDays ?? null },
    terrain,
    sky: skyState,
    core: core ? { day: core.night ? core.night.day : null, altitudeDeg: Number(core.altitudeDeg.toFixed(1)),
      azimuthDeg: Number(core.azimuthDeg.toFixed(1)), compass: core.compass,
      windowMinutes: core.windowMinutes ?? null, moonlight: core.moonlight ?? null } : null,
    warnings, provenance,
    noCompositeScore: true,
  };
}

/* The comparison. Grouping is by access first, because a place you may not stand in is not a candidate at
   any sky quality; inside the recommendable group the order is modelled terrain clearance, then whether sky
   evidence exists at all. That order is a documented editorial choice, not a measurement of quality. */
export function compareSites(rows) {
  const recommendable = rows.filter(row => row.access.recommendable);
  const needsVerification = rows.filter(row => !row.access.recommendable &&
    [ACCESS_STATES.PUBLIC_UNKNOWN, ACCESS_STATES.INSUFFICIENT].includes(row.access.state));
  const unsuitable = rows.filter(row => !row.access.recommendable &&
    [ACCESS_STATES.RESTRICTED, ACCESS_STATES.PRIVATE].includes(row.access.state));
  const byTerrain = (a, b) => (b.terrain.differenceDeg ?? -999) - (a.terrain.differenceDeg ?? -999);
  const withSky = (list) => list.filter(row => row.sky.state === 'sampled').sort(byTerrain)
    .concat(list.filter(row => row.sky.state !== 'sampled').sort(byTerrain));
  return {
    noCompositeScore: true,
    basis: 'grouped by documented after-dark access first, then by modelled terrain clearance; no sky-quality ' +
      'or overall score is computed, and no road distance or travel time is inferred',
    recommendable: withSky(recommendable),
    needsVerification: withSky(needsVerification),
    unsuitable: withSky(unsuitable),
    counts: { total: rows.length, recommendable: recommendable.length,
      needsVerification: needsVerification.length, unsuitable: unsuitable.length,
      skySampled: rows.filter(row => row.sky.state === 'sampled').length,
      terrainClear: rows.filter(row => row.terrain.state === 'clear').length },
  };
}
