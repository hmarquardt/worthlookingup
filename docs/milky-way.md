# Milky Way observing and photography windows

The question this answers is "when can I see or photograph the Milky Way from here?", and the answer is
built only from geometry, twilight and the Moon — never from a claim about how bright anything is.

## Reference coordinates

| what | value | source |
| --- | --- | --- |
| Galactic centre | RA 17h45m40.04s, Dec −29°00′28.1″ (J2000.0) | Sgr A* radio position, Reid & Brunthaler 2004, ApJ 616, 872 |
| Galactic frame | pole RA 192.85948°, Dec +27.12825°, l<sub>NCP</sub> 122.93192° (J2000.0) | IAU 1958 galactic frame (Blaauw et al. 1960) |
| Band sample | 24 longitudes at b = 0, 15° apart | geometry of the galactic plane, not a photometric model |

The centre is a **fixed direction on the celestial sphere**, not a solar-system body: no parallax, phase,
light-time or orbital motion is applied to it. Its horizontal position comes from the same pinned Astronomy
Engine 2.1.19 build every other category uses, through `horizontalFromJ2000` in overhead-astro.js, so the
frame handling (J2000 catalogue position → true equator of date → topocentric horizon) is shared rather
than reimplemented. The galactic frame is rotated into equatorial coordinates by the adopted IAU constants
alone; there is no second table of sky positions in the codebase.

**Refraction** is applied above the horizon in the usual way, and the airless altitude and the size of the
correction are both reported (`core.refractionDeg`) rather than hidden.

## Core or whole band?

The primary subject is the core, because that is what a photographer frames. The band is handled
deliberately weakly: `bandSummary` reports how many of 24 sampled galactic longitudes are above 10°, 20° and
30°, where the highest sampled point is, and nothing else. There is no brightness ranking of the band
anywhere in this feature, and the interface repeats the geometric fact that protects a reader from the wrong
conclusion: the galactic plane is a great circle, so about half of it is above the horizon at any latitude
and any time. "The core is down" is therefore never reported as "the Milky Way is invisible".

## Darkness

Twilight comes from the existing solar calculation (`overhead-astro.js` `darkness()`), astronomical darkness
(Sun below −18°) preferred, nautical (−12°) second, civil (−6°) last. The window a reader sees is the
**intersection** of the dark interval with the interval where the core is above the configured threshold,
with both edges bisected to about ten seconds.

- A night that never reaches astronomical darkness says so: a high-latitude summer window is labelled
  nautical or civil, with the darkness factor scaled accordingly, and a night with no darkness at all
  produces a refusal naming the missing darkness instead of an invented window.
- Observing nights are the product's own sunset-to-sunrise windows, so midnight crossings, polar days and
  daylight-saving transitions are handled where they already were: the engine takes windows as input and
  never converts local wall-clock hours itself.

## Moonlight

Five states, decided from where the Moon actually is at the time, never from phase alone:

| state | rule |
| --- | --- |
| `moon-below-horizon` | the Moon is below −1° for the whole window |
| `moon-low-illumination` | the Moon is up, but under 25% lit or below 10° altitude for all of the time it is up |
| `some-moonlight` | the Moon is up and lit, without reaching the significant rule |
| `significant-moonlight` | a Moon at least 60% lit is up for ≥35% of the window, or comes within 60° of the core |
| `moon-uncertain` | the Moon could not be evaluated: never silently treated as a good night |

A bright Moon below the horizon costs nothing, which is the case phase-only reasoning gets wrong. The Moon
is sampled inside the window only, at 15-minute steps (20 at 90 days), together with its separation from the
core.

No sky-brightness model exists here: moonlight is described with the Moon's own illuminated fraction,
altitude and separation, and the interface says so in words. Light pollution, transparency and haze are
named as unmodelled limitations in every quality record.

## Thresholds

| quantity | value | why |
| --- | --- | --- |
| usable core altitude | 10° | below this the core is lost in haze and horizon clutter |
| good / default window threshold | 20° | the working value for a photograph; configurable per request |
| photographic altitude | 30° | where the core stands clear of the worst atmospheric extinction |
| minimum window | 20 minutes | anything shorter is a coincidence, not a plan |
| forecast horizon | 72 hours | beyond it cloud and wind fields stop meaning anything |
| refraction | applied, and reported | so the choice is visible rather than assumed |

