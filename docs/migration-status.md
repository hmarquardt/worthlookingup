# Migration status — 2026-10-15

## Rocket launch schedules (Phase 1) — 2026-10-15
- [x] Inspected the launch boundary (src/launches/readme.md), the existing Cloudflare setup and the UI.
- [x] Verified the provider before implementing: Launch Library 2 API 2.3.0 is live, 2.2.0 returns 404,
      15 unauthenticated requests/hour, `limit` caps at 100, attribution and the commercial-use
      restriction recorded in docs/providers.md and carried inside every feed.
- [x] Launch engine (src/launches/launch-feed.mjs): normalization, scheduling precision (coarse LL2
      precisions carry the END of the announced period and are never treated as a date), provider
      status, duplicate handling, postponement detection, validation, bounded upstream reads, merge and
      the cache/stale policy. Shared by the Worker, the scheduled job and the tests — one implementation.
- [x] Server-side scheduled ingestion (scripts/refresh-launches.mjs + .github/workflows/launches-data.yml,
      hourly) publishes data/launches/upcoming.json atomically and refuses to publish invalid or empty data.
- [x] Cloudflare endpoint GET /api/launches.json in pages-worker.mjs: edge cache → optional `LAUNCHES` KV
      → committed feed → bounded upstream refresh (max 2 pages, at most every 30 minutes), explicit stale
      reasons for 429/5xx/timeout/malformed/empty, and an honest unavailable response when nothing exists.
      Verified in the real Wrangler Pages runtime: first request `served_by upstream` (live LL2 fetch),
      second `served_by cached` from the edge cache, static feed and module assets served, 404 preserved,
      www/legacy redirects unchanged.
- [x] UI: a ROCKET LAUNCHES category sharing the existing TONIGHT / NEXT 7 DAYS / NEXT 90 DAYS windows,
      mission/vehicle/site/local time/countdown/status/official links/source freshness, a period-only
      group for schedules with no published date, and per-launch proximity plus Sun-altitude context.
      Local visibility is always labelled unknown; launch schedules never enter satellite or celestial
      scoring; the feed is fetched only when the category is opened, and the countdown timer stops itself
      so the satellite page keeps its previous performance profile.
- [x] Tests: tests/launches-feed.cjs, tests/launches-relevance.cjs, tests/launches-worker.cjs (all in
      `npm test`) and tests/launches.spec.js (browser: on-demand loading, precision, countdown, staleness,
      missing/empty/foreign feeds, mobile widths, both themes, keyboard use, satellite view unchanged).
      Fixtures are captured provider records with documented mutations. `npm test` passes (18 suites),
      `npm run test:browser` passes 32 with the 2 intentional live-source skips.
- [x] Docs: docs/launches.md (provider, cache intervals, failure behaviour, rate limits, commercial
      restrictions, uncertainty, Cloudflare resources, outstanding KV configuration),
      src/launches/launch-visibility.md (Phase 2 trajectory/plume inputs and non-goals), providers,
      deployment, agents, readme and the launch boundary readme.
- [x] Release: index.html comment, footer attribute and visible text versioned together as 2026.10.15.3.
- [x] Commits d59a51a (engine, ingestion, endpoint), befd10f (interface) and 5eee9df (tests, docs) pushed
      normally to main; origin/main verified to contain HEAD.
- [x] GitHub Actions run 38781069146 succeeded end to end: validate (npm ci, 18 regression suites,
      launch artifact check, Python precision/builders, full browser suite on Chromium/Ubuntu,
      build, artifact upload) and deploy (Cloudflare Pages, strict production verifier).
- [x] Production verification: https://worthlookingup.com/api/launches.json returns HTTP 200 with
      schema worthlookingup.launches/1, 146 launches, served_from committed-feed, source "Launch
      Library 2" API 2.3.0, retrieved_at and upstream sha256 present, attribution and the rate-limit /
      commercial-restriction text included, generated_at fresh (X-WLU-Launch-Feed-Age 5 minutes), and
      stats showing 7 with a published time against 131 with a period only. Deployed HTML is
      byte-identical to this checkout and still release 2026.10.15.3; /overhead-launches.js,
      /data/launches/upcoming.json and /src/launches/launch-feed.mjs are all served; the strict
      verifier passed every redirect chain, the scientific hashes, both workers and the real 404.
- [x] Live browser acceptance against production: the ROCKET LAUNCHES category loads the real feed
      ("1 launch with a published time or date in tonight · 96 more announced with a period only"),
      shows the countdown, both local times, the provider status, the precision sentence, official
      links and the freshness line, labels visibility unknown on every card, and reports no console
      errors.
- [x] The hourly `.github/workflows/launches-data.yml` schedule is registered and active; the same
      script and `--check` already passed in CI. Its first scheduled run publishes the refreshed
      artifact (or leaves it untouched when the provider is unavailable).
- [ ] Outstanding: create the optional `LAUNCHES` KV namespace and binding for cross-colo sharing of an
      on-demand refresh. Not required for correctness; recorded in docs/launches.md.
- [ ] Note for the next release: local (macOS/Node 26) full-suite teardown can hang after the last test
      in a multi-spec run. It is pre-existing (the pre-change worktree hangs identically), CI completes
      normally, and single-spec runs exit cleanly since the launch countdown timer became self-terminating.

