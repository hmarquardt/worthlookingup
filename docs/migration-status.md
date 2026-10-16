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
