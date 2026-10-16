# Launch trajectory feasibility — what we can actually know before showing anything

Phase 5A research and prototype. Status: **research only**. Nothing in this document is wired into the
product, no user-facing visibility prediction exists after this phase, and the production launch
calendar still reports local visibility as unknown.

The question this phase answers is deliberately narrower than "can we predict launch visibility". It is:
what trajectory evidence exists, how good is it, what geometry can be computed honestly from it, and
what must stay unknown until better data arrives.

**Short answer.** Time-resolved ascent trajectories are not published for any current vehicle. The FAA
requires a one-second nominal trajectory from every licensed operator and publishes only the method for
using it. What can be obtained is a family of partial reconstructions: a public-domain, one-second,
altitude-and-downrange transcription of webcast telemetry for about sixty Falcon flights from 2016 to
2019, achieved orbital elements for essentially every launch, published mission timelines with a handful
of event times and altitudes, and unrestricted access to surface hazard areas. That is enough to compute
observer bearing, elevation and solar-illumination geometry for a named past Falcon flight to a few
degrees, and enough to say honestly what remains unknown. It is not enough for a general
"visible from your location" feature, and this phase recommends against building one.

## 1. What the product does today

The launch calendar is a schedule, not a visibility model, and that is deliberate:

* `src/launches/launch-feed.mjs` owns provider access, normalization, scheduling precision, status
  interpretation and the cache policy. It carries no trajectory assumption.
* `overhead-launches.js` presents those schedules. `relevanceFor` hard-codes `visibility: 'unknown'`, and
  its own explanatory text says why: confirming a visible rocket or an illuminated exhaust plume needs the
  ascent trajectory, staging, sunlight and shadow geometry, which that source does not provide.
* `src/launches/launch-visibility.md` already listed the inputs a future engine would need — powered
  ascent trajectory, launch azimuth, staging timeline, plume dimensions, observer position, sunlight and
  shadow geometry, weather, twilight, timing precision — together with its non-goals: no trajectory
  invented from a pad position and an assumed azimuth, no plume brightness without published vehicle
  data, no probability before geometry, illumination and weather are all known.

This phase supplies the first four items on that list, measures how good they really are, and builds the
geometry. It changes none of the non-goals, and it does not touch the calendar.

## 2. Sources and what they can support

Fifteen sources were examined across the requested categories; the full inventory, with platform
specifics and licensing, is in [launch-trajectory-sources.md](launch-trajectory-sources.md) and
`src/launches/trajectory-sources.json`. The findings that decide the rest of this document:

**The regulation proves the data exists and then keeps it.** 14 CFR part 420, Appendix B, tells an
applicant how to construct a flight corridor from "a launch vehicle trajectory": state vectors as a
function of time after liftoff, in a launch-point-centred frame with the X axis along the flight azimuth,
at intervals "not greater than one second", together with mass, thrust and specific impulse against time,
stage dimensions, stage burn and drop-off times, atmosphere and wind profiles. It also lists what a
commercial trajectory generator must model. The trajectory itself is the applicant's and is not part of
the published record. The regulatory framework therefore confirms that one-second ascent trajectories
exist for every licensed US launch and simultaneously confirms that they are not obtainable.

**A corridor is not a path.** FAA hazard areas are accessible — the TFR service answers an
unauthenticated OGC WFS `GetFeature` request with GeoJSON, including a polygon, a NOTAM key and a legal
category — and they are still not trajectories. Appendix B builds a corridor out of assumed debris
impacts under a fixed ballistic coefficient, meteorological statistics and guidance dispersions. It bounds
where debris may land; it says nothing about where the vehicle was at a given instant or how high it was.
NOTAMs and Coast Guard or NAVAREA warnings are the same kind of statement in a worse format: prose and
diagrams, sometimes behind registration.

**The best public time series is a webcast transcription, and it is not self-validating.** The
`webcast-telemetry-archive` source publishes, into the public domain, one-second altitude, speed,
downrange and event times for about sixty Falcon 9 and Falcon Heavy flights, mostly 2016 to 2019, with
nothing for Starship and nothing recent. It carries no ground position, so it supplies a profile shape
and a timeline rather than a trajectory; section 5 measures its absolute values against achieved orbits
and finds them inconsistent, in opposite directions for different flights.