## Completed
- [x] Inspect source, repository skills, providers, workers, data and test architecture.
- [x] Inventory and conservative migration architecture: migration.md.
- [x] Extract source commit 541a9701b1bf7ccd8acabbacb9cf7ff146e47418 without changing original checkout.
- [x] Preserve scientific modules, workers, libraries and generated data exactly; source-manifest.json holds hashes.
- [x] Independent index.html, wordmark/favicon/original responsive sky illustration/social PNG, asset provenance.
- [x] Independent worthlookingup analytics identity, collector HTTP 204 verified on deployed page.
- [x] Validated preference export/import, old-origin export instructions, privacy/provider/launch-boundary docs.
- [x] Lowercase agents.md governance, CI, scientific tests and independently owned data refresh workflow.
- [x] Explicit static packaging, 404 handling, revalidation headers and canonical/www redirect configuration.
- [x] Initial commit d08b753a7abd7f8100220916dfc16470543a9de6 pushed to main; remote ls-remote and git-sync verify match.
- [x] Pages project worthlookingup and both custom domains created; 45 static files deployed.
- [x] HTTPS artifact bytes verified at https://worthlookingup.pages.dev (first deployment 4c3d7b1d).
- [x] Complete local browser acceptance and push presentation/CI portability fixes.
- [x] Confirm final remote CI success and deployed release hash verification.
- [ ] Activate and verify apex/www DNS and TLS/redirect.

## Decisions and files
Flat scientific module paths, Overhead globals, storage names and schema identifiers retained for
compatibility. No Junk Drawer-hosted runtime dependency. Direct providers retained; no API/R2
infrastructure created. All new filesystem paths lowercase, including agents.md, license.txt and
these documentation files. Original vector art is a production fallback; photography deferred until
verified licensed. No application software license grant fabricated (source had no root license).
92 files in initial commit: application/workers, vendor notices, generated data, fixtures/tests,
builders, docs, original assets, transfer module, Git helper, CI and deployment configuration.

## Tests and evidence
- npm install: 0 reported vulnerabilities.
- npm test: all scientific/migration suites passed, including 116 orbital passes/four ISS references,
  4,725 Horizons comparisons, 20 train scenarios, 16 weekly cases + 576 score combinations.
- Python: 6 precision tests passed; comet --check, comet --no-network, meteor --check passed.
- Full local browser run: 25 passed, 2 intentionally skipped live-incident tests, 1 failed on
  footer height (241px vs inherited <220px). Privacy text moved to linked policy; isolated final footer recheck passed (1/1). Combined local acceptance: 26 passed, 2 intentional live-incident skips. Final Linux GitHub CI completed successfully after the screenshot-path fix, including the full browser suite.
- Migration HTTP browser test passed: worker imports, mobile widths/themes, no missing assets,
  validated import/export and origin independence. Celestial worker and inline plan match.
- Theme geometry assertion uses document coordinates to remain valid after keyboard focus scrolls.
- Initial GitHub CI: scientific/Python checks passed, browser failed because inherited screenshot
  paths used macOS-only /private/tmp plus footer height; screenshot paths now portable /tmp.
- Original cross-history frozen pixel baseline replaced by retained theme/state/contrast/geometry
  checks: independent repository has no historical commit, branding intentionally differs.
- First deployed HTML/assets/workers/libraries/data match local byte/hash checks; missing file is 404.
- Live deployed Chrome: 414 orbital objects, 2,421 passes, worker active, weather and CelesTrak HTTP 200,
  analytics worthlookingup accepted HTTP 204, no page errors or application source errors.
- Original Junk Drawer tracked diff remains empty; four pre-existing untracked files preserved.

## Git and deployment
Branch main, origin git@github.com:hmarquardt/worthlookingup.git. Initial upstream established by
ordinary git push -u origin main after verifying empty remote; no force/reset/clean. First commit
verified on remote. Presentation/test portability correction commit 03ca48124febe04c77e10e831f0e1d73b90cd548 pushed and remotely verified. CI run 38756914199 completed successfully: https://github.com/hmarquardt/worthlookingup/actions/runs/38756914199. Unattended deploy job skipped by its documented credential gate; local authenticated publication succeeded.
Release finalized and published: 2026.10.15.2. Deployment d01c0662; deployed HTML, all scientific hashes, workers/data, assets, tracker and transfer bytes verified after upload. First deployed artifact was 2026.10.15.1.
Canonical intended https://worthlookingup.com; currently verified accessible deployment is
https://worthlookingup.pages.dev (final application deployment https://d01c0662.worthlookingup.pages.dev).

## External blockers
1. Cloudflare domains both pending: exact API error “CNAME record not set”. Existing OAuth can manage
   Pages but DNS records API returns 403. Apex HTTPS returned 522, www request timed out. Add proxied
   CNAME @ and www → worthlookingup.pages.dev in zone a592818531712408128a88d9dfe3cbbc, then verify
   both hosts and permanent www path/query redirect. No credentials created/rotated.
2. Unattended deployment needs an existing Pages write token set as GitHub secret CLOUDFLARE_API_TOKEN
   and repository variable CLOUDFLARE_DEPLOY_ENABLED=true. Until enabled, publish after data refreshes
   with npm run deploy. Daily bot includes same-workflow deploy because bot pushes do not trigger CI.
3. Commercial release needs Open-Meteo commercial plan and review of COBS/calendar redistribution;
   detailed rights/attribution limits in providers.md. Current product has no ads/subscriptions.

## Exact next action
1. In Cloudflare DNS add/repair proxied CNAME @ and www → worthlookingup.pages.dev; both Pages
   domains are already attached. Then run `node scripts/verify-production.mjs https://worthlookingup.com`
   to verify apex HTTPS and www 301 preserving path/query. Keep original Overhead operational.
