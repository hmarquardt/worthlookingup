# Launch engine

The launch schedule boundary. `launch-feed.mjs` is the single implementation of provider access,
schedule normalization, scheduling precision, status interpretation, duplicate handling, feed
validation and the cache/stale policy. The Pages Worker (`pages-worker.mjs` at the repository root),
the scheduled refresh job (`scripts/refresh-launches.mjs`) and the Node regression tests all import it,
so no schedule rule is implemented twice.

`launch-visibility.md` is the design for a later trajectory-aware visibility and plume model, including
the inputs it needs and what must never be claimed without them.

`launch-trajectory.mjs` is the Phase 5A research prototype built against that design: a pure module (no
DOM, storage, network or ephemeris of its own) that computes observer bearing, elevation, slant range,
horizon clearance and Earth-shadow illumination for a launch profile, gated by a five-level evidence
taxonomy that caps what any profile may claim. Nothing in the product imports it and the production
calendar still reports local visibility as unknown. `trajectory-sources.json` is the machine-readable
source and licensing inventory, `scripts/build-trajectory-fixtures.mjs` regenerates the committed
reconstruction fixtures, and the tests are `tests/launches-trajectory.cjs`. See
[docs/launch-trajectory-feasibility.md](../../docs/launch-trajectory-feasibility.md).

Rules this boundary enforces:

* A launch is never given a precise time the provider did not publish. LL2's coarse precisions carry
  the END of the announced period as the timestamp, so those records are marked approximate and are
  never treated as a date.
* An unknown status stays unknown; it is never promoted to "scheduled".
* Nothing here produces visibility, brightness, bearing, elevation, duration or probability. Launch
  schedules never enter SGP4 or the satellite/celestial scores.
* An upstream failure never empties the calendar: the last good copy is served with an explicit stale
  reason, and an unavailable feed is described as missing rather than empty.

The published feed is `data/launches/upcoming.json` (schema `worthlookingup.launches/1`), refreshed on a
schedule and served at `GET /api/launches.json`. See [docs/launches.md](../../docs/launches.md).
