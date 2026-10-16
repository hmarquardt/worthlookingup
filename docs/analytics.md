# Analytics

Worth Looking Up reports page views and a few interaction events to the shared **CFLab Analytics**
collector. No analytics backend lives in this repository, no credentials are involved, and the browser
never sees a secret: the site is identified by a public tracking ID and the collector decides what to
accept from its own configuration.

## Registration (done once, in the collector's database)

CFLab Analytics is the `cflab-analytics` Cloudflare Worker in the sibling `aismallbizguru-cflab`
repository (D1 database `cflab-analytics`, id `54e8af8e-3345-40e7-88fd-462a688421b5`). Its site registry
is two tables, `analytics_sites` and `analytics_domains`; a site is created by the dashboard or by
`POST /api/sites` with a global admin session. This site was registered through operator access to the
same database with Wrangler, writing exactly the rows that route creates:

```sh
cd ~/aismallbizguru-cflab
npx wrangler d1 execute cflab-analytics --remote --config wrangler.analytics.jsonc --command "
INSERT INTO analytics_sites (public_id, legacy_key, slug, name, timezone, active, respect_dnt, respect_gpc, raw_retention_days, created_by_user_id, created_at_ms, updated_at_ms)
VALUES ('as_PKAOHGDzw9aJP98hZxaPQB','worthlookingup','worthlookingup','Worth Looking Up','UTC',1,1,1,90,'<existing admin user id>',<ms>,<ms>);
INSERT INTO analytics_domains (site_id, hostname, kind, active, verified_at_ms, created_at_ms)
SELECT id,'worthlookingup.com','primary',1,NULL,<ms> FROM analytics_sites WHERE public_id='as_PKAOHGDzw9aJP98hZxaPQB';
INSERT INTO analytics_domains (site_id, hostname, kind, active, verified_at_ms, created_at_ms)
SELECT id,'www.worthlookingup.com','alias',1,NULL,<ms> FROM analytics_sites WHERE public_id='as_PKAOHGDzw9aJP98hZxaPQB';
"
```

| Field | Value |
| --- | --- |
| public tracking ID | `as_PKAOHGDzw9aJP98hZxaPQB` (public, safe in a browser; not a credential) |
| legacy key | `worthlookingup` — resolves the `data-site-id` already deployed, so the existing snippet kept working |
| slug / name | `worthlookingup` / Worth Looking Up |
| domains | `worthlookingup.com` (primary), `www.worthlookingup.com` (alias) — the collector refuses any other source origin |
| privacy | `respect_dnt` and `respect_gpc` on, 90-day raw retention (the collector's default and the neighbours' setting) |
| creator | the existing global admin who owns the other sites; no new user or credential was created |

## Collection

`analytics-lite.js` is the deployed client. It posts to the collector's legacy-compatible ingestion
route, which CFLab records in its own `analytics_events` model and also dual-writes to the legacy tables.
The route is chosen deliberately: the Worker already routes `lab.aismallbizguru.com/api/analytics/collect*`
to itself, so the deployed snippet, the release verification and the existing browser tests keep working
unchanged, and no new origin is loaded by the page.

| Event | Kind | Props | Where it comes from |
| --- | --- | --- | --- |
| `pageview` | pageview | — | automatic, once per load |
| `event_detail_view` | event | `category` (for example "International Space Station") | `showEvent()` in index.html |
| `category_select` | event | `view` (`tonight`, `now`, `about`) | the view tabs |
| `location_search` | event | `method` (`place`, `coordinates`, `geolocation`) | the location dialog |

Application code calls `window.cflabAnalytics.track(name, props)` — the same global name CFLab's own
hosted snippet publishes, so switching to that snippet later is a drop-in. Props never carry
coordinates, search text, favorite or saved-place names, or observation times; the test asserts that.

## Verification

```sh
npm test                                   # includes tests/migration.cjs release checks
npx playwright test tests/analytics.spec.js # payloads, event names and DNT suppression
node scripts/verify-production.mjs https://worthlookingup.com --wait   # deployed bytes, after a deploy
```

Live confirmation reads the same table the dashboard reads:

```sh
cd ~/aismallbizguru-cflab
npx wrangler d1 execute cflab-analytics --remote --config wrangler.analytics.jsonc \
  --command "SELECT event_kind, event_name, pathname, browser, os, device, country_code, site_day FROM analytics_events WHERE site_id = (SELECT id FROM analytics_sites WHERE slug='worthlookingup') ORDER BY id DESC LIMIT 20"
```

Note when probing by hand: the collector drops user agents matching `/bot|crawler|spider|preview|headless/i`
and returns `204` without recording, so a headless browser must present an ordinary user agent to test
collection, and a request from an unregistered origin returns `403 origin_not_allowed`.

## Constraints this integration keeps

* No new Worker, database, service, token or dashboard. The only infrastructure change is the site row.
* No change to CFLab. The route and the payload it accepts already existed.
* No secret in browser code: the public tracking ID is the only identifier the client knows.
* Analytics failures are silent and cannot affect the application; delivery respects Do Not Track and
  Global Privacy Control in the browser and again at the collector.
