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
- overhead-objects.js enriches selected objects; metadata failures must not affect ranking.
- overhead-astro.js wraps pinned Astronomy Engine; planets/meteors/comets feed opportunities and
  celestial-plan; overhead-celestial-worker.js executes the same plan off the main thread.
- data/overhead/*.json and relevant fixtures are pipeline output: change tools/overhead_*.py,
  validate, regenerate atomically. Never hand-edit facts or replace automated refresh commits.
- Retained Overhead globals/schema/storage names are compatibility identifiers, not host coupling.
- Future launches: src/launches; separate schedule, ascent/plume geometry and confidence model.

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

## Git synchronization and releases
Inspect status/branch/remotes; fetch origin before work and before push. Main is shared with a
scheduled data bot. Fast-forward only when safe; reconcile genuine divergence preserving work.
Never force-push, reset, clean, automatically stash or discard user/untracked/automated changes.
Initial empty remote is allowed. Push normally, then fetch and verify origin/main contains HEAD.
Use scripts/git-sync.sh for ordinary established clones. Explicitly report failed fetches.
Version index.html comment, footer attribute and visible text together as YYYY.MM.DD.N when
shipping UI changes. CI and production checks must inspect deployed content, not infer from push.

## Cloudflare
Project worthlookingup, canonical apex, www 301 preserves path/query; legacy /overhead.html becomes the canonical root. scripts/pages-worker.mjs is packaged as dist/_worker.js for host redirects (Pages _redirects supports paths only), delegating other requests to ASSETS. npm run build stages only
public files; deploy dist, never repository root. Existing independent analytics collector is shared;
site identity is worthlookingup. No Junk Drawer-hosted runtime assets or APIs. Read docs/deployment.md
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
