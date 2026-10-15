# Worth Looking Up

The sky has a schedule. Don't miss the good parts.

A local-first observing guide for satellite passes, Starlink trains, planets, meteor showers,
comets and eclipses. Vanilla JavaScript, vendored calculation libraries, browser workers and
bounded local caches. No application build or account is needed to use it.

## Develop and verify

```sh
npm ci
npm run dev                    # http://localhost:8787
npm test                       # scientific + migration regressions
npm run test:browser            # Chrome locally; Chromium in CI
python3 -m pip install -r requirements.txt
python3 tests/test_overhead_comets_precision.py
python3 tools/overhead_comets_build.py --check
python3 tools/overhead_comets_build.py --no-network
python3 tools/overhead_meteors_build.py --check
npm run build                  # explicit public allowlist → dist
npm run deploy                 # existing Cloudflare login or CI token
```

Install Chrome locally or run `CI=1 npx playwright install chromium` and use `CI=1` for browser
checks. Live-provider incident tests require `OVERHEAD_LIVE=1` and are skipped by default.
Use HTTP: opening index.html as a file preserves fallback calculations but disables Train Watch.

Read [agent instructions](agents.md), [architecture and inventory](docs/migration.md),
[resumable status](docs/migration-status.md), [deployment](docs/deployment.md),
[storage transfer](docs/storage-migration.md), [provider terms](docs/providers.md),
[scientific reference](docs/overhead.md), and [future launches](src/launches/readme.md).
All repository paths are lowercase, including agents.md, to honor the migration naming rule.

Release: 2026.10.15.2. Canonical production host: https://worthlookingup.com/.
Extracted from Overhead without changing the scientific engines; source hashes are recorded
in docs/source-manifest.json. Reference docs describing old releases are historical.
