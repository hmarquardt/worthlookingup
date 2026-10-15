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
- [ ] Complete final browser/CI validation and publish presentation portability fixes.
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
  footer height (241px vs inherited <220px). Privacy text moved to linked policy, final recheck pending.
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
verified on remote. Presentation/test portability correction commit pending at this checkpoint.
Release currently being finalized: 2026.10.15.2; first deployed artifact was 2026.10.15.1.
Canonical intended https://worthlookingup.com; currently verified accessible deployment is
https://worthlookingup.pages.dev (https://4c3d7b1d.worthlookingup.pages.dev).

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
Verify final footer locally, push presentation/CI-portability correction, watch CI, deploy release
2026.10.15.2 and re-run verify-production.mjs against pages.dev. Then record final evidence here.
DNS activation requires zone write access/dashboard changes described in deployment.md.
