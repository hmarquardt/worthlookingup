# Calendar export and observing plans

Phase 4 of Worth Looking Up: making an observing opportunity actionable without inventing precision.
Plan recorded before implementation on 2026-10-15; implemented in release 2026.10.15.6.

## What this adds

| Surface | Action | Result |
| --- | --- | --- |
| Discovery guide card | Add to calendar (.ics) | One `.ics` download for that opportunity |
| Discovery guide card | Add to observing plan | Selection kept in this browser session only |
| Celestial opportunity card | Both actions | Same rules as the guide |
| Satellite pass card and pass dialog | Both actions | Rise-to-set window with calculated bearings |
| Launch card | Add to calendar (.ics) | Tentative published target time, or a tentative all-day date |
| Launch card (period only) | None | The reason is stated instead of a button |
| Observing plan panel | Download calendar file (.ics) | One file with one `VEVENT` per selection |
| Observing plan panel | Remove / Clear plan | Per-event removal and a full reset |

Everything is local. `overhead-calendar.js` is a pure module: no DOM, no storage, no network and no
engine call. The browser builds the file with a `Blob` and hands it to the download mechanism. There
is no account, no OAuth, no Google Calendar or Microsoft Graph call, no server-side calendar, and no
new Worker, KV, R2 or D1 resource.

## Eligible event categories

| Category | Entry | Timing source |
| --- | --- | --- |
| Satellites and Starlink trains | `VEVENT` with `DTSTART`/`DTEND` | Existing engine `start`/`end` (the useful-visibility segment) |
| Planets and alignments | `VEVENT` with `DTSTART`/`DTEND`, or `DTSTART` only for a calculated instant | Opportunity `start`/`end` |
| Meteor showers | `VEVENT` with `DTSTART`/`DTEND` | Opportunity `start`/`end` |
| Comets and special events | `VEVENT` with `DTSTART`/`DTEND`, or `DTSTART` only for a calculated instant | Opportunity `start`/`end` |
| Rocket launches, exact published time | `VEVENT` with `DTSTART` only, `STATUS:TENTATIVE` | Provider `net` |
| Rocket launches, published date only | All-day `DTSTART;VALUE=DATE`/`DTEND;VALUE=DATE`, `STATUS:TENTATIVE`, `TRANSP:TRANSPARENT` | Provider `net` UTC date |
| Rocket launches, month/quarter/half-year/year only | **Refused** with a stated reason | — |
| Completed, failed or under-way launches | **Refused** | — |
| A launch whose published time already passed | **Refused** | — |

A refused event keeps its place in the application; it simply does not become an appointment. The
card shows the refusal sentence, for example
`Schedule not precise enough for calendar — October 2026 (month announced, no day published).`

## Exported observing windows

* A satellite pass exports the calculated useful-visibility window, and the description names the
  three calculated bearings (`appears …`, `highest …`, `disappears …`) with their elevations. The
  three bearings come from the engine's own `entry`/`peak`/`exit` samples; a pass is never reduced to
  a single compass point, because the direction changes through the pass.
* A celestial opportunity exports its window, or a `DTSTART` with no `DTEND` when the engine reports
  a calculated instant. An instant is never stretched into an arbitrary duration.
* No event is given a default one-hour duration. There is no product-defined "planning block" in this
  phase, so no block is invented.
* Rise, culmination and set are described in words rather than split into three separate calendar
  entries: one opportunity is one calendar entry.

## Timezone serialization

* Every precisely timed entry uses UTC: `DTSTART:YYYYMMDDTHHMMSSZ` and, when the window has a real
  end, `DTEND:YYYYMMDDTHHMMSSZ`. Calendar clients render them in the reader's configured timezone.
* No offset is hardcoded anywhere, so daylight-saving transitions cannot make an export wrong. The
  description names the observing site's local time using the site's IANA timezone, so a window that
  crosses a DST fold names both offsets (for example `01:30 GMT-4 – 01:30 GMT-5`).
* The observing location's timezone is used for the description; the reader's own timezone is used
  only where the interface already displays local time. A site in another timezone is described, not
  converted.
* Midnight crossings, DST folds, sites without daylight saving (Arizona) and sites in a different
  timezone from the visitor are covered by deterministic fixtures in `tests/calendar.cjs`.
* Windows are windows and instants are instants: a window keeps both endpoints, an instant keeps one.

## UID and revision policy

* `UID` is `wlu-<category>-<slugged source identifier>[-<hash>]@worthlookingup.com`.
* It is derived only from the stable source identifier: a satellite pass ID, a celestial opportunity
  ID, or the provider's launch ID. A changed title, a different displayed timezone, a shifted
  prediction or a postponement never changes the UID.