2. Set an existing Pages write token as GitHub secret CLOUDFLARE_API_TOKEN and variable
   CLOUDFLARE_DEPLOY_ENABLED=true. Until then, run npm run deploy after data refreshes.
3. Once hostnames and automatic data publication are verified, develop the separate launch schedule
   cache/adapter described in src/launches/readme.md, with a separate ascent/plume confidence model.

## Final handoff checkpoint
All work possible with available access is implemented. DNS write and GitHub deploy-secret configuration
are external blockers, not completed deployment claims. Final documentation-only commit records this
checkpoint after successful application CI; it uses [skip ci] to avoid repeating unchanged code checks.
The original source tracked diff was confirmed empty. No credentials were created, rotated or committed.

## Workflow repair checkpoint — run 38762166564
- Source checkout synchronized and clean before work; no astronomical/application UI changes.
- Confirmed successful Cloudflare deploy and failed post-deploy assertion from original run logs.
- Live chain: www legacy 301 relative /?verify=1 then www 200; normal www docs also 200.
- Root cause: unsupported hostname source in Pages _redirects plus verification of an incorrect legacy intermediate target.
- Repair: packaged Pages Worker canonicalizes www and legacy paths, absolute path-only fallback; verifier walks 10 HTTP/HTTPS chains and enforces permanent status, TLS, canonical final URL, path/query integrity and no loops.
- All workflow runners pin ubuntu-24.04; official stable actions use Node24 and setup-node selects 24.
- Added behavior regressions for the Worker and verifier, including encoded/repeated/empty queries and malformed chains. npm test passed all scientific/static/redirect regressions. Actual Wrangler Pages runtime smoke passed: www docs/legacy 301 to HTTPS apex, query preservation, static worker 200 with headers, missing worker 404.
- Next action: finish local checks, pre-push synchronization, commit/push, then verify the next Actions validation/deployment and actual apex/www production chains.

### Deployment readiness follow-up
Repair c111206 pushed and verified. Run 38765012826 passed full validation (Node24/Ubuntu24.04),
deployed Worker 0522afb2 successfully, then probed two seconds after deployment and still saw prior
www routing. Independent strict production verification subsequently passed all ten HTTP/HTTPS
chains plus deployed asset hashes. Adding a bounded 2-minute full-verification retry in CI to handle
route propagation; persistent failures still fail. No scientific/application changes.

### Workflow repair completed
- Repair commits c111206c2f2e522aa3bdb75fe0e916411e35cb96 and
  6e914f343f79a084982faf5ed34021674cbd5a91 pushed normally and verified on origin/main.
- Run https://github.com/hmarquardt/worthlookingup/actions/runs/38765797569 succeeded:
  validation (26 browser passes, 2 intentional live-source skips; scientific/Python/redirect checks),
  artifact upload/download with upgraded actions, Cloudflare deployment, strict post-deploy verifier.
- Deployed application artifact: https://2dfd6328.worthlookingup.pages.dev. Canonical apex remains
  https://worthlookingup.com. Both hostnames are active; earlier migration DNS/CI-secret blockers
  are resolved by the existing infrastructure configuration.
- Independent strict production verifier passed after the successful CI deployment, including
  deployed HTML/library/scientific dataset hashes, application workers, branding/tracker/transfer
  bytes, real missing-file 404 and all ten redirect chains.
- HTTPS www ordinary paths → 301 same path on HTTPS apex → 200. Legacy /overhead.html on either
  HTTPS hostname → 301 https://worthlookingup.com/ → 200. HTTP first upgrades to HTTPS, then
  canonicalizes/normalizes as required. Encoded/repeated/empty query values are preserved.
- No astronomical calculations, generated scientific data, browser application behavior or UI changed.
  Worker gateway was tested in the actual local Pages runtime as well as deterministic regressions.
- All jobs pin ubuntu-24.04; action runtimes and tooling Node are 24. Ubuntu26 remains untested.
- Final documentation-only handoff uses [skip ci]; application deployment/CI evidence above refers
  to repair commit 6e914f3. No additional code changes require deployment.
- Remaining actions for this repair: none.

## Phase 2 photographic discovery — implementation checkpoint
- Clean main checkout recovered at e413c07; initial sandbox fetch failed on FETCH_HEAD permissions,
  then authorized fetch succeeded. No uncommitted work existed; no prior work discarded.
- Release 2026.10.15.4 implements NASA photography, responsive discovery and existing weekly highlight
  before briefing. All scientific source hashes unchanged. See design.md and phase-2-release.md.
- Scientific/migration/launch tests passed; existing browser 32 passed, 2 live skips; 3 new homepage
  tests passed. Python precision 6 passed and both builders/offline comet checks passed.
- Actual scheduled ingestion run 38788844841 succeeded including publish and feed verification;
  independently observed fresh committed feed. No KV or credentials created.
- Next: commit, synchronize/push main, verify complete Actions deployment, exact production assets,
  redirects, workers and feed, then append final release evidence.

### Phase 2 deployment completed
- Implementation b66694ff541d1d0a495209457124211b202af302 pushed normally; git-sync verify confirmed
  origin/main containment. Bot feed bb8f560 preserved by safe fast-forward with unrelated edits intact.
- https://github.com/hmarquardt/worthlookingup/actions/runs/38799435528 passed all validation and
  deploy steps, including production verification. Pages artifact https://65adcb77.worthlookingup.pages.dev.
- Independent strict verifier passed canonical production HTML/release, responsive photo bytes,
  scientific hashes, workers/data, branding, real 404 and all ten host/path/query redirect chains.
