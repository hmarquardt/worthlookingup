# Deployment operations

Cloudflare account b1aa310aa0a1638d72b8b086a21e557c; Pages project worthlookingup;
zone a592818531712408128a88d9dfe3cbbc. Static host worthlookingup.pages.dev.
Canonical https://worthlookingup.com; www uses _redirects permanent redirect preserving path/query.
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
