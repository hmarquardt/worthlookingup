# Launch visibility and plume prediction — design for a later phase

This is a design document, not an implementation. Phase 1 publishes schedules and states honestly that
local visibility is unknown. This file records what a trajectory-aware visibility engine would need, so
a later phase can be built without inventing precision now.

## Why launch visibility is not satellite visibility

A satellite pass is solved by propagation of published elements and one geometric question: is the
spacecraft sunlit while the observer's sky is dark? A rocket launch is different in three ways:

1. The object is under power for the first few minutes, so its position comes from a flight profile,
   not from an orbit.
2. The interesting phenomenon is often the **exhaust plume**, which is a large, self-luminous,
   expanding volume, not a point source.
3. Everything happens within minutes of the launch time, so a few seconds of timing error can move the
   vehicle out of the observer's field of view.

Rocket launch scoring must therefore never be folded into the existing satellite-pass score. It needs
its own inputs, its own geometry and its own confidence model.

## Required inputs

| Input | Why it is needed | Where it could come from |
| --- | --- | --- |
| Powered ascent trajectory | Altitude, downrange distance and velocity over time; without it nothing else can be computed | Published flight profiles or NOTAM/airspace advisories; a documented, validated ascent model for a named vehicle |
| Launch azimuth and inclination | Determines whether the ascent heads toward or away from the observer | Published mission parameters or the target orbit |
| Staging and burn timeline | Stage separation, second-stage ignition and coast phases change the illuminated object's position and duration | Mission profile |
| Vehicle and plume dimensions | A plume is kilometres long; apparent size drives visibility | Vehicle-specific published figures |
| Observer position | Azimuth, elevation and range to the ascent track | Existing saved observing locations |
| Sunlight and Earth-shadow geometry | The vehicle or plume must be sunlit while the observer's sky is dark | Existing `overhead-astro.js` sun geometry plus a shadow model at altitude |
| Local weather | Cloud, visibility and precipitation at the observer | Existing Open-Meteo path |
| Twilight conditions | Determines whether the sky is dark enough to see an illuminated object | Existing twilight utilities |
| Timing precision | A countdown with second precision and a trajectory with minute precision cannot be combined | The provider's `net_precision`, already carried in the feed |

## Confidence model (separate from satellite passes)

Three independent claims, each graded separately and never merged into one number:

1. **Schedule confidence** — from the provider's precision level and status. "Published to the second,
   status Go" is a different statement from "quarter announced".
2. **Geometry confidence** — from the availability and provenance of the trajectory. If no trajectory
   is available, the geometry claim is *unknown*, not zero. If a trajectory exists but is generic
   rather than vehicle-specific, it is graded lower.
3. **Observation confidence** — from local conditions: Sun altitude at the observer, plume illumination
   geometry, cloud and visibility, and the observer's horizon. This is the only place where a
   probability-like statement could ever appear, and it must state which inputs it used.

A launch card in a future phase should be able to say, for example, "Ascent heads south-east; the
vehicle leaves Earth's shadow about 90 seconds after liftoff; your sky is dark; cloud 10 %" without
turning that into a promise.

## Non-goals for Phase 2 as well

* No trajectory is invented from a pad position and an assumed azimuth.
* No plume brightness or magnitude is claimed without published vehicle or plume data.
* No probability of seeing anything is shown until geometry, illumination and weather are all known.
* No launch is ever promoted into the satellite or celestial rankings by proximity alone.
* No "visible from your location" statement without a documented trajectory source.

## What Phase 1 already provides for this work

* Stable launch identifiers and a normalized schedule with precision and status.
* Pad coordinates and launch-site timezones.
* Per-launch proximity and Sun-altitude context at the observer, clearly separated from visibility.
* A `change` record describing postponements and status changes between refreshes.
* A documented place for ascent geometry: `src/launches/` (see `readme.md`), with the schedule engine in
  `launch-feed.mjs` deliberately free of any trajectory assumption.