**Anchors are plentiful and are the other half of the answer.** GCAT (CC-BY-4.0) publishes pad
coordinates, launch instants and achieved orbital elements for essentially every launch, and CelesTrak
already supplies the project's element sets. Those fix the plane, the insertion state and the departure
point, which is exactly what a reconstruction needs in order to be checked rather than trusted.

**Nothing is available for Starship.** No time-resolved ascent data, public telemetry or independent
reconstruction was found for any Starship flight, and the official timeline is a script-rendered page.
Falcon Heavy appears only through the 2018 demonstration flight inside the same webcast archive.

**Commercial options are capable and closed.** Flight Club publishes reconstructed trajectories behind an
OpenAPI-documented interface and sells commercial licences shaped by volume, redistribution and branding;
its method and error budget are not published. RocketPy and similar simulators are MIT-licensed engines,
but feeding one a Falcon 9 or Starship would require exactly the operator-supplied mass, thrust, specific
impulse, stage and aerodynamic data that Appendix B lists and nobody publishes. A simulation run without
that data would produce an invented trajectory carrying a simulation's authority.


## 3. Evidence taxonomy

Five levels, defined once in `EVIDENCE_LEVELS` in `src/launches/launch-trajectory.mjs` and enforced by
`validateProfile` and `assess`. Each level states what it is, which provenance kinds can support it, the
shortest time step at which it supports a positional statement, and — the part that matters — which
outputs it permits and which it forbids. The tests assert those lists, so a later phase cannot widen them
by accident.

| Level | Evidence | Time-resolved? | Permits | Forbids |
| --- | --- | --- | --- | --- |
| 1 | Verified flight telemetry or a verified trajectory, documented frame | at the source sampling | slant range, bearing, elevation, horizon clearance, timing, illumination geometry | brightness, apparent plume size, probability of being seen, detectability |
| 2 | Credible mission-specific reconstruction with a recorded method and tolerance | 10 s or coarser | approximate range, bearing, elevation, horizon clearance, timing within the tolerance, illumination geometry | second-scale position, vehicle attitude, plume size, brightness, probability, detectability |
| 3 | Documented mission profile: published event times and altitudes | 60 s, and only at events | ascent direction as a sector, elevation range, published event times, illumination at those events | position between events, continuous bearing, horizon clearance between events, plume size, brightness, probability, detectability |
| 4 | Broad geographic corridor, hazard area, NOTAM or maritime warning | no | the directional sector containing the ascent, launch-window timing | elevation, time-resolved position, horizon clearance, vehicle illumination, visibility, brightness, probability |
| 5 | Launch-pad location and time only — today's production calendar | no | the pad bearing and the sky sector around the pad | anything about the vehicle after liftoff, elevation, illumination, visibility, brightness, probability |

Three rules make the taxonomy do work rather than decorate:

1. **Uncertainty is graded per claim, never merged.** Every assessment carries three separate confidence
   statements — schedule, geometry and observation — in words, with their inputs listed. There is no
   combined percentage anywhere in the module, and `FORBIDDEN_CLAIMS` names the words (`probability`,
   `brightness`, `magnitude`, `likelihood`, `detectability`, and friends) that may not appear as a datum
   in a profile or as an output key. The tests scan every assessment for them recursively.
2. **A profile that cannot say where it came from is rejected.** Level, code, provenance kind, source,
   source URL for anything time-resolved, retrieval time, retrieval licence, an azimuth with an
   uncertainty and a named source, strictly increasing samples, declared gaps that samples may not
   occupy, declared disagreements with at least two named sources, and a sampling interval no finer than
   the level supports. Any failure refuses the whole profile instead of degrading silently.
3. **The weakest link sets the geometry grade.** For the reconstructions here, the *profile* is level 2
   while the *azimuth* is derived from an achieved orbit rather than documented, so the assessment
   reports the derivation rather than a measured value and the plane-consistency check decides whether
   the two can be reconciled.

Contradictions are carried, not averaged. A profile declares each disagreement with the competing values,
their sources and whether it is resolved; the assessment repeats anything unresolved in its refusals. The
two historical flights in this phase exhibit exactly that: the SAOCOM 1A press azimuth and its achieved
inclination disagree by 9.4°, and the reconstruction's terminal state agrees with the achieved orbit in
one dimension and disagrees in the other — in opposite directions for the two flights.


## 4. The geometry prototype

