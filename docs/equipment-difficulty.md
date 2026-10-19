# Observing difficulty and equipment guidance

Phase 7A. The product now answers three separate questions beside an opportunity:

1. **Opportunity** — how favourable are the circumstances? This is the existing observing-suitability score.
2. **Difficulty** — how hard is the object or phenomenon to see, and separately to photograph?
3. **Equipment** — what kind of instrument and technique is a reasonable starting point?

The score is not changed by this feature. A faint comet can have an 83/100 opportunity and still be an
advanced visual target. The card says both things and explains why they are different.

## Taxonomy

| Level | Label | Meaning in this product |
| --- | --- | --- |
| 1 | Easy | Naked-eye observing is a reasonable primary approach under appropriate conditions |
| 2 | Accessible | Binoculars or a simple optical aid, or a bright object with a straightforward technique |
| 3 | Moderate | Small telescope, or a camera technique with some care |
| 4 | Challenging | Larger telescope, dark conditions, or tracked imaging and careful processing |
| 5 | Advanced | Substantial aperture/experience, specialized equipment, or demanding tracked imaging |

These are **Worth Looking Up's own guidance tiers**, not an astronomical standard. They are not a
limiting-magnitude calculation, a detectability model or a claim that a particular instrument will show an
object. Visual and imaging levels are separate whenever the object supports both.

## Object-specific logic

The pure module is `overhead-difficulty.js`. It has no DOM, storage, network or scoring dependency.

### Comets

- The visual tier uses the most recent **total** magnitude, with the 30-day median when available. If the
  latest measurement is CCD and a 30-day median exists, the **fainter** of the two is used for the visual
  tier: a CCD total magnitude can include much fainter outer coma than a visual observer records.
- Thresholds are conservative comet tiers, not a stellar cutoff: roughly ≤3.5 Easy, ≤5.5/≤8 Accessible,
  ≤10.5 Moderate, ≤12.5 Challenging, fainter Advanced. The exact boundaries are product heuristics and are
  documented in code.
- Low altitude, non-astronomical darkness and washed-out moonlight can move the tier one level harder.
- Measurement age controls confidence: ≤14 days high, ≤30 days medium, older low, with an explicit stale
  warning. The published trend is reported as a fit through uneven observations, never as a prediction for
  tonight.
- A measured/predicted disagreement of 1.5 mag or more is reported; neither value is adopted as certainty.
- **Total magnitude is not surface brightness.** A diffuse magnitude-14 comet is harder to see than a
  magnitude-14 star. The card says this explicitly.
- **Coma sizes are never converted to surface brightness.** The COBS field is currently published as
  `coma_diameter_arcmin` with a recorded generator caveat that the unit could not be confirmed. The
  difficulty module receives the value with `unitVerified: false`, leaves `surfaceBrightness` null, and
  states the limitation. No arcminute assumption is made.
- A small telescope is not declared sufficient from a stellar limiting magnitude. Profile guidance only says
  that an aperture is likely too small, may be challenging, or may be adequate under dark skies; it never
  promises a detection.

### Planets and the Moon

- Planet diagrams come from the same Astronomy Engine model magnitude and geocentric distance already used by
  the planetary engine. An approximate angular diameter is derived from a documented equatorial radius
  (NASA planetary fact sheets) and the computed distance; it is an approximation, not an observed disc.
- Bright classical planets are easy to identify by eye; the **detail** tier follows angular size and seeing.
  Uranus and Neptune remain telescope-only at every magnitude. Mercury and Venus are at least Accessible
  because twilight is part of their normal visibility.
- Atmospheric seeing, not aperture alone, limits planetary detail. When an aperture is reported, the guide
  mentions the common "about 2× aperture in millimetres" useful-magnification rule as a rule of thumb.
- Imaging guidance is short-exposure/video "lucky imaging", not a long deep-sky exposure.

### Satellites and Starlink trains

- A bright pass is a naked-eye, wide-field event. A Starlink train is explicitly wide-field.
- Binoculars may help on a bright pass but the field is narrow and the target is moving.
- Manual high-magnification telescope tracking is called out as advanced work, not a beginner activity.
- A camera on a tripod can record a trail; tracked satellite imaging is a separate, more demanding technique.
- No apparent magnitude is invented from the pass brightness category.

### Meteor showers

- Naked eye and a wide field are the primary approach. ZHR is an ideal-sky reference, not a forecast for one
  observer.
- Binoculars narrow the field and are not the primary tool; a telescope is the wrong field of view.
- A wide-field camera can record trails, as a separate imaging technique.

### Milky Way

- The band is a naked-eye target under dark skies; the core is low-contrast and easily lost to moonlight,
  light pollution or a low altitude.
- A whole-sky or landscape Milky Way photograph is a wide-field camera job. A telescope is too narrow.
- The Milky Way card's window quality (45/30/25 on core altitude, darkness and moonlight) remains a separate
  opportunity measure, not a difficulty score and not comparable with other categories.

### Eclipses

- A lunar eclipse is naked-eye; binoculars enlarge the Moon but are not required.
- A solar eclipse requires a **certified full-aperture solar filter**; the app cannot verify that a filter is
  certified, undamaged or correctly fitted.

### Unknown types

If no object-specific rule exists, the result is **Difficulty uncertain**. No universal magnitude cutoff is
applied across different kinds of object.

## Equipment profile

The optional local profile is `worthlookingup.equipment/1` in `overhead.equipment.v1`. It is user-reported
capability, not a calibrated performance specification. Every field is optional:

```
{
  schema: "worthlookingup.equipment/1",
  types: { nakedEye, binoculars, telescope, smartTelescope, camera, trackedImaging, advancedImaging },
  binoculars: { magnification, objectiveMm },
  telescope: { apertureMm },
  camera: { sensor, focalLengthMm, aperture, tracking },
  updatedAt
}
```

- Values are bounded and invalid values become `null`; corrupt JSON is ignored rather than shown.
- The profile is available to the cards and may prefill camera fields only when a session has no camera
  choices. It never overwrites a saved session or an explicit session choice.
- It never hides opportunities, never changes a score and never changes ranking.
- It is local only. It is not uploaded, not added to analytics and not included in the existing preference
  transfer export. Clearing site data removes it.
- A no-profile visitor still sees general difficulty, reasoning, limitations and the guide link.

## Presentation

Every celestial opportunity card shows, immediately below its summary:
**Visual: <level> · Imaging: <level>**, the suggested approach, one plain-English reason, the profile-specific
fit when a profile exists, and a disclosure with inputs, limitations, evidence/confidence and the explicit
statement that the tier is not a standard or a promise. Discovery cards carry a compact difficulty line.
The satellite detail dialog carries the same block. The equipment guide opens from Settings, from every
difficulty block and from the session builder.

The opportunity score remains in its existing card position and label. For the Milky Way it remains the
category's own window quality.

## Scientific references and limits

- Comet photometry and the measured/predicted distinction come from the existing COBS/JPL SBDB pipeline and
  its documented provenance. The coma-unit caveat is retained.
- Planetary radii: NASA planetary fact sheets, <https://nssdc.gsfc.nasa.gov/planetary/factsheet/>.
- Angular diameter: `2 atan(R / d)` with R in km and d in AU, converted to arcseconds. This is geometry, not a
  measurement of the apparent disc.
- The difficulty tiers and aperture-fit language are product heuristics informed by common observing practice,
  not a validated detection model. They deliberately prefer uncertainty to invented precision.
- Unimplemented: measured sky brightness, telescope transmission, pixel scale, seeing forecasts, observer
  experience, local horizon obstruction, surface-brightness models and coma-unit confirmation.
