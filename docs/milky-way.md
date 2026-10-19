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
explicitly not comparable with the satellite, meteor or planetary observing values, and both the card and the
calendar description say so in words: those numbers answer a different question about a point source crossing
the sky.

Weather is reported separately and honestly. Missing weather is `no-usable-forecast`, never clear skies;
inside the forecast range the cloud cover is attached as context, with its age.

## When there is no window in the horizon

An empty horizon is a real answer and is treated as one. `analyse()` returns a `summary` with the night
whose core climbed highest (`bestDay`, `bestCoreAltitude`, `bestCoreCompass`, `bestCoreTime`), the twilight
that night reaches, the engine's own refusal reasons, and the band counts. The interface renders it only
when the category's plan is empty, and it separates the two failure modes, which are not the same thing:
the core can stay below the threshold all night, or it can clear the threshold while the sky is still too
bright to use — at 38.4° N in mid-October it is the second, and the explanation says so with one decimal
of altitude so the sentence and the comparison cannot disagree. Every empty state also carries the
statement that this is a fact about the core, not about the galaxy, and that nothing there is a claim
about clouds.

## Cost

The engine is not a page script: it is fetched the first time a reader opens the category (42,469 bytes
raw, 13.2 KB gzipped) and never otherwise, and it needs no dataset at all, so opening the category makes
no other request. A 90-night analysis takes about 0.2 seconds in Node, and identical nights are cached in
memory (bounded, session-only) so switching horizons reuses them. The one shared change to the existing
celestial stack is the ninety-day window builder, whose extension loop re-read a growing array length and
so repeated the eighth night; that is fixed for every category and asserted in the browser suite.

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
- **Horizons**: tonight, seven days and ninety days, plus the separate year-long **next season** search described
  below, which answers "when at all". A seasonal result is deliberately outside the global planning horizons, so
  no category's planner was stretched to a year. The ninety-day view uses coarser sampling (20-minute core
  steps, 15-minute solar, 20-minute Moon) and consolidates consecutive nights into a single run card through the
  shared model. A 90-night request takes about **0.2 seconds** in Node, and identical nights are cached in
  memory (bounded) so switching horizons reuses them rather than recomputing.
- **Isolation**: the Milky Way never enters satellite or celestial scoring, and its own number ranks its own
  nights only.

## The next season, beyond the ninety-day plan

The planning horizons answer "when, soon". For a reader outside the core's season, "soon" is an honest
negative and an unhelpful one, so the category also answers **when the core next becomes workable from
here** — for their own latitude, not for a hemisphere.

### Two dates, and they are not the same date

| term | definition | what it is not |
| --- | --- | --- |
| **season opening** | the first observing night on which the core clears the configured threshold (20° by default) for at least the minimum window while the sky is dark | not the best night, not a recommendation, and usually a short and low window |
| **first favourable night** | the first night whose **window quality** — this category's own 0–100 number — reaches the favourable bar | not a guarantee, not a weather forecast, and not comparable with any other category's score |

Both are computed by the same nightly analysis the plans use. The opening is a pure geometry question: the
first night the window exists. The favourable night additionally asks whether that window is worth a
photograph, using the number the category already publishes rather than a new scale.

**The favourable bar is 60**, and it was set by measurement, not preference. A full year of qualifying nights
at the reference sites gives a distribution whose marginal season-opening nights sit in the thirties and
forties (Indiana 2027: opening **30**, favourable **60**) and whose better half sits at sixty and above
(median 58, 75th percentile 67, maximum 74 at 38.4° N, where the core never climbs past about 23°). Sixty
therefore separates the early-season coincidence from the usable part of the season at the sites it was
calibrated on. If a season never reaches it, the interface says the season offers marginal windows only — it
does not invent a second date to look better, and there is no code path that could.

### The search

`analyseSeason()` walks the site's own observing nights in date order, reusing `analyseNight()` unchanged, and
stops as soon as it holds both answers. Nothing about nights, twilight, moonlight, refraction or the window
rule is reimplemented:

- **Horizon**: 366 nights, one full annual cycle plus a day, so a leap year cannot hide a season between two
  searches (`SEASON.horizonDays`). The interface builds them with the same `celestialWindows()` builder the
  plans use, so the first seven nights are the engine's own nights and the rest are sunset-to-sunrise per
  local noon — daylight-saving transitions included, because that builder already handles them.
- **Early exit is exact, not a heuristic**: the first night meeting a criterion is, by definition, the answer,
  and nights are examined in order. A site with no season has nothing to stop for, so the whole year is walked
  and the bound is the horizon itself; no loop can run past it.
- **No pre-filter**: an altitude or darkness pre-filter would have to be conservative to be safe, and a
  conservative pre-filter is exactly how an off-by-one-night bug hides. The measured cost of the exact walk is
  small enough that the check is unnecessary (see Cost).
- **Same sampling for both answers**: 20-minute core steps, 15-minute solar, 20-minute Moon. Both window edges
  are bisected, so this moves an edge by under a minute versus the fine sampling the short horizons use, and
  the equivalence is asserted rather than assumed.