`src/launches/launch-trajectory.mjs` is a pure module: no DOM, no storage, no network, no import of the
schedule engine, no ephemeris of its own. Nothing in the product loads it, and a test asserts that.
Roughly 850 lines including the taxonomy.

**What it computes.** WGS-84 geodetic to Earth-fixed conversion and back; a local east/north/up frame at
any observer; the bearing, elevation, slant range and horizon clearance from that observer to any
Earth-fixed point *or moving vehicle*; great-circle downrange, destination and reciprocal range; the
launch-plane relation between pad azimuth and orbital inclination; the Earth-shadow state (sunlit,
penumbra, umbra) of any point using the conical shadow of a spherical Earth; local solar elevation and
twilight band; interpolation of a profile with refusals at the ends and inside gaps; and an
evidence-gated assessment that decides what may be said.

**Keep this separate from satellite scoring.** Nothing here feeds the satellite or celestial engines, and
nothing here can reach a score. The geometry is also kept separate from optical detectability: it answers
"is it above your horizon, in which direction, how high, and is it sunlit" and refuses to answer "would
you see it".

**The method, and why it is trustworthy.** Positions are Earth-fixed vectors and the observer's line of
sight is the actual vector difference, so Earth curvature, horizon dip and long-range geometry need no
special cases and no approximations. The solar direction is the only thing imported: the caller injects
the Sun's geocentric right ascension and declination and the sidereal time from the pinned astronomy
layer, and the module converts those into an Earth-fixed unit vector in one line of trigonometry. That
keeps the ephemeris in one place (the existing pinned library) and makes the bridge testable.

**Measured against independent references.** The prototype's WGS-84 positions agree with Astronomy
Engine's own observer vectors to **0.42 m**; its Earth-fixed solar elevation agrees with the astronomy
layer's topocentric solar altitude to **0.14°**; its shadow edge sits **0.270°** from the closed-form dip
angle (`acos(R/(R+h))`) at 100 to 400 km; its horizon crossing matches the closed-form arc distance to
**0.06 %**; and at 600 km downrange and 250 km altitude the flat-earth tangent formula is **3.13°**
steeper than the true sight line, which is why curvature cannot be ignored at these ranges.

**Known limitations, stated rather than hidden.**

* *The ground track is an approximation.* A profile gives altitude and downrange, and the prototype lays
  the downrange off along the pad azimuth as a great circle. Real ascents yaw-steer, so cross-track
  position degrades with downrange. The module quantifies the disagreement rather than hiding it: the
  pad azimuth and the achieved inclination are checked against each other and a failure is stated in
  the refusals.
* *The shadow model is conical and spherical.* It ignores the refraction of grazing sunlight (about half
  a degree, which extends sunlit conditions slightly), the Earth's oblateness inside the shadow cone and
  any cloud. The geometric limb itself is sharp: the penumbral band is only **10.8 km** at 100 km
  altitude, **15.3 km** at 200 km and **21.6 km** at 400 km wide, so the honest uncertainty is
  atmospheric, not geometric.
* *No brightness, no plume, no detectability.* The module has no vehicle dimensions, no plume model, no
  photometry and no weather, so it cannot say how large or how bright anything appears, and it refuses to
  try. Twilight conditions are reported as facts about the observer and the vehicle, never combined into
  a chance of seeing anything.
* *Elevation is geometric.* No refraction correction is applied to the line of sight to the vehicle,
  which matters within about a degree of the horizon; the tests therefore treat near-horizon elevation
  claims as coarse by construction.
* *A library trap worth recording.* Astronomy Engine's horizon conversions (`Horizon`, `HorizonFromVector`,
  `Rotation_EQD_HOR`) are built for celestial directions at effectively infinite distance. Applied to a
  vehicle a few hundred kilometres away they give the geocentric direction instead of the topocentric one
  and can be off by tens of degrees. This phase's `look()` subtracts the observer's position, which is the
  correct topocentric construction, and its result was verified against closed-form cases rather than
  against that library path.


## 5. Historical validation

Three flights, chosen to span the requested cases. Ground truth is separated from inference throughout,
and the error magnitudes are reported numerically where the source supports it. No photograph with an
unknown location or orientation was treated as a measurement.

### 5.1 SAOCOM 1A, 2018-10-07 19:21 PDT (Vandenberg SLC-4E, twilight, first-stage return to land)

