# Migration status

## Checklist
- [x] Inspect source, operational skills, workers, tests, providers and Cloudflare access.
- [x] Establish dependency inventory and architecture in migration.md.
- [x] Extract newest committed source and generated data without touching original app.
- [ ] Adapt tests; verify scientific behavior and worker imports.
- [x] Brand homepage, assets, analytics and storage transfer.
- [ ] Add governance, CI and static deployment packaging.
- [ ] Initial commit, ordinary push and remote verification.
- [ ] Cloudflare deployment and apex/www acceptance.

## Decisions
Preserve engine filenames/globals/data schema and storage keys. New entry index.html. Original vector imagery fallback; no unlicensed photography. Lowercase paths including documentation filenames. Canonical apex, redirect www. No API/R2 provisioning.

## Evidence and blockers
Source local 4cc4467, origin/main newest 541a970 after successful fetch (one automated data commit ahead). Original checkout has four unrelated untracked files: preserve. New main unborn, no remote configured. GitHub CLI not authenticated; Git transport and connected GitHub tooling still to inspect. Cloudflare OAuth account b1aa310aa0a1638d72b8b086a21e557c has Pages/workers access; DNS write scope not shown.

## Changed files
Initial architecture and this checklist. No application changes yet.

## Tests
Not run yet.

## Exact next action
Extract targeted tracked files from source origin/main snapshot, adapt tests to index.html, run deterministic scientific suites.

## Extraction milestone
Newest source 541a970 extracted via git archive into a temporary snapshot; original application files not changed. 13 scientific JS modules/workers, three vendored libraries, three data artifacts, all Overhead suites/fixtures, three Python builders and reference docs copied. Source hashes recorded. Original vector hero/wordmark/favicon and social SVG added; PNG rendition pending. Independent analytics identity, transfer UI and privacy/provider docs added. npm install passed (0 vulnerabilities). npm test passed all existing scientific suites; migration suite still being added. Git SSH read access to empty target verified (ls-remote exit 0), gh login unavailable but unnecessary for SSH push. Cloudflare zone active a592818531712408128a88d9dfe3cbbc; Pages creation in progress.

Exact next action: complete migration checks/CI, run all browser suites and Python checks, render social PNG, stage and deploy public bundle.

## Before initial commit
Application extraction, branding, provenance/license notices, independent analytics client identity, explicit bounded preference transfer, governance, deploy packaging, CI and refresh workflow complete. New migration static and HTTP browser checks pass. Python: all 6 precision cases and three offline artifact validation commands passed. Full browser rerun underway; worker/inline parity now passes after adapting inherited HTTP allowlist to index.html. Original frozen git-history pixel test retired because old history is absent and intentional branding differs; existing geometry/theme/contrast/state assertions retained.

Cloudflare Pages project worthlookingup created; apex and www attached (initializing). DNS API list returned 403 with existing OAuth token; exact CNAME records documented in deployment.md. No DNS edits or credentials created. Production has not yet been uploaded. CI unattended deploy requires existing Pages token as GitHub secret and enable variable; not configured.

Git: main is unborn, target remote verified empty by SSH. First push establishes upstream; skip established-history sync gate until then. Exact next action: initial commit and git push -u origin main, then publish dist to Pages and verify actual bytes plus custom-domain state.
