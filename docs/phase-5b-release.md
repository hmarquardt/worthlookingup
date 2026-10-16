# Phase 5B: anchored historical ascent geometry

Phase 5A established that a general launch-visibility prediction is not supported by public data, and
left a pure geometry prototype with a five-level evidence taxonomy. Phase 5B turns that research into
the smallest production capability the evidence supports: **three validated historical Falcon profiles
that may show reconstruction geometry, a direction-only path for every flight that fails a check, a
launch-card line that states the direction of the launch pad and nothing more, and no new data services.**

The one question this release answers is narrower than "will I see it":

> For a **past** Falcon flight, which way did the ascent go from my location, how high was it while it
> was above my horizon, and what did the light look like — and how much of that can be checked?

It does not answer, and must never appear to answer, whether anything was or will be visible. Every
publication path carries that refusal in its own output, not only in this document.

## 1. What is published

`data/launches/trajectory-profiles.json` (schema `worthlookingup.trajectory-profiles/1`) holds the
reviewed profiles, the gate tolerances, the source and licence list, the rejected candidates and the
gate results. `docs/trajectory-profiles.md` is generated from the same objects, so the table cannot
drift from the data. Regenerate both with:

```
node scripts/build-trajectory-profiles.mjs            # writes the artifact and the provenance record
node scripts/build-trajectory-profiles.mjs --check    # fails if a fresh build differs from the commit
node scripts/build-trajectory-profiles.mjs --fresh    # ignores the local GCAT cache
```

Three profiles passed **both** anchoring gates and are published with elevation and a timed window:

| Profile | Flight | Pad | Direction (plane heading) | Terminal-state agreement |
| --- | --- | --- | --- | --- |
| `formosat-5-2017-049` | FormoSat-5, 2017-08-24 | Vandenberg SLC-4E | 190.1° southerly (mirror 349.9°) | 1.3 % speed, 4.6 km altitude |
| `paz-2018-020` | Paz, 2018-02-22 | Vandenberg SLC-4E | 189.1° southerly (mirror 350.9°) | 1.1 % speed, 1.7 km altitude |
| `grace-fo-2018-047` | GRACE-FO and Iridium NEXT 6, 2018-05-22 | Vandenberg SLC-4E | 178.8° southerly (mirror 1.2°) | 0.1 % speed, 2.5 km altitude |