The strongest case available, because a 122-page independent review draft (Oberg, December 2018,
explicitly a draft) states an observer position with coordinates and a video-derived bearing, and the
press-kit timeline is reproduced inside it with event times and altitudes.

| Quantity | Documented | Computed by the prototype | Difference |
| --- | --- | --- | --- |
| Sight-line azimuth from Encino, 34°10'17" N 118°30'41" W | 270°, from video geometry compared with a street view | above-horizon sweep 268.5° to 285.3° | the documented value falls inside the sweep |
| Range to the launch site from Encino | "120 miles" | 199.7 km (120 statute miles is 193.1 km; 120 nautical miles is 222.2 km) | 3.2 % if statute, 10.3 % if nautical |
| Observer solar elevation at liftoff | twilight, plume "backlit by the setting Sun" | −11.5°, nautical twilight | consistent |
| Vehicle illumination | plume visible after staging | sunlit (whole solar disk) from T+170 s to T+290 s, entirely while the observer is past civil twilight | the twilight-plume condition, reproduced |
| MECO time | T+140 s in the press kit | T+142 s in the reconstruction | 2 s |
| MECO altitude | 86 km in the press kit | 71.1 km in the reconstruction | −17.3 % |

Two lessons, both quantified. First, a naive "look toward the launch site" answer is wrong: the pad
bearing from Encino is 285.4°, **15.4°** away from the documented sight line, because the plume is not
the pad. Second, the altitude disagreement is not cosmetic: scaling the reconstruction's altitudes across the
press-kit/reconstruction disagreement moves the computed elevation at MECO across a band of **4.92°** —
about ±2.5° around its nominal value — so an honest elevation claim for this observer carries that band
rather than a single figure. The prototype
reports the disagreement as an unresolved contradiction instead of choosing a favourite.

As a level-3 exercise, the published timeline alone (event times and altitudes, no downrange) yields an
elevation range at MECO from −0.3° to 22.2° for the same observer, with the azimuth bounded only to
211°-285°, and its illumination is *not* invariant: across the geometrically possible downranges the
vehicle at 86 km could be in umbra, in penumbra or in sunlight. At SECO, 625 km up, the illumination *is*
invariant — sunlit everywhere the downrange could be — which is exactly the kind of bounded statement
level 3 can support.

### 5.2 Iridium NEXT 4, 2017-12-22 17:27 PST (Vandenberg SLC-4E, twilight, seen across southern California)

The published evidence is a NASA Astronomy Picture of the Day photograph taken from Orange County in a
2.5 s exposure, described as backlit by the setting Sun with the first-stage plume on the right and the
upper stage at the apex of the plume toward the left. It states no bearing and no range, so this case is
treated as **qualitative only** and no comparison is claimed. What the prototype says, for what it is
worth: from an Orange County centroid the ascent sweeps 187.7° to 292.2° of azimuth, reaching 27.0°
elevation, with the observer at −8.5° solar elevation (nautical twilight) and the second stage sunlit from
T+140 s. That is consistent with a plume observed to the west and extending southward, and it is not a
measurement of the photograph.

### 5.3 Falcon Heavy demonstration flight, 2018-02-06 15:45 EST (Cape Canaveral LC-39A, daylight)

The deliberately unfavourable lighting case: the geometry is firm and the sky is bright. From Orlando the
ascent holds 84.0° to 84.5° of azimuth — a 0.5° sweep, essentially a fixed bearing — is above the horizon
from T+20 s to T+490 s, and peaks at 21.3° elevation, while the observer's solar elevation is +27.1°,
which is daylight. The vehicle is sunlit throughout. The honest output is therefore: geometry known,
lighting known, and *whether anything can be seen remains unknown*, because a bright sky and no
photometry is a detectability question this data cannot answer. No documented bearing was found for this
flight, so no quantitative comparison is claimed here either.

### 5.4 The finding that decides Phase 5B

Every reconstruction was anchored against the achieved orbit from GCAT, using vis-viva as the independent
analytical reference for the speed that orbit requires.

| Flight | Reconstruction ends at | Orbit requires | Error |
| --- | --- | --- | --- |
| Iridium NEXT 4 | 181.8 km at 7651 m/s | 610 × 626 km, insertion 7557 m/s | speed +94 m/s (1.2 %), altitude −428 km |
| Falcon Heavy Demo 1 | 178.7 km at 7390 m/s | 180 × 6939 km, perigee speed 9025 m/s | altitude −1 km, speed −1635 m/s (18 %) |

