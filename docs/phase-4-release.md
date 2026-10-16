# Calendar export and observing plans — 2026.10.15.6

## Outcome
An eligible observing opportunity can now be turned into a calendar file, or collected with others into
one itinerary. `overhead-calendar.js` is a new pure module and the only iCalendar writer: RFC 5545
structure, CRLF, escaping, 75-octet UTF-8 folding, UTC instants, and a UID derived from the source
identifier alone. `index.html` owns the download, the labels and a session-only observing plan.

Nothing is uploaded and no account, OAuth, server, calendar API or new storage key is involved. Launch
schedules keep their precision: an exact time is a tentative target with provider/status/last-update/
postponement context, a published date is a tentative all-day placeholder, and a month, quarter,
half-year or year is refused with a stated reason. Full [contracts](calendar.md).

## Layout cost
Measured with the staged build, the ISS fixture and available weather at 900px height
(`scripts/measure-calendar.cjs`): the action row is 44px on a phone and 36px above 720px, so the first
satellite row moves down by 44/35/36/36px at 390/768/1280/1440. The observing plan panel contributes
nothing while nothing is selected (it is `hidden`); the guide itself measured 609/567/486/486px tall
with 11 cards. No horizontal overflow at any width, in either theme.

| Width | Action row | First satellite row before → after | Guide height | Overflow |
| --- | --- | --- | --- | --- |
| 390 | 44px | 1568 → 1612 | 609 | 0 |
| 768 | 36px | 1460 → 1495 | 567 | 0 |
| 1280 | 36px | 1356 → 1392 | 486 | 0 |
| 1440 | 36px | 1358 → 1394 | 486 | 0 |

Exporting makes no new network request: a single-event and a plan download were both confirmed to add
zero requests in the browser suite, and the only new first-load request is the local module itself.

## Visual and accessibility evidence
Production screenshots: [plan panel, desktop dark](screenshots/phase4/production-plan-desktop-dark.png),
[plan panel, phone dark](screenshots/phase4/production-plan-mobile-dark.png),
[plan panel, phone light](screenshots/phase4/production-plan-mobile-light.png),
[launch calendar with calendar actions](screenshots/phase4/production-launches-desktop.png).
Controls are 44px on a phone, keep the existing focus ring, carry `aria-pressed` state and announce
results in the existing live region. Remove controls carry a per-event `aria-label`. The plan panel uses
real headings and a list. No formal assistive-technology audit.

## Checks
- `npm ci`, `npm test` (21 suites, including the new `tests/calendar.cjs`), `npm run build`,
  `node scripts/refresh-launches.mjs --check`, Python comet precision (6 passed), comet `--check`,
  comet `--no-network` and meteor `--check` all passed.
- Browser: 44 passed, 2 intentional opt-in live-provider skips, 0 failures. Five of those are the new
  calendar suite (real `.ics` downloads from the guide, the pass dialog and the launch calendar; the
  observing plan; mobile widths; keyboard activation; both themes). Locally the runner printed every
  result but did not emit its summary line for the largest combined set; the identical behaviour was
  reproduced against the unmodified HEAD checkout in a temporary worktree, so it is an environment
  teardown quirk rather than a product regression, and the CI run is authoritative.
- The generated iCalendar is re-parsed by **ical.js** (a development-only dependency, never shipped to
  the browser) in addition to the module's own structural assertions.
- Scientific engines, fixtures and `docs/source-manifest.json` hashes are unchanged. Existing
  orbital/celestial/worker, storage, map, theme, lifecycle, launch, discovery, homepage and redirect
  tests are retained and pass.

## Production evidence
Implementation commits `a51896b`, `1b5f486` and `a1428b0` were pushed normally to main; the pre-push
check confirmed the outgoing history contained `origin/main`, and a post-push fetch plus
`scripts/git-sync.sh verify` confirmed the remote contains `a1428b0`. The hourly bot's feed commit
`005dd86` was preserved by a safe fast-forward before work.

[Actions run 38835421998](https://github.com/hmarquardt/worthlookingup/actions/runs/38835421998)
completed successfully: `validate` (npm ci, `npm test`, launch artifact check, Python precision and
builders, full browser suite on Chromium, build, artifact upload) and `deploy` (Cloudflare Pages
publication and `scripts/verify-production.mjs https://worthlookingup.com --wait`). Independent
production verification then passed deployed HTML/release, exact `overhead-discovery.js` and
`overhead-calendar.js` bytes, unchanged scientific hashes, workers/data, branding/transfer/analytics,
a real 404 and all ten host/path/query redirect chains.

Real Chrome against https://worthlookingup.com/ (`scripts/verify-calendar-production.cjs`) downloaded
three actual `.ics` files and inspected them: a comet opportunity (one `VEVENT`, CRLF only, every line
≤75 octets, UTC `DTSTAMP`/`DTSTART`, product-owned UID, `URL:https://worthlookingup.com/`, no
coordinates or `overhead.*` keys), an exact launch (`STATUS:TENTATIVE`, no `DTEND`, "published target
time … not a confirmed liftoff", "Local visibility: unknown", no visibility or probability claim), and
a two-event observing plan (one `VCALENDAR`, one `VEVENT` per selection, distinct stable UIDs). The plan
count, per-event removal, clear and self-hiding were confirmed, as were a 44px tap target, a visible
focus ring, no horizontal overflow at 390px in both themes and no page errors. Twelve period-only
schedules in the launch window offered no calendar action at all.

## Limits and next task
A downloaded file does not make every calendar client update an earlier import: Apple Calendar and
Outlook match on `UID`, other clients may add a second copy. There is no subscription feed, no reminder,
no push notification and no automatic refresh, and the interface says so. Exports carry the observing
site's display name and timezone but no coordinates. Recommended next: a per-location `webcal://`
subscription would need a server-side renderer and a reader identity, which this phase deliberately
avoids; the pure serializer, the UID namespace and the eligibility rules are already in place for it.