- Live production Chrome 390/1280 screenshots inspected: no page errors/overflow; real orbital and
  weather results; local photos load. Five launch cards retained unknown visibility. Fresh 146-launch
  feed generated 2026-10-15T19:41:52Z, stale=false, independently checked 20:12Z.
- Focused final launch suite 6 passed after the compact launch-heading refinement. New homepage
  suite 3 passed; existing suite 32 passed/2 intentional skips; Python precision/builders passed.
- Full rationale, measurements, source rights and screenshots: phase-2-release.md, design.md,
  assets/provenance.json, docs/screenshots. Final documentation evidence commit uses [skip ci];
  it changes no application assets. No remaining release blocker.
- Next product improvement: compact discovery across categories with explicit local-versus-schedule
  scope; consider bounding the existing many-event Happening now presentation without losing labels.

## Phase 3 discovery — implementation checkpoint
- Clean main recovered; safe fast-forward preserved scheduled bot feed 3a960bd before work.
- Release 2026.10.15.5 adds pure presentation adapter, scoped guide, source-ID navigation, retained
  category plans and compact native active-event disclosure; no scientific engine/hash changes.
- Full local browser suite 39 passed/2 live skips; pure/scientific/migration checks passed. Python
  precision 6 passed, both builder checks and comet offline validation passed. Focused discovery
  navigation/network/failure/active-event checks passed. See discovery.md and phase-3-release.md.
- First useful mobile opportunity remains 558px. Seven active intervals: 1211px → 264px collapsed,
  1052px expanded. Initial provider calls unchanged; one new local 7KB module request only.
- Next: synchronize with hourly bot, commit/push, verify full Actions/Pages deployment and strict
  production content, navigation, source freshness, workers, redirects and imagery; record evidence.

### Phase 3 production acceptance completed
- Deployed implementation ddb1f3726a7c1871d8a89a83e5063cc7c43f885c pushed normally and verified on
  origin/main. All three newer hourly bot commits preserved before release; no force/reset/stash.
- https://github.com/hmarquardt/worthlookingup/actions/runs/38828769307 passed validation and deploy.
  CI browser 39 passed/2 intentional live skips. Deployment https://e67c2dd3.worthlookingup.pages.dev.
- Independent strict production verification passed release HTML, exact adapter/photo bytes,
  scientific source hashes, workers/data, analytics/transfer, real 404 and ten redirect chains.
- Production Chrome 390/1280: no page errors, same-origin HTTP errors or overflow; real photos,
  orbital/weather results and six active intervals in compact 264px/221px panels. All four local
  guide categories loaded, chronological/varied previews appeared, celestial source navigation and
  Back worked, stored preferences were unchanged, launch preview navigation and unknown visibility
  remained correct for exact and year schedules. Screenshots under docs/screenshots/phase3.
- Fresh committed launch feed independently checked 2026-10-16T00:25Z: 148 launches, generated
  2026-10-15T23:41Z, stale=false. Hourly ingestion unchanged; no new service/KV/DNS or credentials.
- Contracts and evidence in discovery.md, phase-3-release.md and phase-3-measurements.json.
- Final evidence-only commit uses [skip ci] and changes no deployed application assets.
- No remaining release blocker. Next: explicit calendar export with honest windows/timezones and
  update semantics; retain approximate periods for launch schedules without exact dates.

## Phase 4 calendar export and observing plans — implementation checkpoint
- Clean main recovered; the hourly bot's feed commit 005dd86 preserved by a safe fast-forward.
- Release 2026.10.15.6 adds overhead-calendar.js (pure RFC 5545 serializer: CRLF, escaping, 75-octet
  UTF-8 folding, UTC instants, product-owned UIDs, refusal reasons) plus the interface controls and a
  session-only observing plan. No scientific engine, fixture or source-manifest hash changed.
- npm test 21 suites passed (new tests/calendar.cjs re-parses the output with ical.js, a
  development-only dependency). Browser: 44 passed, 2 intentional live-provider skips, 0 failures,
  including five new calendar tests with real downloads. Python precision 6 passed; comet --check,
  comet --no-network and meteor --check passed. Launch artifact check passed.
- Layout cost measured (scripts/measure-calendar.cjs): action row 44px at 390 and 36px above 720, so the
  first satellite row moves 44/35/36/36px; the plan panel is 0px while empty; no overflow at four widths.
- Next: synchronize with the hourly bot, verify the full Actions/Pages deployment and strict production
  content, then download and inspect real .ics files from the production browser; record evidence.

### Phase 4 production acceptance completed
- Implementation commits a51896b, 1b5f486 and a1428b0 pushed normally; git-sync verify confirmed
  origin/main contains a1428b0. No force/reset/stash; the bot feed commit was preserved.
- https://github.com/hmarquardt/worthlookingup/actions/runs/38835421998 passed validation and deploy.
  CI: npm test, launch artifact check, Python precision/builders, full browser suite on Chromium, build,
  artifact upload, Cloudflare Pages publication and the strict production verifier.
- Independent strict production verification passed deployed HTML/release, exact
  overhead-discovery.js/overhead-calendar.js bytes, unchanged scientific hashes, workers/data,
  branding/transfer/analytics, a real 404 and all ten redirect chains.
- Real production Chrome downloaded and inspected three actual .ics files (comet opportunity, exact
  launch, two-event observing plan) with CRLF, ≤75-octet folding, UTC instants, stable UIDs, the
  Worth Looking Up link, no coordinates or storage keys, TENTATIVE launch semantics, no visibility or
  probability claim and no fabricated DTEND. Plan count/remove/clear/self-hide, a 44px tap target,
  visible focus, both themes and no overflow at 390px confirmed; 12 period-only schedules offered no
  calendar action. Script: scripts/verify-calendar-production.cjs.
