# Migration status — 2026-10-15

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
