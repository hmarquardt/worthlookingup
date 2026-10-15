# Deployment operations

Cloudflare account b1aa310aa0a1638d72b8b086a21e557c; Pages project worthlookingup;
zone a592818531712408128a88d9dfe3cbbc. Static host worthlookingup.pages.dev.
Canonical https://worthlookingup.com; the Pages Worker permanently redirects www while preserving paths/queries, and /overhead.html on either host becomes the canonical root with its query intact.
No API hostname, R2 bucket or duplicate analytics backend was created.

## Publish

```sh
npm ci
npm test
npm run test:browser
npm run build
npx wrangler pages deploy dist --project-name worthlookingup --branch main
node scripts/verify-production.mjs https://worthlookingup.com
```

Use an existing Wrangler OAuth login locally. Production deploys publish dist only. _headers permits
OSM Referer; revalidation prevents unversioned worker/engine caches from mixing releases. 404.html
prevents SPA fallback from returning index.html for missing workers/assets. Release is in index.html.
New Wrangler initially delegated Pages creation to Workers; project was deliberately created on
existing Pages with --force once. Do not add --force to deployment commands.

## Custom domains and DNS

Both domains are attached to the Pages project using the API. If validation is pending, add these
records in the existing Cloudflare zone (first inspect existing records; do not overwrite others):

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| CNAME | @ | worthlookingup.pages.dev | proxied |
| CNAME | www | worthlookingup.pages.dev | proxied |

Apex flattening is provided by Cloudflare. The existing OAuth token can manage Pages/custom domains
but DNS record API access returned HTTP 403. No new credentials were created. Check domain activation
in Pages after DNS resolves; verify both HTTPS endpoints and the www redirect. Do not redirect or
retire old Overhead until this passes.

## Automated deployment

CI validates scientific/pipeline/browser/migration checks on pushes and PRs and uploads static output.
For unattended publishing, set GitHub repository secret CLOUDFLARE_API_TOKEN with an existing suitable
Pages write token, then repository variable CLOUDFLARE_DEPLOY_ENABLED=true. Account ID is public config.
No secret was copied from local OAuth to GitHub. Without that configuration the deploy job explicitly
skips; validation still runs. Do not assume a push publishes production.

The daily comet/monthly meteor workflow commits only validated outputs, with normal non-force push.
Its final deploy step runs in that same workflow when enabled: GITHUB_TOKEN commits do not trigger
another push workflow. Until automation is enabled, run a local deploy after data refreshes or data
will age in production. Failed providers leave previous good artifacts and warnings intact.

Check docs/migration-status.md for actual push/deploy evidence and unresolved tasks.

## Redirect and Actions repair (2026-10-15)

Run 38762166564 deployed successfully but its verifier asserted an incorrect intermediate legacy URL.
Live inspection also found www ordinary pages returning 200: Pages does not support hostname sources
in _redirects ([official redirect contract](https://developers.cloudflare.com/pages/configuration/redirects/)).
The unsupported hostname line has been removed. The path-only legacy fallback now has an absolute
canonical target. `scripts/pages-worker.mjs` is staged as `dist/_worker.js` using Pages advanced mode;
it handles www and legacy-path 301 redirects and delegates every other request to env.ASSETS.fetch.
It deploys with the existing Pages project and credentials; no new service or zone rule is required.
This small gateway uses Pages Functions runtime; the application and scientific workers stay static.

Expected HTTPS behavior (all preserve encoded, repeated and empty query parameters):
- www /overhead.html → 301 https://worthlookingup.com/ → 200.
- apex /overhead.html → 301 https://worthlookingup.com/ → 200.
- www ordinary paths → 301 same path at canonical HTTPS apex → 200.
- canonical ordinary paths → static asset response.
Cloudflare may first upgrade HTTP to HTTPS on the same host/path; the verifier checks that full chain.
It rejects loops, nonpermanent responses, downgrades, unexpected hosts/path changes, query loss and
www serving 200. It still checks deployed HTML/assets/hashes and genuine 404 responses.

All workflows pin ubuntu-24.04 until Ubuntu 26 support is tested. Stable action majors were checked
against their official releases/action manifests: checkout@v7, setup-node@v7, setup-python@v7,
upload-artifact@v7, download-artifact@v8, all running node24. Application/tooling Node is explicitly 24,
including the data workflow's deploy step. Future upgrades must retain the host/path/query checks.