Each reconstruction agrees with its achieved orbit in one dimension and disagrees in the other, and the
two disagree in opposite directions. The webcast transcription is therefore useful for *shape and timing*
— event times match the published timeline within 2 s — and cannot be trusted for absolute altitude or
speed without an external anchor. Since observer elevation is a direct function of vehicle altitude, any
feature built on an unanchored reconstruction inherits a several-degree error that no amount of geometric
care can remove.


## 6. Architecture

The boundary is designed so that this work can be added later without a rewrite and without new
infrastructure. It is deliberately **not** wired up now.

**Keep schedules and trajectories apart.** `data/launches/upcoming.json` stays a schedule feed with the
same schema, and nothing about it changes. A trajectory belongs in its own artifact, one record per
flight, with its own schema, provenance and licence — the shape already used by
`tests/fixtures/launches/trajectory-profiles.json`:

```
{ schema: "worthlookingup.trajectory-profile/1", id, mission, vehicle, stage,
  evidence: { level, code, provenanceKind, source, sourceUrl, licence, retrievedUtc, method },
  launch: { utc, precision, source },
  site:   { pad, latDeg, lonDeg, source },
  azimuth:{ deg, kind, uncertaintyDeg, source },
  plane:  { achievedInclinationDeg, source },
  orbit:  { perigeeKm, apogeeKm, inclinationDeg, source },
  samplingS, samples[], events[], gaps[], disagreements[], limits[] }
```

**How a launch record links to a profile.** The schedule already carries the keys needed to choose a
profile family: `vehicle` and `vehicle_family`, `pad` coordinates, `site`, `orbit`, and `precision` for
how well the launch time is known. A profile is selected by mission identity when one exists and by
vehicle family plus pad plus target orbit when it does not — and in the second case the profile is a
*vehicle-class* profile, which is evidence level 3 at best and must be labelled as such, never as this
flight's trajectory.

**Retaining provenance and uncertainty.** Every derived statement travels with its origin: profile id and
evidence level, source and licence, reconstruction tolerance, declared disagreements, and whether the
plane check passed. A presentation layer receives those as data rather than as prose it must remember.
The rule this phase would carry into production: *a profile whose values have not been anchored to an
achieved orbit may not produce an elevation number*, only a direction and a sector.

**Reuse rather than reinvent.** Geodetic and local-frame geometry lives in `launch-trajectory.mjs`; solar
position, sidereal time and twilight thresholds stay in `overhead-astro.js` and its `RULES.twilight`;
observer sites, timezones and launch cards stay where they are. The prototype takes solar geometry as an
injected function precisely so the ephemeris keeps one home.

**No new infrastructure.** A whole ascent is about 55 samples at 10 s spacing, so a profile can be a
static JSON artifact shipped with the site and fetched on demand like the schedule feed — no service, no
database, no new worker. The existing refresh job already publishes one artifact atomically; a trajectory
artifact would follow the same validated-publish path, generated by a script like
`scripts/build-trajectory-fixtures.mjs` and never hand-edited.

**What a later, visible improvement could look like.** Not a visibility promise: a sentence such as
"ascent heads 176° (S) from SLC-4E; on the closest reconstruction the vehicle passes 12° above your horizon
between T+2 and T+5 minutes, and your sky is already in nautical twilight while the second stage is
sunlit", with the evidence level and the tolerance attached and `visibility: unknown` still standing next
to it. That shape is supported today for a handful of past Falcon flights, and nothing more may be claimed
until a profile can be anchored flight by flight.


## 7. Tests

`node tests/launches-trajectory.cjs`, also run by `npm test`. It is a real behaviour suite: every
mathematical claim is compared with a closed-form analytical case or with the independent implementation
pinned in `vendor/`, and the worst measured differences are printed rather than hidden behind loose
bounds. Fixtures are fixed records: synthetic profiles are declared synthetic, the reconstructions are
generated by `scripts/build-trajectory-fixtures.mjs` and committed, and the cited observations, anchors
and contradictions are copied once into `tests/fixtures/launches/trajectory-cases.json`.

