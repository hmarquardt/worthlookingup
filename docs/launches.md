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
| Upstream refresh from Cloudflare | Only when the freshest available copy is **stale** (older than 180 minutes), so a broken scheduled job cannot leave the calendar silently old | At most 2 pages plus the announced-total request. In normal operation the provider is never contacted from Cloudflare: the committed feed is kept current by the scheduled job, and Cloudflare's egress addresses are shared with other tenants, so the provider's per-IP allowance is not spent on routine freshness. |
| Scheduled ingestion | Hourly GitHub Actions workflow; at most 3 launch pages plus the announced-total request (4 requests) | Commits a validated `data/launches/upcoming.json` and deploys it when the schedule content changed. An unchanged schedule is republished for freshness at most once every 120 minutes instead of every hour, so the deployed copy never approaches the 180-minute horizon and no commit or deployment is created for a schedule that did not move. This is the primary freshness mechanism, on its own IP. |

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

## Calendar export (Phase 4)

An exact published time can be exported as a calendar entry. It is always `STATUS:TENTATIVE`, carries
no `DTEND` (a target time is not a duration), and its description names the provider, the provider's
status, the record's last-update time, the scheduling precision, any postponement since the previous
refresh, the age of the schedule, and the fact that a published target time is not a confirmed
liftoff. Local visibility is stated as unknown in the same words the card uses.

A launch with only a published date exports an all-day placeholder (`DTSTART;VALUE=DATE`) that says it
is tentative and shows no time of day. A month, quarter, half-year or year is **refused**: no date is
invented for it, and the card says why. A launch the provider reports as successful, failed or
under way, or whose published time has already passed, is not exported at all.

The UID is derived from the provider's launch identifier, so a postponement keeps the same calendar
entry. A later download is a revision of that entry, not a second event, in clients that match on
`UID`; a client that does not may show both copies. Nothing here promises automatic synchronization.
See [calendar.md](calendar.md).

## Future: trajectory-aware visibility (Phase 2 design, not implemented)

See [launch-visibility.md](launch-visibility.md) for the required inputs, the separate confidence model
for launch observations and illuminated plumes, and the explicit non-goals. Nothing in Phase 1 should
be read as a promise of that capability.


### Failure behaviour

* Provider 429 → the last good copy is served with `stale: true` and a `stale_reason` naming the rate limit. This was observed in production on 2026-10-15: Launch Library 2 rate-limits the shared Cloudflare egress address, so the endpoint was changed to refresh upstream only when its copy is genuinely stale rather than merely older than the refresh interval. The scheduled job, which has its own address, is the primary freshness mechanism.
* Provider 5xx, timeout, unreachable, malformed payload or an empty page → the same, with the failure named.
* No copy anywhere → HTTP 200 with `available: false`, an explicit notice ("not an empty schedule") and no launches.
* A committed feed that fails validation is ignored and replaced by a fresh refresh; it is never served.
* The scheduled job refuses to write an artifact that fails validation or contains no launches, so a
  failed retrieval leaves the previous file and the previous deployment untouched.
* The reader always sees the age of the schedule, and a warning once it is older than 180 minutes.

### When an hourly refresh publishes, and when it does not

`generated_at` records when the provider was last read successfully, so it must stay accurate or the
calendar would warn about a schedule that is in fact current. It is therefore volatile by nature, and a
naive comparison sees a change every hour: measured over sixteen consecutive hourly commits, **eight
carried identical schedule content** and differed only in timestamps and provenance digests.

`effectiveScheduleDigest` (in `src/launches/launch-feed.mjs`) digests only what a reader can see — the
normalized launch records, including status, precision, net, window, pad, links, last-update and any
detected change — and excludes `generated_at`, `retrieved_at`, the upstream payload digest, page
counts, the announced total and the derived stats. `publishDecision` then applies one rule:

| Situation | Result |
| --- | --- |
| The schedule content changed | Publish: commit and deploy. |
| Unchanged, and **everything a reader can get** is younger than the 120-minute freshness deadline | **Defer**: nothing is written, so no commit and no deployment are created. |
| Unchanged, but the committed artifact *or the deployed copy* is at or past the deadline | Publish, so the schedule a reader actually receives never approaches the 180-minute staleness horizon. |
| The deployed copy could not be read, or no usable previous generation time, or no candidate | Publish (fail closed). |

The decision deliberately uses the **older** of the committed artifact and the copy served at
`/api/launches.json`, because those two can diverge. During the 2026-10-16 incident the hourly job kept
committing a fresh artifact while every deployment failed, so the committed feed looked healthy while
readers were served an eleven-hour-old schedule flagged stale. Deferring on the committed artifact alone
would never have repaired that, so the workflow measures the deployed age before each refresh and the
pipeline republishes whenever the served copy is stale — including when the schedule content itself has
not changed. A deployed age that was measured but is unusable is never treated as fresh.