- Evidence, measurements, screenshots and limits: docs/calendar.md and docs/phase-4-release.md.
- Final evidence-only commit uses [skip ci] and changes no deployed application assets.
- No remaining release blocker. Next: a per-location webcal:// subscription would need a server-side
  renderer and a reader identity, which this phase deliberately avoids; revisit only with a concrete
  need, reusing the existing serializer, UID namespace and eligibility rules.


## Hourly launch ingestion repair — 2026-10-16
- Ten consecutive hourly runs failed (2026-10-16T04:46Z through 13:44Z, last run 38910193196) at
  tests/calendar.cjs:219. Root cause: the calendar test selected "the first published time in the
  future" from the live data/launches/upcoming.json, which resolved to USSF-481; the 04:46Z refresh
  recorded that flight as `success | Launch Successful`, and the exporter correctly refuses completed
  launches. The 03:48Z refresh still read `unknown | Launch in Flight`, which is why the breakage
  started at 04:46Z. Verified against the committed feeds at f59deae, 6cdf94f and ccea6e7.
- Because the failure was inside the publication step, Cloudflare was never redeployed: the deployed
  schedule aged while the refresh itself kept succeeding. Fail-closed behaviour and the last-good
  commit were never at risk.
- Fixed: tests/calendar.cjs now declares fixed fixtures for exact, day-only, every broad period,
  active/unconfirmed/held, completed, cancelled, under-way, already-passed, unreadable and missing
  cases, and asserts only content-independent invariants against the live artifact;
  tests/discovery.spec.js builds its own launch feed instead of spreading a live sample.
- Publication now validates this pipeline only (artifact check, schedule engine, relevance and worker
  suites, build) instead of the full regression suite, so an unrelated vertical can no longer block
  hourly data publication. The push fetches and replays on origin/main with up to three attempts and
  never forces.
- publishDecision/effectiveScheduleDigest: an unchanged schedule is no longer rewritten every hour.
  Measured: 8 of the previous 16 hourly commits carried identical schedule content. Unchanged content
  now defers while the committed copy is under the 120-minute deadline (keeping the deployed copy
  inside the 180-minute staleness horizon) and republishes once it is reached. A live three-run check
  showed publish/changed, publish/changed then defer/unchanged as expected.
- Verified: npm test 21 suites; node scripts/refresh-launches.mjs --check; launches-feed,
  launches-relevance and launches-worker; npm run build; the fixed browser specs (discovery, calendar,
  homepage, migration) 13 passed.
- Next: commit, push, dispatch a manual ingestion run, verify the Cloudflare feed, then confirm the
  following genuine scheduled run.

### Second incident found while verifying: celestial data committed but never deployed
- .github/workflows/overhead-data.yml run 38863253804 (2026-10-16T06:47Z) committed the refreshed
  comet catalog and ephemerides and then failed in its own publish step, which also ran npm test: the
  same tests/calendar.cjs mutable-feed failure. Production therefore served 2026-10-15T06:48Z data
  while the checkout held 2026-10-16T06:48Z. Because bot pushes do not trigger ci.yml, nothing
  reported it.
- The refreshed celestial data is scientifically sound: comet/ephemeris --check, the two Node data
  suites, the Horizons fixture reproduction and the COBS re-derivation all pass.
