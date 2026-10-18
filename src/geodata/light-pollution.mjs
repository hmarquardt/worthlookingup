/* Artificial night-sky brightness and upward radiance, kept as two different measurements.

   The distinction this module exists to protect:

     * `upward-radiance` — satellite-measured light leaving the ground, in nW cm^-2 sr^-1 (VIIRS DNB).
       It is a property of the *ground*, not of the sky at an observer's eye, and it cannot be converted
       into a sky brightness without an atmospheric transfer model, an emission spectrum and an aerosol
       assumption. This module refuses that conversion.
     * `zenith-sky-brightness` — modelled artificial sky luminance at the zenith, in mcd m^-2 (the Falchi
       et al. atlas). It is a property of the *sky*, and it converts to surface brightness in magnitudes
       per square arcsecond by the standard V-band relation below — but it covers artificial light only,
       so it must be added to the natural sky before it is compared with an SQM reading.

   Neither is the Bortle class, which is a subjective naked-eye scale covering the whole sky. No function
   here returns a Bortle number, and a test asserts that none ever does. */

export const UNITS = Object.freeze({
  RADIANCE: 'nW cm^-2 sr^-1',
  ZENITH_MCD: 'mcd m^-2',
});

/* V-band surface brightness from luminance: mag/arcsec^2 = 12.58 - 2.5 log10(L[cd/m^2]). The constant is
   the commonly used Johnson V zero point (1 cd/m^2 ~ 12.58 mag/arcsec^2) quoted in the light-pollution
   literature, and it is stated here rather than buried so a reader can check it. */
export const MPSAS_ZERO_POINT = 12.58;

export function mcdToMpsas(mcd) {
  if (!Number.isFinite(mcd) || mcd <= 0) return null;
  return MPSAS_ZERO_POINT - 2.5 * Math.log10(mcd / 1000);
}

export function mpsasToMcd(mpsas) {
  if (!Number.isFinite(mpsas)) return null;
  return 1000 * Math.pow(10, (MPSAS_ZERO_POINT - mpsas) / 2.5);
}

/* The natural sky is not zero. A dark site measures about 22.0 mag/arcsec^2 (0.17 mcd/m^2) including
   airglow, zodiacal light and the Milky Way itself; without adding it, an artificial-only atlas makes a
   pristine site look infinitely dark and a comparison with a measured sky meaningless. The default is
   stated, overridable, and never presented as a measurement of the place. */
export const NATURAL_SKY_MCD = 0.17;

export function combineWithNaturalSky(artificialMcd, naturalMcd = NATURAL_SKY_MCD) {
  if (!Number.isFinite(artificialMcd) || artificialMcd < 0) return null;
  if (!Number.isFinite(naturalMcd) || naturalMcd <= 0) throw new Error('sky: natural sky brightness must be a positive number');
  const total = artificialMcd + naturalMcd;
  return { artificialMcd, naturalMcd, totalMcd: total, totalMpsas: mcdToMpsas(total) };
}

/* Comparing two samples of the same quantity. Within one unit the ratio is exact and becomes a magnitude
   difference; across units the answer is null with a reason, because there is no defensible conversion. */
export function compareSamples(a, b) {
  if (!a || !b) return { comparable: false, reason: 'one of the samples is missing' };
  if (a.unit !== b.unit) {
    return { comparable: false, reason: 'different quantities (' + a.unit + ' versus ' + b.unit + '): upward ' +
      'radiance is not sky brightness, and converting it needs an atmospheric model this product does not have' };
  }
  if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) return { comparable: false, reason: 'a sample has no value' };
  if (a.value <= 0 || b.value <= 0) {
    return { comparable: false, reason: 'a zero or negative value cannot be compared as a ratio; a zero here ' +
      'means the pixel was masked, not that no light exists' };
  }
  const ratio = a.value / b.value;
  return { comparable: true, unit: a.unit, ratio, magnitudeDifference: 2.5 * Math.log10(ratio),
    brighter: ratio > 1 ? 'a' : ratio < 1 ? 'b' : 'equal' };
}

/* One sampled value with everything needed to defend it. `value` is null when the pixel is masked, outside
   coverage, or the source is unavailable, and in every one of those cases the reason travels with it. */
export function sampleSkyEvidence({ sampler, point, unit, source = null, naturalMcd = NATURAL_SKY_MCD } = {}) {
  if (!sampler || typeof sampler.sample !== 'function') throw new Error('sky: a sampler is required');
  if (unit !== UNITS.RADIANCE && unit !== UNITS.ZENITH_MCD) throw new Error('sky: unknown unit ' + unit);
  const sampled = sampler.sample(point);
  if (sampled.value === null) {
    return { unit, value: null, mpsas: null, totalMpsas: null, source,
      reason: sampled.reason === 'nodata'
        ? 'the source has no data at this pixel (masked, or cloud-free coverage missing), which is not the same as darkness'
        : sampled.reason || 'no value' };
  }
  if (unit === UNITS.RADIANCE) {
    return { unit, value: sampled.value, mpsas: null, totalMpsas: null, source, reason: null,
      note: 'upward radiance measured from above; not a sky brightness, and not convertible to one here' };
  }
  const combined = combineWithNaturalSky(sampled.value, naturalMcd);
  return { unit, value: sampled.value, mpsas: mcdToMpsas(sampled.value),
    totalMpsas: combined ? combined.totalMpsas : null, source, reason: null,
    note: 'modelled artificial zenith brightness; add the natural sky before comparing with a meter reading' };
}

/* Ordering inside one unit, with the missing samples kept as missing rather than sorted to the end as if
   they were dark. `rank` is ordinal only: it says which of two places is brighter, never how much of a
   difference that makes to an eye or to a photograph. */
export function rankBySkyEvidence(samples) {
  const present = samples.filter(sample => sample && Number.isFinite(sample.value));
  const unit = present.length ? present[0].unit : null;
  if (present.some(sample => sample.unit !== unit)) return { ranked: [], unit: null, reason: 'mixed units: these are different quantities' };
  const sorted = present.slice().sort((a, b) => a.value - b.value).map((sample, index) => ({ ...sample, rank: index + 1 }));
  const missing = samples.length - present.length;
  return { ranked: sorted, unit, missing,
    reason: missing ? missing + ' sample(s) have no usable value and are not ranked' : null };
}
