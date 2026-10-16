# Launch engine

The launch schedule boundary. `launch-feed.mjs` is the single implementation of provider access,
schedule normalization, scheduling precision, status interpretation, duplicate handling, feed
validation and the cache/stale policy. The Pages Worker (`pages-worker.mjs` at the repository root),
the scheduled refresh job (`scripts/refresh-launches.mjs`) and the Node regression tests all import it,
so no schedule rule is implemented twice.

`launch-visibility.md` is the design for a later trajectory-aware visibility and plume model, including
the inputs it needs and what must never be claimed without them.

`launch-trajectory.mjs` is the ascent-geometry module: a pure module (no DOM, storage, network or
ephemeris of its own) that computes observer bearing, elevation, slant range, horizon clearance and
Earth-shadow illumination for a launch profile, gated by a five-level evidence taxonomy that caps what any
profile may claim. Phase 5B extended it with the two anchoring gates (orbital-plane consistency and
terminal-state consistency against a catalogued insertion orbit), the publication-permission rule derived
from those gates, and `exploreHistorical()`, the one entry point the interface calls. It still imports
nothing, produces no visibility statement and never enters satellite or celestial scoring.
`trajectory-sources.json` is the machine-readable source and licensing inventory,
`scripts/build-trajectory-fixtures.mjs` regenerates the research fixtures, and
`tests/launches-trajectory.cjs` holds those regressions.

Phase 5B publishes reviewed profiles. `scripts/build-trajectory-profiles.mjs` fetches the public sources,
runs both gates and writes `data/launches/trajectory-profiles.json` plus the generated
`docs/trajectory-profiles.md`; only profiles that passed both gates appear as trajectories, and every
rejection is recorded with the numbers that failed it. `overhead-launch-explorer.js` is the single
product-facing adapter: it loads the module and the artifact on demand (never on page load), validates
the artifact, calls `exploreHistorical()` and renders the result, and it computes no geometry itself so
the gate results cannot be contradicted in the interface. See
[docs/phase-5b-release.md](../../docs/phase-5b-release.md) and
[docs/launch-trajectory-feasibility.md](../../docs/launch-trajectory-feasibility.md).

Phase 5C added four pieces, all reachable from this directory:

- `launch-geodesy.mjs` — the observer-facing geometry (WGS-84 conversion, ENU look angles, great-circle
  helpers, horizon distance), extracted verbatim from the trajectory module, which imports and re-exports
  it unchanged. The launch calendar loads this instead of the evidence machinery; there is one
  implementation of the geometry and never a second model.
- `launch-pad-index.mjs` — builds, validates and queries the compact index
  (`data/launches/trajectory-pad-index.json`, schema `worthlookingup.trajectory-pad-index/1`) that says
  which pads have reviewed profiles, without carrying a single sample.
- `trajectory-audit.mjs` — the monthly evidence audit's judgement: integrity from the committed files,
  drift against live sources, the summary, and the review entries a human may choose to commit. Pure and
  offline-testable, and it has no code path that writes a published file.
- `mission-direction.mjs` — the mission-direction evidence contract (five classes; only a published or
  reconstructed mission-specific direction may ever reach an upcoming mission's sector). A contract only:
  nothing imports it.

`data/launches/trajectory-review.json` (schema `worthlookingup.trajectory-review/1`) is the single way a
published output may be suspended while its evidence is re-checked, and it is applied at read time as
`exploreHistorical({..., review})`. It never rewrites a recorded gate result, and an entry in a record that
does not validate suppresses nothing.

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
