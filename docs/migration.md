# Worth Looking Up migration architecture

Source: hmarquardt/junkdrawer, origin/main 541a970 (2026-10-15 data refresh), inspected local application revision 4cc4467. Original checkout and published Overhead remain intact.

## Decisions and inventory

| Dependency | Disposition | Ownership and constraints |
| --- | --- | --- |
| overhead.html | Move as index.html | Vanilla JS and inline CSS; no framework or runtime build. |
| overhead-engine.js, overhead-lifecycle.js, overhead-weekly.js, overhead-trains.js | Move unchanged | Orbital geometry, lifecycle, scoring, weekly interpretation, train geometry. |
| overhead-objects.js | Move unchanged | Optional spacecraft metadata enrichment; no location sent. |
| overhead-astro.js, overhead-opportunities.js, overhead-planets.js, overhead-meteors.js, overhead-comets.js, overhead-celestial-plan.js | Move unchanged | Celestial calculation and ranking boundaries. |
| overhead-worker.js, overhead-celestial-worker.js | Move unchanged | Root-relative-to-document worker URLs; importScripts paths retained. HTTP hosting is required for full train support; fallback retained. |
| vendor/overhead/{satellite-6.0.1.min.js,suncalc-1.9.0.js,astronomy-2.1.19.min.js} | Move | Pinned local libraries: MIT, BSD-2-Clause, MIT respectively; retain notices. Astronomy notice is embedded. |
| data/overhead/{comets.json,comet-ephemerides.json,meteor-showers.json} | Move | Independently published same-origin data; do not edit generated scientific records. Preserve schema IDs as compatibility strings. |
| tools/overhead_*.py, tests/overhead*, tests/test_overhead*, tests/fixtures/overhead* | Move/adapt | Preserve scientific fixtures and deterministic assertions; point UI tests to index.html. Python requests/pypdf; browser Playwright/Chrome. |
| .github/workflows/overhead-data.yml | Move/adapt | Daily comet, monthly meteor refresh; atomic validated outputs, ordinary bot pushes. Deploy data commits explicitly because GITHUB_TOKEN pushes do not trigger other workflows. |
| docs/overhead*.md and validation JSON | Move | Algorithm/reference history; mark historical release claims as historical. |
| CelesTrak GP / SupGP / SATCAT | External service | Direct browser requests; GP 4h, SupGP 2h, launch SATCAT 24h, object identity 21d. Follow source freshness and rate limits; no SLA or commercial redistribution assumption. |
| Open-Meteo forecast/geocoding | External service | Forecast sends coordinates; search sends query. 30min forecast cache; free endpoint has noncommercial restrictions, commercial release requires provider review/plan. |
| Wikidata SPARQL | External service | Selected spacecraft identifiers only, CC0 structured data, 21d identity cache; respect query service limits. |
| MapLibre 5.6.1/jsDelivr, OSM raster tiles | External service | Optional map only; preserve attribution, conservative gestures; no prefetch/offline tile cache. Tile policy and CDN availability apply. |
| NASA/JPL SBDB/Horizons, COBS, IMO/MDC/archive | External pipeline sources | Build-time only, provenance hashes/timestamps retained. Data rights distinct from software license; commercial redistribution review required for COBS and calendar source material. |
| analytics-lite.js and lab.aismallbizguru.com collector | Move client / share independent service | New worthlookingup identity, locally hosted tracker, existing independent collector. DNT honored. Verify collector accepts identity; never depend on Junk Drawer hosting. |
| overhead.* localStorage, overhead-cache and overhead-object-meta IndexedDB | Retain names on new origin | Origin isolates ownership. Preferences/sites/favorites local; response and metadata caches bounded. Offer explicit allowlisted export/import; never delete original data or copy caches/tracker IDs. |
| Junk Drawer navigation/registry/storage manager/deploy markers | Retire | No registry, landing-page navigation or runtime dependency. Independent release marker. |
| api.worthlookingup.com, data.worthlookingup.com | Defer | No speculative API, R2 bucket or DNS record; same-origin datasets suffice. |

## Hosting and releases

Cloudflare static hosting; canonical https://worthlookingup.com, www permanently redirects preserving path/query. Publish only an explicit static allowlist, never repository root (tests, tools, credentials). CI: Node scientific tests, Python validation, deterministic browser tests, asset/worker/origin checks. Preserve date-based release YYYY.MM.DD.N. Check remote before ordinary push; never force/reset/clean. Use Cloudflare credentials already available; do not rotate credentials. Verify deployed HTML, workers, data, analytics identity, TLS and both hostnames.

## Product and future boundary

Consumer sky field guide: compact editorial sky illustration and wordmark, immediate access to recommendations, existing light/dark behavior. Use original vector art as a licensed fallback if photography cannot be verified. All introduced paths lowercase; documentation names are migration.md, migration-status.md and agents.md to honor the explicit lowercase rule.

Future launch schedules belong in src/launches/ with a separate normalized schedule/cache interface, then a distinct opportunity adapter. Powered ascent/plume geometry and confidence must remain separate from orbital passes; no launch feature in this migration.

## Risks

Origin storage does not transfer automatically. Free API availability does not establish commercial rights. Analytics collector identity/CORS must be checked. CI secrets may require owner configuration even when local OAuth deploys work. Source history contains older descriptions predating celestial features; preserve as reference, add current entry documentation. Avoid new tracking, secrets, inaccurate event data or precision claims.

## Photographic discovery presentation
Release 2026.10.15.4 keeps calculation/scoring modules unchanged. index.html owns the hero,
location/category navigation and existing weekly summary placement; assets/brand/identity.css
provides the final presentation layer after application tokens. Responsive photography is local
and rights-tracked in assets/provenance.json. See design.md and phase-2-release.md for patterns
and evidence. No cross-category ranking or new background data requests were introduced.

## Discovery adapter
`overhead-discovery.js` is a pure presentation module with no requests, storage, astronomical math
or new scoring. index.html maps retained source results, keys session plans by observer/settings/
weather generation/local night, orchestrates the explicit guide action through existing category
requests, and restores source IDs for navigation. No worker, orbital or celestial source hash changed.
See discovery.md for selection, uncertainty and navigation invariants.
