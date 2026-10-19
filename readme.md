# Worth Looking Up

The sky has a schedule. Don't miss the good parts.

A local-first observing guide for satellite passes, Starlink trains, rocket launch schedules, planets,
meteor showers, comets and eclipses. Vanilla JavaScript, vendored calculation libraries, browser workers
and bounded local caches. No application build or account is needed to use it.

Rocket launches are published schedules, not predictions: the calendar lists what is scheduled, says
exactly how precise each schedule is, and labels local visibility unknown because confirming a visible
rocket or an illuminated plume needs the ascent trajectory. Launch schedules never enter the satellite
or celestial scores. See [docs/launches.md](docs/launches.md).

Any eligible opportunity can be exported to a calendar file built in the browser, or collected into a
session-only observing plan and downloaded as one `.ics`. Precisely timed entries use UTC instants with
stable product-owned identifiers, a published date becomes a tentative all-day placeholder, and a broad
announced period is refused rather than turned into a date. No account, OAuth, server or calendar API is
involved. See [docs/calendar.md](docs/calendar.md).

The photographic homepage now brings a compact sky guide before the detailed briefing. Tonight shows
category leaders in time order; Coming up balances distinct opportunities; launch schedules remain
separate with local visibility unknown. Build my sky guide runs the existing planners on demand.
The full weekly satellite highlight remains below the results. See [discovery contracts](docs/discovery.md)
and [Phase 3 evidence](docs/phase-3-release.md).
All categories remain directly accessible on mobile. See [design patterns](docs/design.md),
[asset provenance](assets/provenance.json), and [Phase 2 release evidence](docs/phase-2-release.md).

## Develop and verify

```sh
npm ci
npm run dev                    # http://localhost:8787
npm test                       # scientific + migration + launch regressions
npm run test:browser            # Chrome locally; Chromium in CI
node scripts/refresh-launches.mjs --check   # validate the committed launch feed offline
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
The launch feed needs a same-origin HTTP origin; on a file:// page the calendar reports that no
schedule could be loaded rather than inventing one.

Read [agent instructions](agents.md), [architecture and inventory](docs/migration.md),
[resumable status](docs/migration-status.md), [deployment](docs/deployment.md),
[storage transfer](docs/storage-migration.md), [provider terms](docs/providers.md),
[launch schedule, caching and limits](docs/launches.md),
[calendar export and observing plans](docs/calendar.md),
[scientific reference](docs/overhead.md), and the [launch engine boundary](src/launches/readme.md).
All repository paths are lowercase, including agents.md, to honor the migration naming rule.

Release: 2026.10.19.4. Canonical production host: https://worthlookingup.com/.
Extracted from Overhead without changing the scientific engines; source hashes are recorded
in docs/source-manifest.json. Reference docs describing old releases are historical.