* `DTSTAMP`, `CREATED` and `LAST-MODIFIED` are the export time; `SEQUENCE` is `0` for a first export
  and increments when the observing plan noticed that the source event changed after selection.
* The observing plan refreshes each selection from the data already on screen and never silently
  rewrites or drops a reader's choice. A selection whose source is no longer in the current results
  keeps its saved snapshot and is labelled in the plan.
* **Known update limitation:** downloading a new file does not make every calendar client update an
  earlier import. Apple Calendar and Outlook match on `UID` when importing; some clients and web
  importers create a second copy. Nothing here promises automatic synchronization, and this phase
  performs no calendar writes, no push notifications and no reminders. The interface says so.

## ICS compatibility

* `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH` and an
  `X-WR-CALNAME`; one `BEGIN:VEVENT`/`END:VEVENT` per event with `UID`, `DTSTAMP`, `DTSTART`,
  `SUMMARY` and, where applicable, `DTEND`, `CREATED`, `LAST-MODIFIED`, `SEQUENCE`, `DESCRIPTION`,
  `LOCATION`, `URL`, `STATUS`, `TRANSP` and `CATEGORIES`.
* CRLF line endings only; escaping of `\`, `;`, `,` and newlines; folding at 75 octets on UTF-8
  boundaries, so no multi-byte character is split.
* Verified in `tests/calendar.cjs` with **ical.js** (a development-only dependency, never shipped to
  the browser) in addition to the module's own structural checks.
* Filenames are `worth-looking-up-<slug>-YYYYMMDD.ics`, lowercased and stripped of any path
  separator, so a hostile or odd title cannot influence the download path.

## Privacy

* The exported file contains the observing location's display name and timezone, the event facts, the
  upstream source name, and a link back to <https://worthlookingup.com/>. It contains no coordinates,
  no `overhead.*` storage key, no analytics identifier, no internal cache key and no browser state.
* The observing plan is session state in memory. It writes no `localStorage` key, so it cannot leak
  into the preference export and cannot overwrite a reader's saved sites, favorites or settings.

## What the descriptions say

Descriptions are written for a calendar client, not dumped from JSON. Depending on the event they
include: the observing window or best moment; calculated bearings; optical-equipment demand; the
engine's own sighting-score band; weather and uncertainty notes; staleness warnings; the source name
and provider record URL; the launch provider's status, scheduling precision, last-update time and
postponement history; the schedule's age and stale warning; and the statement that local launch
visibility is unknown because no ascent trajectory is published. Every entry ends with the export date
and a link back to Worth Looking Up for refreshed conditions.

Nothing claims brightness, a magnitude, a probability, a guaranteed visibility, or a duration that no
source published.

## Cases where the source models lack timing

* **Broad launch periods.** Launch Library 2's coarse precisions carry the end of the announced period
  as the timestamp. That placeholder is never treated as a date, so no appointment is created.
* **A launch with no record loaded.** No entry is created rather than one being inferred.
* **An opportunity with no defensible start and end.** The card explains that the event cannot yet be
  added as a precise appointment.
* **An expired pass.** The dialog disables the calendar action with a reason instead of exporting a
  window that has already gone.
* **Unloaded categories.** A category that has not been calculated has no opportunity to export; the
  guide already states what was and was not calculated.

## Future calendar subscription architecture (not implemented)

A real subscription (a stable `webcal://` feed per reader) would need a server-side renderer and a
per-reader identity, which is deliberately out of scope: it would mean accounts, storage and a new
request path. If it is ever added, the pieces already in place are the pure serializer, the stable UID
namespace, the per-category eligibility rules and the refusal reasons. A subscription endpoint would
reuse `overhead-calendar.js` unchanged and add only a location-keyed URL and a cache policy.

## Tests

* `tests/calendar.cjs` — RFC 5545 structure, CRLF, folding, escaping, stable UIDs, UTC/DST/midnight
  behaviour, windows versus instants, launch exact/date-only/period/cancelled/passed/stale/postponed
  rules, multi-event plans, deduplication, revision, source links, safe filenames, independent
  `ical.js` parsing.
* `tests/calendar.spec.js` — real downloads from the guide, the pass dialog and the launch calendar,
  the observing plan (add, deduplicate, review, remove, clear, one-file download), mobile widths,
  keyboard activation and both themes.
* `tests/migration.cjs` — the module stays free of DOM, storage, network and provider APIs, and is
  staged and referenced by the deployment.
* `scripts/verify-production.mjs` — the deployed `overhead-calendar.js` bytes must match this
  checkout.