## The opportunity model and its selection policy

Each night yields one candidate in the shared opportunity model (`overhead-opportunities.js`), so the Milky
Way travels through the same plan, dedupe, ranking, confidence, discovery and calendar machinery as every
other category. Nights are ranked by, in order:

1. the core being sufficiently high inside the dark window (higher and longer first),
2. more astronomical darkness,
3. less moon interference,
4. a forecast, when one exists inside its range, as a separate signal that never changes the geometry.

The number a reader sees is the category's own **window quality**:

```
quality = 100 * (0.45 * core + 0.30 * darkness + 0.25 * moon)

core     = (highest core altitude in the window - 10 deg) / (30 - 10), clamped to 0..1
darkness = (window minutes / 240, clamped to 0..1) * level factor (astronomical 1, nautical 0.6, civil 0.25)
moon     = 1 - (lit-Moon fraction of the window) * illumination weight * separation weight
```

The weights are documented in the engine, the factors travel with the number, monotonicity in every input is
asserted by tests, the value is bounded to 0..100 for any input, and **weather never enters it**. It is

## Accuracy and known limitations

- The coordinate path is validated against an independent implementation written into the test suite (Meeus
  IAU-1976 precession, the GMST series, explicit spherical trigonometry): worst altitude disagreement over
  five latitudes and six dates is **0.003°**, azimuth **0.007°**.
- The frame's own origin lands on Sgr A* to **0.073°**, the known offset between the IAU galactic origin and
  the radio source — a cross-check between two independent pieces of data, not a tautology.
- The highest core altitude matches 90 − |latitude − declination| to **0.033°** at northern, southern and
  tropical sites.
- Window edges agree to **0.08 minutes** between the 10-minute and 20-minute sampling used for short and long
  horizons, because both edges are bisected rather than read off a grid.
- Not modelled anywhere: light pollution, atmospheric transparency, haze, smoke, dark adaptation, and whether
  the sky will actually be clear. This is astronomy and camera guidance, not a promise of a photograph.

## Equipment notes

The engine derives its advice from the numbers it computed: a tripod, a wide and fast lens (24 mm on a
full-frame camera or wider frames the ~30° core and its surroundings), manual focus, raw files, dark
adaptation time, the direction and altitude of the peak, how long the window and the astronomical darkness
last, and what the Moon is doing during it. Exposure settings are deliberately not prescribed, because they
depend on the lens, the site and the sky.

## Integration

- **Discovery**: the category contributes Tonight and Coming Up events through the same mapper every celestial
  category uses. Events carry `precision: 'window'`, their own priority, and their limitations in the warning
  list. Nothing is fetched or calculated until a reader opens the category.
- **Calendar** (`overhead-calendar.js`, the only iCalendar writer): a window exports as an interval with
  `DTSTART`/`DTEND` at the real boundaries — never rounded into a one-hour block — with a stable UID per
  night, the observing window, the best direction, the equipment label, the forecast state when there is one,
  and the window quality with its non-comparability caveat. The observing plan shares that identity, so a
  refreshed calculation updates an entry instead of duplicating it.
- **Horizons**: tonight, seven days and ninety days. The ninety-day view uses coarser sampling (20-minute
  core steps, 15-minute solar, 20-minute Moon) and consolidates consecutive nights into a single run card
  through the shared model. A 90-night request takes about **0.2 seconds** in Node, and identical nights are
  cached in memory (bounded) so switching horizons reuses them rather than recomputing.
- **Isolation**: the Milky Way never enters satellite or celestial scoring, and its own number ranks its own
  nights only.

## Inputs a future location recommendation would need

Nothing in this release recommends a place, only a time. Pointing a reader at a site would need a
light-pollution dataset with a licence that permits display, terrain and horizon obstruction from a digital
elevation model, land access and protected-area boundaries, and a travel-time model. None of those are in
scope here, and inventing a substitute — for example treating distance from a city centroid as darkness —
would be exactly the kind of unsupported precision this project refuses.

explicitly not comparable with the satellite, meteor or planetary observing values, and both the card and
the calendar description say so in words: those numbers answer a different question about a point source
crossing the sky.

Weather is reported separately and honestly. Missing weather is `no-usable-forecast`, never clear skies;
inside the forecast range the cloud cover is attached as context, with its age.