The committed artifact never ages beyond 120 minutes in normal operation, so the deployed copy stays
inside the staleness horizon and the Cloudflare endpoint still never spends its own provider allowance
on routine freshness. A run that defers exits successfully and says so, in the log and in the workflow
summary; it is not a failure and it does not leave the artifact dirty.

### The ingestion workflow's own validation gate

Publication validates this pipeline only: `scripts/refresh-launches.mjs --check` (the artifact itself),
`tests/launches-feed.cjs` (the schedule engine), `tests/launches-relevance.cjs` (presentation rules) and
`tests/launches-worker.cjs` (the endpoint), then `npm run build` and the Pages deployment. The complete
browser and scientific regression suites belong to the separate validation workflow. An unrelated
vertical's defect must never gate an hourly data publication, because that would leave the site serving
an aging schedule.

The publish step pushes with a bounded fetch-and-replay loop (never a force): `main` is shared with the
celestial data bot, so a rejected push is followed by `git fetch origin main` and `git rebase
origin/main`, retried up to three times. A conflict aborts the rebase and fails the run with nothing
pushed and no history rewritten. Test fixtures and browser fixtures never read the launch list out of
`data/launches/upcoming.json`; they use fixed records, because the artifact's contents change hourly as
real launches fly. Only content-independent invariants (schema validity, provider credit, counts
relative to the artifact itself) may be asserted against the live artifact.


## Trajectory research (Phase 5A) and anchored historical profiles (Phase 5B)

The scheduling boundary above is unchanged, and local visibility is still reported as unknown for every
launch. What a future trajectory-aware layer would need, what public data actually exists for it, and how
far the geometry can be taken honestly are recorded in
[launch-trajectory-feasibility.md](launch-trajectory-feasibility.md), with the source and licensing
inventory in [launch-trajectory-sources.md](launch-trajectory-sources.md). The geometry module
(`src/launches/launch-trajectory.mjs`) began as a research prototype and now carries the two anchoring
gates; it still produces no visibility statement and never enters satellite or celestial scoring, and the
published feed gained no trajectory or visibility field.

Phase 5B publishes a small, reviewed set of **past** Falcon ascents. Three profiles passed both anchoring
gates and may show a reconstructed observer elevation and a timed window; every candidate that failed is
published in the same artifact as a direction-only entry with the numbers that failed it. The feed is
untouched: no profile is attached to an upcoming launch, and `visibility: 'unknown'` still stands in
every card. Regenerate the profiles with
`node scripts/build-trajectory-profiles.mjs` and review
[phase-5b-release.md](phase-5b-release.md) and the generated [trajectory-profiles.md](trajectory-profiles.md)
before publication.

Phase 5C keeps it sustainable and cheap. `src/launches/launch-geodesy.mjs` now holds the
observer-facing geometry, imported and re-exported unchanged by the trajectory module, so the launch
calendar can draw the pad line without downloading the evidence machinery. The calendar reads the
generated compact index `data/launches/trajectory-pad-index.json` (ids, dates, evidence levels, output
classes and the artifact's sha256 — no samples, no elevations, no azimuths) instead of the profile
artifact, and a missing, invalid or stale index can only remove a historical link. A published output can
be suspended, never rewritten, through `data/launches/trajectory-review.json`, a hand-committed and
validated record that the panel applies at read time. The monthly, read-only evidence audit
(`scripts/audit-trajectory-profiles.mjs`, policy in [trajectory-audit.md](trajectory-audit.md)) re-checks
gates, anchors, provenance and drift, and never promotes or demotes anything by itself. Whether an
upcoming Falcon mission ever has a mission-specific ascent direction is answered, source by source, in
[mission-direction-evidence.md](mission-direction-evidence.md): today it does not, so the contract in
`src/launches/mission-direction.mjs` is a schema and a set of refusals rather than a feature. See
[phase-5c-release.md](phase-5c-release.md) for the measured effect on the launch page (77 % less
category-specific transfer).

What the calendar shows because of this work, and nothing else:

* One line per upcoming launch with a pad: `Launch pad direction <compass> (<deg>) at <km>, <deg> above
  your horizon — the pad's direction, not the rocket's path.` It is time-independent, so a date-only
  launch keeps it, and no lighting statement is invented for a flight without a published time.
* A *Historical Falcon ascents* panel, opened from the launch calendar, which shows one reviewed past
  flight at a time with its direction, its reconstructed geometry where the gates allowed it, its
  illumination context, its provenance and its limits. Both the profile data and the geometry module are
  fetched only when the panel is opened.