Sources and licences: the ascent series is a public-domain webcast telemetry transcription
([shahar603/Telemetry-Data](https://github.com/shahar603/Telemetry-Data), Unlicense), reduced to
10-second samples; the launch instant, pad coordinates and the achieved orbit used as the anchor are from
J. McDowell's General Catalog of Artificial Space Objects (CC-BY-4.0). Both are recorded per profile.

**Eleven candidates were measured and rejected**, each with the numbers that failed it. The rejected list
is part of the published artifact, so a reader can see the gates at work rather than take the published
three on trust:

* **Terminal-state failure** — `iridium-next-4-2017-083` (−4.8 % speed, 429 km low),
  `iridium-next-1-2017-003` (−30 %, 535 km low), `falcon-heavy-demo-1-2018-017` (−18 % speed with the
  altitude right to 1 km), `jason-3-2016-002` (−5.2 %, 1104 km low).
* **The profile ends on the ground** (a booster landing or an incomplete series), so no insertion state
  exists to check — `iridium-next-8-2019-002`, `zuma-2018-001`, `saocom-1a-2018-076`.
* **The catalogued orbit is not an insertion state**, so neither the speed nor the plane can be checked
  against it — `spacex-crs-8-2016-024` and `spacex-crs-14-2018-032` (the station approach orbit),
  `gps-iii-sv01-2018-109` (direct-to-MEO insertion), `ses-11-2017-063` (a geostationary satellite's
  operational orbit, whose 0.03° plane cannot even be reached from Cape latitude).
* **The plane check disagreed with a published azimuth** — `saocom-1a-2018-076`: the SpaceX press-kit
  timeline gives a 199° first-leg azimuth, while the achieved 97.90° plane implies 105.5° at the pad
  latitude, a 7.6° discrepancy (9.4° in heading terms). The ascent yaw-steered, so the pad azimuth and
  the orbital plane are not the same thing, and the profile is direction-only.

No candidate was rejected for a visual reason, and no rejected candidate was rescued because its
reconstructed line matched a photograph.

## 2. The two gates

Both gates live in `src/launches/launch-trajectory.mjs`, are called by the generator and by the browser,
and are enforced again at read time. A profile that fails either is downgraded, and the failure cannot be
overridden downstream.

**Gate A — orbital-plane consistency.** `cos i = cos(lat) · sin(A)` relates a fixed-azimuth ascent's
azimuth to the inclination of the plane it reaches, within the documented tolerance of 3°. Phase 5B adds
the part Phase 5A lacked: the check is only meaningful when the azimuth comes from somewhere other than
the inclination it is checked against. `planeAzimuths()` computes both headings of a plane (the northerly
and southerly branches of the same great circle — the inclination alone does not say which one a mission
flew), records the mirror heading, and the validation block marks the check **not applicable** — not
"passed" — whenever the azimuth was derived from that same inclination. The neglected corrections
(Earth rotation, yaw steering, doglegs) are carried in the output, and a 0.03° plane from Cape latitude
returns *no heading at all*, because that plane does not reach that latitude.

**Gate B — terminal-state consistency.** The reconstruction's final sample is compared with the
catalogued orbit through vis-viva at the **reconstructed geocentric radius**, not at perigee: an object
at 182 km cannot be moving at a speed that belongs at 620 km, and comparing at perigee hid that. Two
independent tolerances apply — 3 % in speed and 25 km in altitude, measured against the nearer apsis —
and either one failing rejects the profile. Applicability is checked first, because comparing against the
wrong orbit is worse than not comparing: the anchor must declare itself an insertion state, the last
sample must be an insertion-phase sample, and a series that ends on the ground is refused outright.

**Why 3 % and 25 km.** They are not a published error budget, because neither source publishes one for
this purpose. They sit inside a *measured* gap: the three published profiles agree with their anchors to
within 1.3 % and 4.6 km, while every candidate that fails fails by at least 4.8 % in speed or 429 km in
altitude. The two tolerances are independent, and the Falcon Heavy demonstration is the case that shows
it: it passes on altitude at 1 km and fails on speed at 18 %. Both numbers are recorded in the artifact
(`gate_tolerances`) and in the module, and the tests recompute them from the profiles rather than
trusting the record.

## 3. Output permissions

`publicationPermissions()` is the single place where the taxonomy, the two gates and what may be shown
meet. It returns `{direction, elevation, timedWindow, illumination, downgraded, reasons}`; the artifact
stores it, `validateValidationBlock()` rejects any artifact whose stated permissions disagree with its own
gate results, and `assess()` / `exploreHistorical()` honour it.

* **Anchored profile** — direction, reconstructed elevation with time, and illumination.
* **Direction-only profile** (any gate failed) — the heading or sector with its uncertainty, its source
  and its alternate branch. The reconstruction's own altitude and downrange series is *not walked*, so no
  bearing-versus-time, no elevation and no timed window is derived from it, because that series is exactly
  what failed the check. The observer's own twilight at liftoff is still stated, since it needs no vehicle
  position.
* **Pad-only evidence** — the pad's direction and distance, and nothing about the ascent.

Nothing in any path computes brightness, plume size, apparent size, a probability of sighting or an
optical visibility statement, and the tests scan every returned object's keys for one.



## 4. User-facing presentation

**The historical ascent explorer** (`overhead-launch-explorer.js`, opened from the launch calendar via
*Historical Falcon ascents* or a card's own link) is the only product-facing module of this work. It
performs no geometry of its own: it dynamic-imports the staged geometry module, fetches the reviewed
profiles, validates the artifact, calls `exploreHistorical()` and renders the object that comes back.
Both files are loaded **only** when the panel is opened; nothing on the initial page load references
them, and the mitigation for a page that cannot load them (`file://`, a missing asset) is to say so and
show nothing rather than something unchecked. The panel shows the mission and pad, the direction sector
as a compass diagram, an elevation-against-time chart with a time-step table (the table is both the
screen-reader alternative and the phone-sized view), the twilight and reconstructed sunlight context, both
gate results with their numbers, the provenance and licence links, the reconstruction's limits, and what
it cannot tell you. Every entry is labelled a reconstruction of a past flight.

**The launch card** gains one line for upcoming flights: `Launch pad direction <compass> (<deg>) at
<km>, <deg> above your horizon — the pad's direction, not the rocket's path.` It is time-independent, so
a date-only launch keeps it and still says that twilight timing cannot be assessed. When a pad has a
published profile the card offers a link into the historical panel, clearly labelled as historical. No
profile is ever attached to an upcoming launch by vehicle family or launch site, and no reconstruction's
elevation or window is shown as a prediction.

## 5. Scientific limitations

* The reconstructions are transcriptions of webcast telemetry graphics, not operator telemetry. Their
  absolute values are not guaranteed, which is precisely why the terminal gate exists.
* The published direction is the **orbital-plane heading at the pad latitude**, derived from the achieved
  inclination. A yaw-steering or dogleg ascent can leave the pad on a different heading, so the azimuth
  uncertainty is 6° and the mirror branch is always shown.
* The ground track is a fixed-azimuth great-circle approximation of the flown downrange, so cross-track
  error grows with distance.
* Three profiles, one pad, one vehicle family. That is the whole catalog and it is deliberate: the gates
  selected it. A launch that carried two payload groups to two orbits (GRACE-FO with Iridium NEXT 6) is
  published with that caveat, because the series ends at the first insertion.
* The observer's own horizon, optics, cloud and local obstruction remain unknown; a geometric horizon
  crossing is not a sighting.
* No non-Falcon vehicle is published, and no hazard polygon, corridor or assumed azimuth was used to build
  a trajectory.

## 6. Expanding the catalog

A new historical profile may be added when all of the following hold, and it must clear both gates
unchanged:

1. A public-domain or compatibly licensed ascent series exists, with a documented method.
2. An independently catalogued achieved orbit exists **for the state the launcher's last burn produced**.
   A geostationary satellite, a station cargo run and a direct-to-MEO insertion do not qualify as they
   stand.
3. The pad's coordinates and the launch instant, with its precision, come from a cited source.
4. Both gates pass — or the profile is published as direction-only with the failure recorded.

Candidates that would usefully broaden the catalog, in order: a Cape Canaveral LEO mission whose insertion
orbit is catalogued directly (CRS flights currently fail because the catalogued orbit is the station
approach orbit, and their jettisoned payload-cover pieces are a possible future anchor); a Starlink-era
deployment profile, which needs a public-domain series; and Iridium NEXT flights, which stay
direction-only until their series' altitude disagreement is explained rather than tolerated.

## 7. Still missing for trajectory-aware forecasting

Nothing in this release forecasts anything, and the prerequisites have not changed:

* A published ascent profile for the *specific* upcoming flight, not a reconstruction of a sibling
  launch. 14 CFR 420 Appendix B requires exactly that from licensed US operators and publishes only the
  method, so the data exists and is unobtainable.
* A reliable way to know which trajectory profile a scheduled flight will fly before it lifts off.
* Vehicle- and observation-specific optical data for any brightness or plume statement. Flight geometry
  alone cannot produce one, and this release does not pretend otherwise.

Until the first two exist, the honest product is what shipped: the direction of the pad and the local
twilight at a published time, a validated reconstruction for a handful of past flights, and
`visibility: 'unknown'` standing in every card.
