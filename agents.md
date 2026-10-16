# Worth Looking Up agent guide

## Purpose and principles
Help people know when the sky is worth going outside for, from their location. Preserve honest
uncertainty, responsiveness, local ownership and both themes. All paths, deployment names and
repository identifiers must be lowercase. Product name: Worth Looking Up. This file is lowercase
because of that rule; agents should read it explicitly (some tools discover only AGENTS.md).

## Architecture and source of truth
- index.html owns UI, site/timezone selection, forecast orchestration, bounded persistence.
- overhead-engine.js owns orbital math and scoring; overhead-worker.js hosts calculations.
- overhead-lifecycle.js controls current/recent/eligible event timing across every presentation.
- overhead-weekly.js and overhead-trains.js interpret opportunities without modifying SGP4.
- overhead-calendar.js is the only iCalendar writer: a pure module (no DOM, storage, network or engine
  call) that turns a discovery event into RFC 5545 text, with UTC instants, stable product-owned UIDs
  and explicit refusals for anything the source cannot time. index.html owns the download, the
  session-only observing plan and every user-facing label. See docs/calendar.md.
- overhead-objects.js enriches selected objects; metadata failures must not affect ranking.
- overhead-astro.js wraps pinned Astronomy Engine; planets/meteors/comets feed opportunities and
  celestial-plan; overhead-celestial-worker.js executes the same plan off the main thread.
- data/overhead/*.json and relevant fixtures are pipeline output: change tools/overhead_*.py,
  validate, regenerate atomically. Never hand-edit facts or replace automated refresh commits.
- Retained Overhead globals/schema/storage names are compatibility identifiers, not host coupling.
- Future launches: src/launches (schedule engine, feed schema and the Phase 2 visibility design);
  overhead-launches.js interprets schedules for the browser; pages-worker.mjs serves the feed and
  scripts/refresh-launches.mjs refreshes it on a schedule. Launch schedules never enter satellite or
  celestial scoring, and local visibility is always labelled unknown without flight geometry.
- src/launches/launch-trajectory.mjs is the Phase 5A research prototype: ascent geometry and a five-level
  evidence taxonomy, no DOM/storage/network, no ephemeris of its own and no import of the schedule engine.
  Nothing in the product loads it; it must stay out of index.html, the worker and every score, and it may
  never publish a brightness, plume-size, probability or visibility claim. Its fixtures come from
  scripts/build-trajectory-fixtures.mjs (public-domain webcast transcriptions) and its inventory is
  src/launches/trajectory-sources.json; see docs/launch-trajectory-feasibility.md. A profile whose values
  are not anchored to an achieved orbit may support a direction, never an elevation.

## Coding and behavior
No framework rewrite, bundler or speculative services. Prefer pure modules and browser APIs.
Guard storage and external requests; keep fallback paths, timestamps and stale warnings.
Escape text interpolated into HTML. No invented events, brightness, rarity, accuracy or precision.
Changes to astronomy/scoring require deterministic fixture evidence and documented rationale;
this migration's engines match docs/source-manifest.json. Update that baseline deliberately only
when a later justified engine change is accepted. Never loosen scientific tolerances to pass tests.

## Checks
npm ci; npm test; npm run test:browser. Browser tests use Chrome locally, Chromium with CI=1.
Python dependencies: requirements.txt. Run precision test and both builders --check plus comet
--no-network for pipeline changes. Live-provider tests are opt-in; report skips honestly.
Run npm run build and verify the staged artifact for releases. Worker imports, missing assets,
origin independence, transfer validation and deployment packaging are checked in tests/migration.cjs.
Never replace a real behavior test with an assertion mirroring its implementation.
Hourly refresh workflows validate their own artifact, engine and endpoint only: unrelated regression
suites must never gate data publication. They push only after fetching and replaying on origin/main and
never force. Test fixtures for continuously refreshed artifacts are fixed records declared in the test;
only content-independent invariants may be asserted against the live artifact.

## Git synchronization and releases
Inspect status/branch/remotes; fetch origin before work and before push. Main is shared with a
scheduled data bot. Fast-forward only when safe; reconcile genuine divergence preserving work.
Never force-push, reset, clean, automatically stash or discard user/untracked/automated changes.
Initial empty remote is allowed. Push normally, then fetch and verify origin/main contains HEAD.
Use scripts/git-sync.sh for ordinary established clones. Explicitly report failed fetches.
Version index.html comment, footer attribute and visible text together as YYYY.MM.DD.N when
shipping UI changes. CI and production checks must inspect deployed content, not infer from push.

## Cloudflare
Project worthlookingup, canonical apex, www 301 preserves path/query; legacy /overhead.html becomes the canonical root. pages-worker.mjs (repository root) is packaged as dist/_worker.js for host redirects (Pages _redirects supports paths only) and for GET /api/launches.json, delegating other requests to ASSETS. npm run build stages only
public files; deploy dist, never repository root. Existing independent analytics collector is shared;
site identity is worthlookingup, registered in CFLab Analytics as as_PKAOHGDzw9aJP98hZxaPQB with the
domains worthlookingup.com and www.worthlookingup.com (docs/analytics.md records the registration, the
four events sent and the verification commands). Never add an analytics secret to browser code: the
public tracking ID is the only identifier the client knows. No Junk Drawer-hosted runtime assets or APIs. Read docs/deployment.md
for credentials/CI requirements. Never commit credentials or rotate them without a concrete need.
Do not retire original Overhead until the new site passes production acceptance.

## Sources, licensing, storage
Keep direct CelesTrak/Open-Meteo/Wikidata requests unless a specific issue warrants a cache/API.
Respect terms, limits and attribution; free API access does not grant commercial redistribution.
Review docs/providers.md before monetization. No unlicensed photos; assets/provenance.json records
origin/rights. Keep vendor license notices. Do not silently grant a license to extracted source.
Preferences use overhead.* localStorage on the independent origin. Downloaded responses use
IndexedDB overhead-cache (32 responses, 7 days), identity uses overhead-object-meta (200, 21d).
Never delete user sites/favorites to free caches. Transfers are explicit, validated, bounded,
allowlisted; never transfer analytics IDs or downloaded caches. Preserve the old origin's data.

Maintain docs/migration-status.md at milestones with test, Git/deployment evidence and next action.