| Area | What is asserted |
| --- | --- |
| Geodetic conversion | round trips to a millimetre; agreement with Astronomy Engine's observer vectors to 2 m |
| Bearing and elevation | axis-aligned exact cases, the half-central-angle rule for co-altitude points, a moving vehicle's elevation as the angle above the local horizontal |
| Below-horizon objects | antipodal and quarter-way-round points, negative elevations, `aboveHorizon` false |
| Earth curvature | flat tangent against the true sight line at 600 km, horizon crossing against the closed-form arc, the 14.17° dip at 200 km |
| Longitude wrapping | antimeridian destination, two spellings of one place, a continuous bearing across the line |
| UTC timestamps | sample times as launch plus offset, two spellings of a DST-transition instant giving one answer, refusal of an offset-less instant |
| Moving rocket positions | exact samples reproduced, midpoints as means, monotone climb and range, bounded bearing and elevation steps |
| Solar illumination | shadow edge at the dip angle, the narrow penumbral band, a sunlit object at 200 km while the ground is in nautical twilight, agreement with the library to 0.3° |
| Missing segments | refusals inside a gap, before the first and after the last sample, and for an events-only profile |
| Contradictory sources | unresolved disagreements surfaced with both sources named; twelve malformed profiles rejected |
| Evidence caps | permitted and blocked outputs per level, corridor and pad-only refusals, the synthetic-presentation guard, no forbidden claim anywhere in an assessment |
| Historical validation | documented sight line inside the predicted sweep, the pad bearing measurably wrong, the range check, the twilight-plume window, event times within 2 s, the altitude disagreement turned into an elevation band, orbit anchoring by vis-viva |
| Product protection | the prototype stays network-, DOM- and storage-free and unreferenced by `index.html` and the worker; the published feed carries no trajectory or visibility field; the calendar module still reports `visibility:'unknown'` |


## 8. Recommended Phase 5B scope

**Do not build a general visibility feature.** The data does not support it, and the failure mode is not
an error message — it is a person driving to a hillside for a promise we could not keep. What the data
does support is narrower, genuinely useful, and honest.

**Phase 5B: anchored ascent direction and illumination context for Falcon missions we can check.**

1. **Turn the fixture builder into a profile generator with an anchoring gate.** For each candidate flight,
   derive the launch azimuth from the achieved orbital inclination and the pad latitude, fetch or transcribe
   the ascent profile, then require two independent checks before the profile may be published: the plane
   consistency check (`cos i = cos φ sin A`, tolerance 3°) and a terminal-state check against the achieved
   orbit by vis-viva. A profile that fails either check is published as *direction-only* and can never
   produce an elevation.
2. **Publish one static artifact** per flight, in the schema in section 6, generated by a script and
   validated before publication like the schedule feed. No new service, worker or storage.
3. **Show two facts on the launch card, and nothing else:** the ascent direction as a sector with its
   source and uncertainty ("ascent heading 176° (S), derived from the achieved orbit"), and the illumination
   context for the observer's saved site ("your sky: nautical twilight; vehicle above your horizon T+2 to
   T+5 min"). Elevation appears only for profiles that passed both anchoring checks, carries its tolerance,
   and is labelled as a reconstruction rather than this flight's telemetry.
4. **Keep `visibility: unknown` standing** in the same card, with the reasons from
   `overhead-launches.js` unchanged. The new lines explain when and where to look, not whether you will
   see anything.
5. **Add a review job, not new infrastructure:** a monthly task that lists published profiles whose anchor
   has drifted (new element sets, revised orbits) and demotes them to direction-only.

**Explicitly out of scope for 5B:** Starship and every non-Falcon vehicle; plume brightness, apparent size
or any probability; streak-photography planning; any statement that a launch is or is not visible; and any
profile built from a pad position plus an assumed azimuth, however plausible the assumption looks.

**Why this is the right size.** The engineering is small — one generator script, one artifact schema that
already exists, one card field, one test file — and the bottleneck is data acquisition, not code. The
capability degrades gracefully: with an anchored profile the card can give a direction, a window and a
tolerance; without one it gives the pad direction and says so. Nothing in it can show a number the
evidence does not support.


## 9. The eight answers