### Local dates, and the night that belongs to two days

A night is labelled by the evening it begins; a window that opens at 04:49 belongs to the **next** calendar
date. Both are carried (`day` for the night, `date` for the instant) and every sentence, the calendar entry
and the plan use the instant's own local date, computed with `Intl` in the site's zone. An observer in Indiana
therefore reads "season opens 2027-03-29, 4:49–5:10 AM local", while the night it came from is the night of
the 28th.

 Pointing a reader at a site would need a
light-pollution dataset with a licence that permits display, terrain and horizon obstruction from a digital
elevation model, land access and protected-area boundaries, and a travel-time model. None of those are in
scope here, and inventing a substitute — for example treating distance from a city centroid as darkness —
would be exactly the kind of unsupported precision this project refuses.

### Every negative answer is classified, and none of them is "seasonal"

When the year holds no qualifying night, the reason is the geometry's own, and the cases are different things
a reader does different things about:

| classification | meaning | what the interface says |
| --- | --- | --- |
| `never-reaches-threshold` | the core never climbs above the 10° usable altitude anywhere in the year (e.g. 69.6° N) | the core stays below the useful horizon here all year; no season exists from this latitude |
| `below-threshold` | the core does rise, but never to the configured threshold (e.g. 60.2° N, a 0.8° ceiling) | the ceiling in degrees, and that no night can qualify |
| `no-darkness` | the sky never reaches even civil darkness in the searched nights (e.g. McMurdo in December) | the twilight, not the geometry, rules the season out — the core itself is up |
| `no-darkness-overlap` | the core clears the threshold only while the sky is too bright, all year | the altitude and the dark hours never coincide |
| `unavailable` | no observing nights could be built | the calculation could not run |

Every one of those carries the same guard against the wrong conclusion a reader could otherwise draw: the
galactic plane is a great circle, so part of the band is above the horizon at every hour, and the core being
out of reach does not make the band invisible. A short horizon changes the answer honestly too — a 30-night
look at McMurdo in December is classified `no-darkness`, while the same site searched across a year has a real
polar-night season.

### Weather, months ahead

Months ahead there is no forecast, so the result carries `weather: { state: 'not-forecastable' }` with the
sentence that says what it is instead: planned sky geometry — darkness, the core, the Moon — and not a
prediction of cloud, haze or light pollution. No cloud value, no sky brightness, no probability and no
"sighting chance" appears anywhere in the record or in an exported file, and a test asserts that those words
never appear either. The calendar file repeats the caveat, so a date saved for next March cannot be mistaken
for a promise about next March's weather.

### Reference cases

Fixed fixtures, reproduced by `tests/overhead-milkyway-season.cjs`, searched from **2026-10-16 23:30 UTC** over
366 nights unless noted:

| site | latitude | classification | season opening | first favourable |
| --- | --- | --- | --- | --- |
| Princeton, Indiana | 38.36° N | season found | 2027-03-29, 21 min, core 23° S, quality 30 (marginal) | 2027-04-13, 54 min, quality 60 |
| Miami, Florida | 25.76° N | season found | 2027-02-17, 23 min, core 32° | 2027-03-01 |
| Los Angeles | 34.05° N | season found | 2027-03-07, 22 min, core 27° | 2027-03-13 |
| Quito, Ecuador | 0.18° S | season found | tonight, 87 min, core 51° | four nights later |
| Cape Town | 33.92° S | season found | tonight, 112 min, core 60° | the same night |
| Sydney | 33.87° S | season found | tonight, 109 min, core 60° | the same night |
| Ushuaia | 54.80° S | season found | tonight, 82 min, core above 30° | on or after the opening |
| Helsinki | 60.17° N | never reaches the threshold | — (ceiling 0.8°) | — |
| Tromsø | 69.65° N | never reaches the threshold | — (the core never rises) | — |
| McMurdo, 30 nights from 2027-12-01 | 77.85° S | no darkness | — (core up to 37°) | — |

The point of the table is the spread: the same code returns a spring date for Indiana, tonight for Cape Town
and Sydney, and nothing at all for the Arctic, with the reason attached in each case.

### Accuracy

The seasonal walk is checked against a **brute-force scan** — every night, no early exit, the same engine — at
every reference site, and the first qualifying night and the first favourable night must match exactly. There
is no tolerance on the date, because a tolerance is exactly what hides an off-by-one-night error; the only
tolerance in the suite is ±1 minute on a window edge between 5-minute and 20-minute sampling, where both edges
are bisected. Coarse and fine sampling also agree on the night, and the window is the same interval the nightly
engine returns for that night — the season never constructs a window of its own.

### Cost, and why it does not block the page

| measurement | value |
| --- | --- |
| one coarse night, Node | ~2 ms |
| 366 nights, Node, no early exit | ~0.75 s |
| a typical site, Node (179 nights to both answers) | ~0.35 s of calculation, ~0.5 s including night building |
| the same walk again with a warm night cache | 179 hits, 0 misses, ~1 ms |
| 4×-throttled browser, 390 px viewport, cold | ~1.6 s, with the plan's own cards already on screen |
| the same page, warm | ~1–2 ms |

