# Phase 6D release: field readiness and destination weather

Release: `2026.10.19.2`. Phase 6C shipped the session builder; Phase 6D makes a saved session dependable
shortly before a photographer leaves home. It adds no new astronomy, no new provider, no new infrastructure,
no account and no background service.

## What changed

1. **Destination weather.** The page's existing Open-Meteo request is made for the selected session place's own
   coordinates. A verified point never inherits the visitor's home forecast. The request is issued only while a
   session is open or a saved plan is reopened, never on homepage load and never from a checklist tick. The panel
   reads cloud cover, precipitation probability, 2 m temperature, 10 m wind and gusts over the hours of the
   observing window, with the provider's own units, the fetch time and the window's valid hours. Missing series
   stay missing. No transparency, seeing, smoke, brightness or success probability is derived.
2. **Forecast horizon and cache.** The shared request asks for nine days and refuses a night outside that
   window without a request. Open-Meteo can publish up to 16 days; nine is a product choice that keeps the
   homepage payload small. A response is reused for 30 minutes under a coordinate key rounded to three decimals,
   and the page's pre-existing seven-day `overhead-cache` fallback is labelled as cached. A failed request reads
   **Forecast unavailable**, never clear skies.
3. **Before you leave.** A compact summary of destination, night, window, forecast state, access evidence,
   parking, verification date, terrain and unresolved items, followed by seven actionable checks in
   `overhead.session.readiness.v1`. A tick records an acknowledgement; it never verifies an agency rule.
4. **Access freshness.** A saved plan's planning-time `evidenceRef` is compared field by field with the current
   `data/geodata/points.json`: `current`, `changed`, `expired` or `withheld`, with both versions and a direct
   official link. Refresh preserves the planning-time snapshot; only an explicit save takes a new one. A
   withheld point keeps its saved coordinates and identity rather than moving the plan home.
5. **Offline.** The saved record still supplies place, window, direction, Moon, darkness, terrain, access
   evidence, kit, readiness ticks, notes and the last forecast. Offline now outranks a response held in memory:
   no request is attempted, and a cached answer is labelled with its age rather than shown as current. Cold start
   remains covered by the self-contained, script-free field copy; no service worker is introduced.
6. **Checklist and field view.** Native labels around native checkboxes, 44 px minimum rows, whole-row toggling,
   visible focus and persistent ticks. The field summary leads with destination, window, best moment, direction,
   Moon, forecast state and access warnings; provenance stays below.
7. **Refresh.** Astronomy, access, weather and terrain are reported separately. Nothing says "everything
   updated". Notes, kit and identity survive; a night that loses its window keeps the saved record for reference
   while actions that need a live window stay disabled.
8. **Print and calendar.** The printed sheet carries the forecast state, fetch age and valid interval, access
   date and restrictions, parking caveats, terrain uncertainty, current-versus-saved access status and the
   outstanding checks. Calendar output still goes only through `overhead-calendar.js` and adds no departure,
   driving or camping interval.

## Faults found and fixed during this phase

- Refresh rewrote the plan's `evidenceRef` with the newly published record, so a saved-versus-current comparison
  always looked current. The refresh now keeps the planning-time snapshot; the browser test drives a valid
  parking change and asserts that both versions appear.
- An in-memory forecast fetched before the connection dropped was still presented as current while offline. An
  offline branch now takes precedence, makes no request, and shows the saved forecast under its own heading.
- The first version of the save/compare browser test mutated parking to a value the artifact gate correctly
  rejects. The test now uses two publishable classifications, so it exercises the comparison rather than the
  artifact refusal.

## Verification (local)

- `npm test` — exit 0. The session suite now includes forecast window summarisation, missing-series refusal,
  horizon refusal, field-by-field access comparison, evidence fingerprint, readiness storage, migration,
  offline field copy and the no-invented-brightness guard.
- `npx playwright test tests/session.spec.js` — 24 passed, exit 0, including destination coordinates, home
  forecast not reused, 30-minute cache expiry, provider failure, future date outside the horizon, partial
  refresh, changed and withheld points, offline reading and checklist editing, field-copy cold start, print,
  calendar, four widths in both themes, keyboard use and 44 px rows at 390 px.
- `npm run build` and `npm run check` — exit 0; staged `dist/` carries release `2026.10.19.2`.
- Full browser suite — 109 tests in 16 files; 102 passed and the two live-source tests skipped before a local
  teardown stall, and the remaining 7 homepage/discovery tests passed in a separate run. No failure was observed.
  The authoritative full run is the GitHub Actions Chromium job recorded below.

## Measurements

- Compressed JavaScript: `index.html` 83,983 → 91,080 bytes gzip (+7,097); `overhead-sessions.js`
  9,358 → 15,981 bytes gzip (+6,623), still fetched lazily behind **Plan a Photography Session**.
- Local Chromium at 390×844, one session: homepage ready 146 ms; builder cold open 82 ms; close/reopen 52 ms;
  one session module fetch; one existing home weather request at boot; one destination weather request after
  selecting Camp Cadiz; zero weather requests across 20 checklist/readiness ticks; zero horizontal overflow.
- No polling or background monitoring. A reload of a saved plan is the only automatic weather touch, and it
  obeys the horizon and cache rules.

## Storage and files

- `overhead.session.readiness.v1` is the only new storage key (seven booleans). Existing keys, bounds and
  identity are unchanged: `overhead.session.list.v1` (12 records), `overhead.session.current.v1`,
  `overhead.session.checklist.v1`.
- Changed: `index.html`, `overhead-sessions.js`, `tests/photography-sessions.cjs`, `tests/session.spec.js`,
  `agents.md`, `docs/photography-sessions.md`, `docs/milky-way.md`, `docs/providers.md`,
  `docs/migration-status.md`.
- No new file, asset, dependency, Worker, KV, D1, R2, secret or scheduled job.

## Known limitations

- The forecast is a model grid, not a measurement at the point; cloud cover is not transparency, seeing or
  smoke, and a low cloud figure is not a guarantee.
- The product requests nine of the provider's available sixteen days.
- Offline cold start requires the downloaded field copy; the live application must have been loaded once.
- Access evidence is Worth Looking Up's published record, not the managing agency, and expires after a year.
- Local artificial sky brightness remains unassessed, and no terrain model sees trees or buildings.
- Only three observation points are published, all in the studied region.

## Deployment

Pending. This section will record the commit, GitHub Actions run and the independent production checks.