**1. Can we obtain actual or reconstructed ascent trajectories reliably?**
Actual ones, no: no operator, range authority or regulator publishes a time-resolved ascent trajectory,
and 14 CFR part 420 Appendix B shows the FAA collects a one-second nominal trajectory from every licensed
launch without publishing it. Reconstructed ones, in part: a public-domain one-second transcription of
webcast telemetry exists for about sixty Falcon flights from 2016 to 2019, and achieved orbital elements
exist for essentially every launch. Reliability is the problem, not availability — each reconstruction
agrees with its achieved orbit in one dimension and disagrees in the other, so a reconstruction is usable
only after anchoring, and never as absolute truth.

**2. Which missions or launch sites are realistically supportable?**
Falcon 9 and Falcon Heavy from Cape Canaveral and Vandenberg, for flights whose profile can be anchored
and whose azimuth can be derived or documented: a level-2 capability with a stated tolerance. Starship is
not supportable at all today — no time-resolved data, no public telemetry, no reconstruction. Any vehicle
without a usable reconstruction falls back to a direction and a sector, which is level 3 or 4 by
construction.

**3. What can be computed confidently today?**
Geometry, and it is solid: observer bearing and elevation to a known Earth-fixed position, Earth
curvature and horizon clearance, slant range, great-circle downrange, and the Earth-shadow state of
anything whose position is known — the prototype agrees with independent references to 0.42 m in
position, 0.14° in solar elevation, 0.27° at the shadow edge and 0.06 % at the horizon. Also firmly
known: the direction along which an ascent must run for a given pad and target inclination, the time of
day, and the observer's twilight state. For a *named, anchored* Falcon flight, bearing, elevation and the
twilight-illumination window are computable to within a few degrees and a few seconds.

**4. What must remain unknown?**
Whether anyone can see it. Brightness, apparent plume size, and any probability: no published photometry,
plume model or vehicle-emission data exists, and the object is a self-luminous expanding volume rather
than a point source. Also unknown: the vehicle's along-track position to better than a reconstruction
tolerance, its attitude, the ground position between published events at level 3, weather and local
obstruction, and everything about non-Falcon vehicles. The prototype encodes these as explicit refusals,
not as quiet omissions.

**5. Are public hazard areas useful as constraints without pretending they are flight paths?**
Yes, and they should be used exactly that way. The TFR service is unauthenticated, machine-readable and
authoritative for surface areas; a corridor bounds where debris may fall under failure assumptions. It is
useful for identifying that a launch is happening and roughly which sector it crosses, and useless for
elevation, timing or illumination — which is what level 4 in the taxonomy means. It must never be
interpolated into a track.

**6. How much engineering is needed for a credible first production feature?**
Small, if the feature is the narrow one in section 8: a profile generator with an anchoring gate, a static
artifact that reuses the existing validated-publish path, one new line on the launch card carrying its
evidence level and tolerance, and tests. Weeks, not quarters, and no new infrastructure. The larger cost
is not code: it is the per-flight data work of anchoring profiles and keeping derivations honest, which
is why the recommended scope deliberately caps what is shown rather than how much is built.

**7. What data licensing issues could affect commercialization?**
Operator material (press kits, webcasts, mission pages) is copyrighted with no open licence, may be cited
and measured against but not redistributed, and its URLs are unstable — the SAOCOM 1A press kit now exists
only in the Internet Archive. Commercial reconstruction services require a negotiated licence for any
commercial use including redistribution, and their error budgets are unpublished. The usable layer is
public-domain or openly licensed: the webcast telemetry archive (Unlicense), GCAT (CC-BY-4.0 with
attribution), CelesTrak and US government sources. Any commercial feature must therefore be built on
openly licensed data with attribution, must not republish operator documents or images, and must respect
the terms that already travel with the schedule feed.

**8. What is the smallest scientifically defensible next release?**
Exactly the Phase 5B scope in section 8: for Falcon missions whose ascent profile passes both the plane
consistency and terminal-state anchoring checks, show the ascent direction as a sector with its source and
uncertainty, and show the observer's own twilight state with the vehicle's illumination window; show an
elevation only when the profile is anchored, always with its tolerance; and keep `visibility: unknown`
standing beside it. That release tells a person which way to look and when, states honestly what it does
not know, and cannot be wrong about brightness, probability or visibility because it never mentions them.

### What this phase did not do

No user-facing rocket visibility prediction was activated. The production launch calendar is unchanged:
the feed schema is unchanged, no trajectory or visibility field was added, and `overhead-launches.js`
still reports local visibility as unknown. The prototype is not loaded by `index.html`, by the Pages
worker or by any product module, and a test enforces all of that.