The search runs in its own worker (`overhead-celestial-worker.js`, request `kind: 'season'`), created on demand
when the category is opened and terminated when the answer arrives, so the plan's first paint never waits for
it. The finished result is cached per site, generation and threshold in a bounded session map, so revisiting
the category costs nothing and the block is identical. Nothing is fetched: no dataset, no forecast, no provider
call — the only requests are the engine module and the worker script, both same-origin.

### Integration with the observing tools

The season's nights enter the ordinary machinery, never a parallel one: `seasonCandidate()` builds the same
candidate shape a plan night gets, `overhead-opportunities.js` scores it, `overhead-discovery.js` maps it to a
discovery event with `precision: 'window'`, and `overhead-calendar.js` writes the same interval with the same
stable UID per night. So a window months out can be added to the calendar and to the observing plan from the
same buttons, with the weather caveat and the non-comparability note inside the file. The global planning
horizons are untouched: the ninety-day planner was not extended for any category.

### Known limitations

- The search stops at the first favourable night and never claims to have found the season's best night.
- No light pollution, transparency, terrain, land access or travel time enters the answer; a dark sky is a
  property of the place, and this release does not model places.
- Moon phase beyond the searched year is not modelled; the result is recomputed rather than extrapolated.
- The favourable bar is calibrated on mid-latitude reference sites. At tropical sites the season is effectively
  year-round and the bar is reached constantly, which is the honest answer there rather than a defect.
- Nothing here is a forecast, and the interface says so in the block, in each candidate's caveats and in every
  exported file.

## Where to go, for one region

Under the season block, **Where to go** offers the areas whose after-dark access a managing agency documents,
for the studied region of southern Indiana, southeastern Illinois and western Kentucky. It is deliberately
narrow:

- **Areas, not points.** Each record is a mapped management outline (USGS PAD-US) with an acreage, a manager and
  the agency's own quotation. No record is a trailhead, a gate or a parking place, and none is described as one.
- **Points are separate, and stricter.** Three facilities the Forest Service names and permits overnight use of
  (two campgrounds and the one parking lot it allows overnight parking at) are listed with their own coordinate
  provenance, quoted evidence, three-moment terrain clearance and their own Milky Way window, computed at the
  point. See [phase-6b3-observation-points.md](phase-6b3-observation-points.md).
- **Your window, not the area's.** The astronomical window shown is computed at your coordinates. No area has a
  verified observation point, so there is nothing to recalculate at and nothing is implied about any point
  inside an outline.
- **Terrain is context only.** The pilot's modelled bare-earth angles (0.0°–18.9° as the steepest direction at
  eleven sampled points) are regional context; a clearance angle needs a specific observation point, which this
  release does not have.
- **Distance is straight-line to the nearest mapped edge**, a management boundary rather than an entrance or a
  destination. There is no drive time, no routing and no ranking.
- **No darkness.** Local artificial sky brightness has not yet been assessed for these locations, and no area is
  described as dark.

Click **Show areas near me** to load it; the module and the 8 kB (gzipped) artifact are not fetched until then, and
nothing about the astronomy above waits for them. Outside the studied region the section explains the limit and
the Milky Way calculations continue worldwide. The full release notes, inclusion rules and regeneration steps are
in [phase-6b2-regional-site-explorer.md](phase-6b2-regional-site-explorer.md).

## Photography sessions

The category now answers a second question: not only *when*, but *when at a place, with what you need to carry*.
**Plan a photography session** opens a single panel under **Where to go** with six steps — When, Where,
Conditions, Before you leave, Prepare, Save or export. It is deliberately not a wizard: on a phone in the field,
the reader keeps the category and the session on one page.

The astronomy is unchanged and is never recalculated differently for a session. Each date is evaluated with
`analyseNight` at the selected site's own coordinates and timezone with the visitor's threshold, so the session
agrees with the plan above it. The date modes are tonight, the first favourable night and the season opening from
`analyseSeason`, and a custom date within the year. When no window exists the engine's own refusals are shown and
there is nothing to save; when a forecast cannot reach the date the plan says so instead of describing the sky.

A session adds five things the category did not have: the point's bare-earth terrain interpolated at that night's
actual core azimuth (with its uncertainty and the statement that it cannot see trees), a checklist and camera
starting points that say what they are and are not, **a destination forecast at the selected point's own
coordinates**, a pre-departure review with saved-versus-current access evidence, and a printable or downloadable
field plan with the quoted access evidence attached. Weather remains a separate forecast category: it never
enters the window quality, never fills the astronomy, and never turns into a claim about transparency, seeing or
the chance of a photograph. Nothing in it ranks a place, measures darkness or invents a drive. The full contract
is in [photography-sessions.md](photography-sessions.md).

## Inputs a future location recommendation would need

Nothing in this release recommends a place, only a time.