- Fixed the assertion that made it look like a data problem: docs/source-manifest.json now separates
  frozen code (the overhead-*.js engines and vendor/overhead libraries, still byte-frozen against the
  migration commit) from pipeline_outputs (data/overhead/*.json, validated by schema, generation time,
  non-empty content, recorded provenance and an existing builder, with the migration digest kept as
  history). scripts/verify-production.mjs validates those deployed artifacts by schema and provenance
  and reports whether their bytes match the checkout, instead of asserting a historical digest.
- overhead-data.yml's publish step now validates its own pipeline (the two data suites and the build)
  rather than the complete regression suite, for the same reason as the launch workflow.

### Freshness of the copy readers actually get
- The first repair version decided deferral from the committed artifact's age. That was still wrong:
  the 14:45Z scheduled run (38918305748) succeeded but deferred, correctly by that rule, while the
  deployed feed was 659 minutes old and flagged stale — the commits had kept succeeding all day while
  every deployment failed. A deferral keyed to the commit can never repair a stale deployment.
- publishDecision now takes the deployed copy's age (measured from /api/launches.json before each
  refresh) and uses the older of the two. Unchanged content defers only while both copies are inside
  the 120-minute deadline; a measured-but-unreadable deployed age is never treated as fresh, and an
  unmeasured one falls back to the committed artifact for local runs. Publish steps in
  launches-data.yml and overhead-data.yml both now validate their own pipeline.
- Demonstrated with real retrievals: deployed age 659 minutes republished an unchanged schedule, an
  unreadable deployed copy republished, and a fresh deployed copy deferred without writing.
- Production feed after the push-triggered deployment: generated 2026-10-16T13:44Z, 63 minutes old,
  stale false, 148 launches; the previously stuck celestial artifacts also redeployed
  (comet ephemerides 2026-10-16T06:48Z).
- Next: commit, push, dispatch a manual ingestion run, verify the Cloudflare launch feed and the
  celestial artifacts, then confirm the following genuine scheduled run.
- Manual dispatch could not be issued from this environment: workflow_dispatch needs a GitHub token and
  none is available here (gh is not authenticated, and the remote is SSH). The equivalent verification
  was performed instead, and it used the real pipeline: the genuine 14:45Z scheduled run 38918305748
  executed the repaired ingestion path end to end and succeeded, the push-triggered ci.yml run
  38918902342 validated and deployed through Cloudflare with the strict production verifier, and the
  deployed launch feed and celestial artifacts were then inspected directly. The next scheduled run
  after the deployed-freshness change was still pending when this entry was written; its expected
  behaviour (publish on changed content or stale deployed copy, otherwise defer) is covered by
  tests/launches-feed.cjs and by the recorded real-retrieval runs above.
- Before/after proof of the fix: with the exact feed that triggered the outage (ccea6e7, where USSF-481
  reads `success | Launch Successful`) restored into data/launches/upcoming.json, tests/calendar.cjs,
  tests/launches-feed.cjs, tests/launches-relevance.cjs and tests/migration.cjs all pass, and the
  pre-repair exporter shown that feed refuses the record as completed.

## Phase 5A: launch trajectory feasibility (research only, no product change)

- Deliverables: `docs/launch-trajectory-feasibility.md` (report, taxonomy, validation, Phase 5B scope),
  `docs/launch-trajectory-sources.md` plus `src/launches/trajectory-sources.json` (fifteen sources with
  access, precision, licensing and the evidence ceiling each can support), the pure prototype
  `src/launches/launch-trajectory.mjs`, the generator `scripts/build-trajectory-fixtures.mjs`, committed
  fixtures under `tests/fixtures/launches/`, and `tests/launches-trajectory.cjs`.
- Test evidence: `npm test` passes with 22 suites; the new suite reports measured agreement with
  independent references (WGS-84 against Astronomy Engine 0.42 m; solar elevation against overhead-astro
  0.143 deg; shadow edge against the closed-form dip angle 0.270 deg; horizon crossing against the
  closed-form arc 0.06 %), reproduces the SAOCOM 1A twilight-illumination window from published
  observations, and enforces that the prototype stays network-, DOM- and storage-free, that the published
  feed carries no trajectory or visibility field, and that `overhead-launches.js` still reports
  `visibility:'unknown'`.
- Research findings that gate Phase 5B: no operator, range authority or regulator publishes a
  time-resolved ascent trajectory, and 14 CFR part 420 Appendix B confirms one-second nominal trajectories
  exist for every licensed launch without being published; the public-domain webcast-telemetry archive
  covers roughly sixty Falcon flights from 2016 to 2019 and disagrees with the achieved orbits in one
  dimension per flight; Starship has no usable public data at all.
- Product evidence: nothing user-facing changed. No UI version bump is required because no visible text,
  comment or footer version in `index.html` changed; `npm run build` stages the documentation, the
  prototype stays out of `dist` unless imported, and `tests/migration.cjs` passes including the packaging
  and lowercase-path checks.
- Next action: hold Phase 5B at the recommended scope (anchored direction and illumination context for
  Falcon missions only), and do not add any trajectory or visibility field to the production feed until a
  profile can be anchored per flight.

## CFLab Analytics integration (verified live)

- Problem: Worth Looking Up was posting page views to the shared collector but had never been registered
  as a site there, so every request was answered with an empty `204` and nothing was recorded. The
  collector's own gate was verified rather than assumed: an unregistered source origin still returns
  `403 origin_not_allowed` with nothing stored.
- Registration (collector database, no new infrastructure or credentials): site row id 4, public tracking
  ID `as_PKAOHGDzw9aJP98hZxaPQB`, legacy key `worthlookingup` (so the already-deployed `data-site-id`
  keeps resolving), domains `worthlookingup.com` (primary) and `www.worthlookingup.com` (alias), DNT and
  GPC respected, 90-day raw retention, created by the existing global admin. Written with Wrangler into
  the `cflab-analytics` D1 database, matching exactly what the collector's `POST /api/sites` route writes.
  No Worker, token, dashboard or CFLab code change: the collector already routed and accepted this
  payload. Commands and the full record are in docs/analytics.md.
- Client: `analytics-lite.js` documents the collector and now also publishes
  `window.cflabAnalytics.track(name, props)` — the same global the collector's hosted snippet exposes —
  and honours Global Privacy Control in the browser as well as server-side. `index.html` tracks event
  detail views (category label), category selections (view name) and location searches (method only).
- Test evidence: `npm test` exit 0 (unchanged suites, including release/version and packaging checks);
  `npm run test:browser` runs 48 cases with the two new analytics cases passing and no failures;
  `tests/analytics.spec.js` asserts the page view, the three event names and properties, the collector's
  event-name pattern, that no payload contains coordinates, search text or a saved place name, and that
  Do Not Track suppresses every request.
- Git and deployment: commit `48ea501` pushed to main; CI run 38948678705 (validate and deploy) finished
  green, including `wrangler pages deploy` and `scripts/verify-production.mjs` against
  https://worthlookingup.com.
- Live verification after the deploy: the deployed page carries the five tracking calls, and a real
  browser session on production received `200` from the collector for `pageview`, `event_detail_view`,
  `location_search` and `category_select`. The rows were read back from `analytics_events` for site 4
  (props `{"category":"International Space Station"}`, `{"method":"place"}`, `{"view":"about"}`), the
  three names are registered in `analytics_event_names`, the legacy tables carry the dual-write, and the
  dashboard host answers 200 with the same totals its reporting query computes for this site.
- Next action: the human sign-in to the dashboard stays with the existing global admin, who now sees the
  site in the site list; no new user or credential was created for this integration. If a future phase
  moves to the collector's hosted snippet, `window.cflabAnalytics.track` is already the call site.


## Phase 5B: anchored historical ascent geometry (shipped)

- [x] Extended `src/launches/launch-trajectory.mjs` with the two anchoring gates and the presentation
      contract, preserving every Phase 5A protection: `planeAzimuths()` (both headings of a plane, with the
      mirror branch recorded), `terminalStateConsistency()` (vis-viva at the *reconstructed geocentric
      radius*, applicability checked first), `publicationPermissions()`, `validatePublishableProfile()`,
      `validateProfileArtifact()` and `exploreHistorical()`. `assess()` now suppresses elevation and timed
      windows when a profile's gates did not both pass, and the research fixtures validate unchanged.
- [x] Two scientific corrections over the Phase 5A prototype, both load-bearing: the plane check is
      recorded as **not applicable** when the azimuth was derived from the same inclination it would be
      tested against (a derived azimuth cannot falsify itself), and terminal comparison at the
      reconstructed radius rather than at perigee, which exposed a 4.8 % speed error that a perigee
      comparison had hidden on Iridium NEXT 4.
- [x] `scripts/build-trajectory-profiles.mjs` generates `data/launches/trajectory-profiles.json`
      (schema `worthlookingup.trajectory-profiles/1`) and the generated `docs/trajectory-profiles.md` from
      GCAT (launch instants with precision, pad coordinates, catalogued orbits) and public-domain webcast
      telemetry transcriptions; `--check` regenerates and compares, and it passes after the artifact commit.
- [x] **Three profiles passed both gates** (FormoSat-5 2017-08-24, Paz 2018-02-22, GRACE-FO 2018-05-22;
      agreement within 1.3 % in speed and 4.6 km in altitude) and **eleven candidates were measured and
      rejected** with the numbers that failed them, published in the same artifact rather than dropped:
      terminal-state failures (Iridium NEXT 4, Iridium NEXT 1, the Falcon Heavy demonstration, Jason-3),
      series that end on the ground (Iridium NEXT 8, ZUMA, SAOCOM 1A), anchors that are not insertion
      states (CRS-8, CRS-14, GPS III SV01, SES-11), and one plane disagreement with a published azimuth
      (SAOCOM 1A: a 199° press-kit azimuth against a 7.6° inconsistency with its achieved plane).
- [x] `overhead-launch-explorer.js` is the only product-facing adapter: it dynamic-imports the staged
      geometry module and fetches the reviewed artifact **only** when the historical panel is opened,
      validates the artifact, calls `exploreHistorical()` and renders the result. It performs no geometry,
      shows a direction sector with the mirror heading when a profile is direction-only, an
      elevation-against-time chart plus a time-step table when it is anchored, both gate results with their
      numbers, the provenance and licence links and the limits, and it says so plainly when the profiles
      cannot be loaded on a page that cannot serve modules.
- [x] Launch-card enhancement: one time-independent line per upcoming launch — the direction of the
      *pad*, labelled as the pad and not the flight path — plus a clearly historical link when that pad has
      a published profile. Date-only flights keep the line and still say that twilight timing cannot be
      assessed; no profile is attached to an upcoming launch and `visibility: 'unknown'` is unchanged.
- [x] Test evidence: `npm test` exit 0 (23 suites; the new `tests/launches-trajectory-profiles.cjs`
      recomputes both gates from the committed profiles rather than trusting the record, and includes
      deliberately failing cases and a tampered artifact that must be refused); `node tests/migration.cjs`
      exit 0 (the artifact, the staged module, the adapter and the generated record are in `dist`, the
      staged artifact equals the committed one, and the initial document references neither the module nor
      the profiles); `tests/launches-explorer.spec.js` covers on-demand loading, the anchored panel, a
      downgraded profile, a refused tampered artifact, the launch-card line, and 390/768/1280/1440 px in
      both themes.
- [x] Documentation: [phase-5b-release.md](phase-5b-release.md) (implementation, gates, published and
      rejected profiles, presentation, limits, catalog expansion, remaining prerequisites),
      [trajectory-profiles.md](trajectory-profiles.md) (generated provenance and validation record),
      `docs/launches.md`, `src/launches/readme.md`, `docs/launch-trajectory-feasibility.md` and `agents.md`.
- Git and deployment: commit `e71dd09` pushed to main (fetched and replayed on `origin/main`, which
  already carried the data bot's `a018717` refresh; no force, no divergence). CI run `38965166121`
  (*validate and deploy*) finished **success** in 2m19s, running `npm test`, the launch-feed check, the
  Python precision test and both builders, the whole browser suite, `npm run build`, the Cloudflare Pages
  deploy and `scripts/verify-production.mjs --wait`.
- Production verification after the deploy: `scripts/verify-production.mjs https://worthlookingup.com`
  PASS, including byte equality for the four new assets (`overhead-launch-explorer.js`,
  `src/launches/launch-trajectory.mjs`, `data/launches/trajectory-profiles.json`,
  `docs/trajectory-profiles.md`, all HTTP 200 with bytes identical to this checkout). A real browser
  session against production with an ordinary user agent on release `2026.10.16.1` reported: **0** ascent
  assets fetched before the panel was opened, 8 launch cards and 8 pad-direction lines (`Launch pad
  direction SSE (147°) at 1266 km, 6° below your horizon — the pad's direction, not the rocket's path.`),
  every card still declaring *visibility unknown*, the historical link offered only on a pad with a
  published profile, the panel showing 3 flights with the both-gates status, a chart and a 10-row
  time-step table, no unsupported claim anywhere in the rendered text, no horizontal overflow at 390 px,
  and no console or page errors.
- Staged-artifact check: `npm run build` then serving `dist/` alone produced the same result from the
  deployment's own paths (3 profiles, chart, 10 step rows, release `2026.10.16.1`, no errors), so the
  explorer works from what is actually deployed rather than only from the repository root.
- Next action: the catalog is intentionally three flights from one pad. Expanding it requires a
  licensing-clean public ascent series for a flight whose insertion orbit is catalogued directly;
  CRS-style cargo runs need a different anchor before they can carry an elevation, and nothing may be
  attached to an upcoming launch until a profile exists for that flight rather than for a sibling.


## Phase 5C: trajectory evidence audit, pad index and direction research (shipped)

- [x] Monthly, read-only evidence audit. `scripts/audit-trajectory-profiles.mjs` validates the artifact, the
      compact pad index and the review record, recomputes both anchoring gates from each profile's own
      numbers, and re-checks every published profile against fresh copies of the sources it cites (GCAT
      launch log, satellite catalogue, launch-point table, and the profile's own telemetry transcription).
      The judgement is a pure module (`src/launches/trajectory-audit.mjs`) so the failure paths are tested
      offline. Verified against live sources on 2026-10-16: 28 checks, verdict clean, exit 0.
- [x] Workflow `.github/workflows/trajectory-evidence-audit.yml`: monthly on the 3rd at 07:23 UTC plus
      `workflow_dispatch`, own concurrency group, `contents: read`, no `npm ci`, no push and no data
      artifact of its own, so it cannot block the hourly launch or celestial workflows. Manual dispatch
      verified: run `38972635477`.
- [x] Drift policy in `docs/trajectory-audit.md` for every condition — no change, source unavailable,
      changed within tolerance, changed beyond a gate, ambiguous provenance, integrity failure — with what
      stays usable, what needs a human, and which conditions fail the run. Two properties are mechanical,
      not promised: nothing is promoted (no code path raises a level or restores a withheld output) and
      nothing is demoted automatically (the audit has no code path that writes a published file).
- [x] `data/launches/trajectory-review.json` (schema `worthlookingup.trajectory-review/1`) is the only way a
      published output may be suspended while its evidence is re-checked. Applied at read time by
      `exploreHistorical({..., review})`: `suppress-elevation` withholds the chart, timed window and vehicle
      illumination while the direction and provenance stay, `suppress-all` withholds everything, the
      recorded gate results are never rewritten, and an entry in a record that does not validate suppresses
      nothing. It needs no regeneration of any other dataset.
- [x] Launch-page loading cut. The observer-facing geometry moved to `src/launches/launch-geodesy.mjs`,
      imported and re-exported unchanged by the trajectory module (all Phase 5A/5B measured values are
      identical, which is the evidence that the extraction changed no behaviour). The calendar reads the
      generated compact index `data/launches/trajectory-pad-index.json` (schema
      `worthlookingup.trajectory-pad-index/1`; ids, dates, evidence levels, output classes and the artifact's
      sha256, never a sample), and the evidence module, the artifact and the review record load only when the
      historical panel is opened. Measured with gzip: the category-specific cost of the launch calendar fell
      from 29,821 B to 6,954 B (77 % less); a reader who opens the panel transfers about 29.3 KB at that
      moment instead of paying 29.8 KB on arrival. A missing, invalid or stale index can only remove a link.
- [x] Mission-direction research and contract. `src/launches/mission-direction.mjs` (schema
      `worthlookingup.mission-direction-evidence/1`) classifies direction evidence five ways and permits
      only a published or reconstructed mission-specific direction to reach an upcoming mission's sector;
      hazard-only, family-only, inclination-derived and self-corroborating claims are refused mechanically.
      Findings source by source in `docs/mission-direction-evidence.md`: no reachable source publishes a
      mission-specific ascent direction today. The one real investigation (USSF-481, Falcon 9, SLC-4E) is
      filed as an incomplete, rejected candidate with what is missing named; the launch calendar is unchanged
      and local visibility stays unknown. Nothing imports the contract and the deployment does not ship it.
- [x] Test evidence: `npm test` exit 0 (24 suites), including the new `tests/launches-trajectory-audit.cjs`
      and `tests/launches-mission-direction.cjs`; `node tests/migration.cjs` exit 0 with the new staged-asset,
      index-digest and not-deployed assertions; browser suite 57 tests, 55 passed and the 2 opt-in live specs
      skipped, with the launches-explorer suite (9) passing on its own and the four new cases covering the
      index-only card path, a missing index, a review suspension and a stale index that is reported but not
      obeyed. The local full-suite command was killed twice by this machine while collecting the last specs,
      so the suite was run in three overlapping parts that account for all 57.
- [x] Documentation: [phase-5c-release.md](phase-5c-release.md), [trajectory-audit.md](trajectory-audit.md),
      [mission-direction-evidence.md](mission-direction-evidence.md), plus `docs/launches.md`,
      `src/launches/readme.md` and `agents.md`.
- Git and deployment: commit `9d9b0f8`, replayed on the data bot's `fffbc1a` schedule refresh and pushed
  without force; `origin/main` contains HEAD after the push. Release identifier `2026.10.16.2`.
- Next action: run `build-trajectory-profiles.mjs --check` by hand when the monthly audit reports a review
  item; broaden the catalog with further insertion-state anchors (the index makes each addition cheap);
  pursue a machine-readable hazard *direction* source as the only route to a mission-specific sector; keep
  `visibility: 'unknown'` everywhere until a specific flight's trajectory is published.

