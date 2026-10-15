# Rocket launches

Phase 1 of the launch feature. A scheduled launch is worth knowing about even when it is not visible
from where you are; a launch with favourable local geometry is a possible observing opportunity. This
documentation keeps those two ideas separate and records what is deliberately not claimed.

## Provider and API

| Item | Value |
| --- | --- |
| Provider | [Launch Library 2](https://thespacedevs.com/llapi) by The Space Devs |
| API version | `2.3.0` (verified 2026-10-15; `2.2.0` now returns HTTP 404 and is listed as retired in the engine) |
| Endpoint used | `GET https://ll.thespacedevs.com/2.3.0/launches/?limit=100&mode=normal&ordering=net&net__gte=…&net__lte=…` |
| Announced total | `GET https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=1&mode=list` (one tiny request for context) |
| Rate limit | 15 unauthenticated requests per hour; higher rates need a paid Patreon tier. `limit` is capped at 100 records per page. |
| Attribution | "Launch data: The Space Devs Launch Library 2" is carried inside every feed and rendered in the calendar. |
| Commercial use | Free access is **not** a commercial redistribution grant. The restriction is carried in `source.rights` and repeated in the UI; review it before any monetization. |
| Archived community SpaceX API | Not used, for future launches or anything else. |

Nothing in the browser calls the provider, and the community SpaceX API is not consulted at all.

## Architecture

```
Launch Library 2
      │  (server-side only)
      ▼
scripts/refresh-launches.mjs ──► data/launches/upcoming.json   (scheduled ingestion, committed artifact)
      │                                   │
      │                                   ├─────────────► served as a static asset
      ▼                                   ▼
src/launches/launch-feed.mjs  ◄── pages-worker.mjs  (staged as dist/_worker.js)
   normalization, precision,          GET /api/launches.json
   status, dedupe, validation,        edge cache → KV (optional) → committed feed → bounded upstream refresh
   merge, stale policy                        │
                                              ▼
                                     overhead-launches.js  (browser module)
                                     windows, precision-aware labels, proximity, twilight, no visibility claim
                                              │
                                              ▼
                                          index.html  →  ROCKET LAUNCHES category
```

`src/launches/launch-feed.mjs` is the single implementation of the schedule rules. The Pages Worker,
the scheduled refresh script and the Node regression tests all import that one file, so there is no
second copy of the normalization logic to drift.

## The public feed

`GET https://worthlookingup.com/api/launches.json` (schema `worthlookingup.launches/1`):

```json
{
  "schema": "worthlookingup.launches/1",
  "available": true,
  "generated_at": "2026-10-15T16:32:09.063Z",
  "refresh_interval_minutes": 30,
  "stale_after_minutes": 180,
  "stale": false,
  "stale_reason": null,
  "source": { "name": "Launch Library 2", "api_version": "2.3.0", "attribution": "…", "rights": "…", "sha256": "…", "retrieved_at": "…" },
  "stats": { "count": 146, "with_published_time": 7, "with_published_date": 15, "period_only": 131, "announced_total": 473, "window_days": 180 },
  "launches": [ { "id": "…", "name": "Falcon 9 Block 5 | USSF-481", "net": "…", "precision": { "kind": "second", "exact": true }, "status": { "kind": "scheduled" } } ],
  "served_by": "cached",
  "served_from": "committed-feed",
  "served_at": "…"
}
```

`data/launches/upcoming.json` is the same document without the `served_*` fields. It is the durable
artifact the scheduled job publishes and the copy the Worker falls back to. Every launch carries a
stable provider id, mission and vehicle, provider and launch site, the provider's timestamp and
scheduling precision, the provider status, official links when the provider publishes them, and any
detected schedule change.

### Cache intervals and refresh behaviour

| Layer | Interval | Behaviour |
| --- | --- | --- |
| Browser | 15 minutes in the existing bounded cache (`overhead-cache`, IndexedDB, max 32 responses / 7 days) | Fetched only when the ROCKET LAUNCHES category is opened. A stale copy is reused, with its age shown, rather than dropped. |
| Edge cache (`caches.default`) | 900 s for a served copy, 120 s for a degraded copy, 60 s for an unavailable response | Shared by every visitor in that colo, so visitors never reach the provider. |
| KV (`LAUNCHES` binding, optional) | Stores the last good feed with `stored_at` | Preferred when it is newer than the committed feed. Without the binding the endpoint still works. |
| Upstream refresh | Attempted only when the freshest available copy is older than 30 minutes; at most 2 pages plus the announced-total request (3 requests) | Never per visitor, never per request. |
| Scheduled ingestion | Hourly GitHub Actions workflow; at most 3 launch pages plus the announced-total request (4 requests) | Commits a validated `data/launches/upcoming.json` and deploys it when it changed. |

## Scheduling uncertainty (the part that matters most)

LL2 publishes a NET (no earlier than) value with a precision level. **Coarse precisions carry the end
of the announced period as the timestamp** — a "Year" record carries 31 December, a "Quarter 4" record
also carries 31 December, and a "Month" record carries the last day of that month. Those timestamps are
placeholders, not launch dates.

| Precision | Treatment |
| --- | --- |
| Second / Minute / Hour | A published time. Shown in local time (reader and pad), with a countdown. |
| Day | A published date with no time. Shown as a UTC date, labelled "no time published", and never given a countdown or a twilight claim. |
| Month / Quarter / Half / Year | A period only. Shown as "October 2026", "Q4 2026", "second half of 2026" or "2026", listed under *Announced with a period, not a date*, and never placed on a calendar day. |
| Unrecognised | Listed as "no date published yet". Never promoted to a date. |

Postponements are reported by comparing each refresh with the previously published feed: a moved NET
is described as "Rescheduled later by … (was …)", and a changed provider status is described in the
provider's own words. A flight the provider no longer lists simply stops appearing. A published time
that has passed is described as "Published time has passed; the provider has not published an outcome
or a new time yet" — never as a liftoff.

## Local visibility

Phase 1 states exactly two measurable things about a launch and the reader's location:

1. the great-circle distance to the launch pad (only when the provider publishes pad coordinates), and
2. the Sun's altitude at the reader's location at the published time (only when a time was published).

Everything else is labelled **unknown**, in the card and in the feed's own copy: proximity to a launch
site is not evidence of a visible rocket, and an illuminated exhaust plume needs the powered ascent
trajectory, staging and Earth-shadow geometry, which this provider does not publish. No bearing,
elevation, duration, probability or brightness is ever produced, and launch schedules never enter the
satellite or celestial scores. `tests/launches-relevance.cjs` enforces this, including a check that any
sentence containing the word "visible" is a denial.

A launch whose published time has just passed stays listed for two hours (`RULES.passedGraceHours`) so
a pending confirmation stays visible instead of vanishing.

## Cloudflare resources and deployment

| Resource | Status |
| --- | --- |
| Pages project `worthlookingup` | Existing; unchanged |
| `dist/_worker.js` (advanced mode) | Existing Worker, extended with `GET /api/launches.json`; canonical redirects are unchanged |
| `dist/src/launches/launch-feed.mjs` | Staged by `scripts/build.cjs` so the Worker's relative import resolves inside the deployment; Wrangler bundles it into `_worker.js` at deploy time |
| `dist/data/launches/upcoming.json` | Staged static artifact |
| KV namespace `LAUNCHES` | **Not created**; optional, see below |
| New hostname, DNS record, R2 bucket | None |

## Outstanding infrastructure configuration

* **KV namespace (optional).** Create a namespace and bind it as `LAUNCHES` on the Pages project
  (`npx wrangler kv namespace create LAUNCHES`, then a `kv_namespaces` entry in `wrangler.toml`) to
  share the last good feed between colos and coordinate refreshes. Without it the endpoint still serves
  the edge cache, the committed feed and its own bounded refresh; only cross-colo sharing of an
  on-demand refresh is missing.
* The scheduled workflow reuses the existing `CLOUDFLARE_API_TOKEN` secret and
  `CLOUDFLARE_DEPLOY_ENABLED` variable, exactly like the celestial data workflow.
* Nothing else is required: the feed is same-origin and no credential was created or rotated.

## Future: trajectory-aware visibility (Phase 2 design, not implemented)

See [launch-visibility.md](launch-visibility.md) for the required inputs, the separate confidence model
for launch observations and illuminated plumes, and the explicit non-goals. Nothing in Phase 1 should
be read as a promise of that capability.


### Failure behaviour

* Provider 429 → the last good copy is served with `stale: true` and a `stale_reason` naming the rate limit.
* Provider 5xx, timeout, unreachable, malformed payload or an empty page → the same, with the failure named.
* No copy anywhere → HTTP 200 with `available: false`, an explicit notice ("not an empty schedule") and no launches.
* A committed feed that fails validation is ignored and replaced by a fresh refresh; it is never served.
* The scheduled job refuses to write an artifact that fails validation or contains no launches, so a
  failed retrieval leaves the previous file and the previous deployment untouched.
* The reader always sees the age of the schedule, and a warning once it is older than 180 minutes.

