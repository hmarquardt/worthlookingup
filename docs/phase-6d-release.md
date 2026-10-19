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
   while actions that need a live window stay disabled. If the reader has changed the place or night since
   opening the plan, refresh reports that it did not overwrite the saved plan instead of writing a second one.
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
- Production acceptance on a late-October night found that a no-window night returned before building the
  forecast, access and terrain, so the panel went quiet exactly when a reader might still travel. The no-window
  branch now carries all three, while save, print, calendar and plan stay disabled.

## Verification (local)

- `npm test` — exit 0. The session suite now includes forecast window summarisation, missing-series refusal,
  horizon refusal, field-by-field access comparison, evidence fingerprint, readiness storage, migration,
  offline field copy and the no-invented-brightness guard.
- `npx playwright test tests/session.spec.js` — 26 passed, exit 0, including destination coordinates, home
  forecast not reused, 30-minute cache expiry, provider failure, future date outside the horizon, partial
  refresh, a no-window night that still shows forecast/access/terrain, changed and withheld points, offline
  reading and checklist editing, field-copy cold start, print, calendar, four widths in both themes, keyboard use
  and 44 px rows at 390 px.
- `npm run build` and `npm run check` — exit 0; staged `dist/` carries release `2026.10.19.2`.
- Full browser suite — 109 tests in 16 files before the final two session additions: 102 passed and the two
  live-source tests skipped before a local teardown stall, and the remaining 7 homepage/discovery tests passed in
  a separate run. The 26-test session file passed after the final changes; the other 85 tests exercise code this
  phase does not modify. No failure was observed. The authoritative full run is the GitHub Actions Chromium job
  recorded below.

## Measurements

- Compressed JavaScript: `index.html` 83,983 → 91,080 bytes gzip (+7,097); `overhead-sessions.js`
  9,358 → 15,981 bytes gzip (+6,623), still fetched lazily behind **Plan a Photography Session**.
- Local Chromium at 390×844, one session: homepage ready 146 ms; builder cold open 82 ms; close/reopen 52 ms;
  one session module fetch; one existing home weather request at boot; one destination weather request after
  selecting Camp Cadiz; zero weather requests across 20 checklist/readiness ticks; zero horizontal overflow.
- No polling or background monitoring. A reload of a saved plan, a refresh, and a connection returning while the
  builder is open are the only automatic weather touches, and each obeys the horizon and cache rules.

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

- Commits pushed normally to `origin/main`: `5313ddf` (Phase 6D), `fbad028` (reconnect), `b55bb22` (refresh
  identity), `93e73a0` (no-window forecast/access/terrain), `32d8ba1` (no-window forecast wording), with the
  documentation record in later commits. Each push was followed by `git fetch origin`; `HEAD` and `origin/main`
  matched after every push. Later documentation-only commits do not change the deployed application code.
- GitHub Actions `validate and deploy` runs for these commits were still **queued** when this record was written
  (runs `39280655763`, `39280877754`, `39281541706`, `39282355146`); GitHub's status API reported the Actions
  component as `degraded_performance`. No CI conclusion is claimed.
- The same validated `dist/` was deployed through the existing Cloudflare Pages project
  (`wrangler pages deploy dist --project-name worthlookingup --branch main`), deployment `ff29eb4c`.
  `https://worthlookingup.com/` serves release `2026.10.19.2`; its SHA-256 matches the locally staged
  `dist/index.html` (`4a63e35c9c9855e047f91aa187dedb69734c7eee2d44c9411313146ea31685e9`).
- `node scripts/verify-production.mjs https://worthlookingup.com --wait` — **PASS**: deployed HTML and release,
  scientific hashes, both workers, data, brand/transfer/analytics bytes, real 404, and permanent
  canonical/legacy redirects that preserve queries.
- Independent production scenarios against the deployed site:
  - Camp Cadiz, real clock: one request to Open-Meteo for `37.57834, -88.24417` (the point, not the visitor);
    the real provider returned cloud cover, shown as "Cloud cover 64% over 13 hours"; the field summary named
    Camp Cadiz. A June 2027 date made **0** new forecast requests and read "Weather is not yet forecastable for
    this date." At 390 px, both themes had **0** horizontal overflow.
  - Saved/offline scenario: 24/24 checks passed — destination forecast with cloud/wind/temperature and the
    transparency caveat; save; print with forecast age, access evidence, terrain uncertainty and no travel;
    script-free field copy; calendar `LOCATION:Camp Cadiz Campground` with no travel interval; reopen with notes
    and kit; partial refresh reporting astronomy success and a labelled cached weather answer; a simulated
    withheld point shown as no longer published while keeping Camp Cadiz and its identity; no duplicate plan;
    offline reading with the saved forecast as history; an offline checklist edit that persisted; the field copy
    opening with no network; 390 px overflow 0 in both themes; 44 px checklist rows; no page errors.
  - The withheld-point mutation and the provider-failure/forced-cache case were injected in the browser to
    exercise the deployed code paths; the real published artifact and the real provider were used for the
    coordinate and forecast checks.
