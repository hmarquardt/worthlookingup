# Photography sessions

Phase 6D. A session is one night, one place, the astronomy that place actually has that night, the kit you
intend to carry and a plan you can print or carry into the field. It is a recording of what was calculated and
published when it was made; it is not a permission, a forecast, a brightness measurement or a promise of a
photograph.

Phase 6D makes a saved plan usable shortly before departure: the forecast follows the selected destination,
saved and current access evidence are shown side by side, the pre-departure review separates what is known from
what still needs a person, the checklist is a comfortable target on a phone, refresh reports each part honestly,
and a self-contained field copy can be opened with no network after a browser restart.

The builder lives inside the Milky Way category, immediately below **Where to go**, and it opens only when a
reader asks for it. Nothing about sessions is fetched, calculated or stored before that, and opening the
homepage still requests nothing for the builder.

## The workflow

One panel, six numbered steps. There is no wizard and no page change, so a phone in the field keeps its place
and the Milky Way category above it stays visible.

1. **When** — Tonight, the first favourable night, the season opening, or a date of your own.
2. **Where** — one of the verified observation points, or your own saved location.
3. **Conditions at the chosen place and date** — a field summary of the place, window, best moment, camera
   direction, Moon, forecast and any access warning, followed by the detailed window, Moon, darkness, quality,
   terrain (points only), forecast provenance, access evidence and unknowns.
4. **Before you leave** — the pre-departure review: destination, night, window, forecast state, access evidence,
   parking, verification date, terrain limits, outstanding uncertainties and equipment completion, then seven
   actionable checks.
5. **Prepare** — the equipment checklist and the camera starting points.
6. **Save or export** — notes, save, print, download a field copy, calendar, observing plan, refresh, and the
   saved list.

## Date selection

| Mode | Where the date comes from | What is calculated |
| --- | --- | --- |
| Tonight | the selected place's own local date | `analyseNight` at that place, now |
| First favourable night | `analyseSeason` at that place, quality ≥ 60 | that night, at that place |
| Season opening | `analyseSeason` at that place, first night with a window | that night, at that place |
| A date of my own | the reader, any date from today to +365 days | that night at that place |

The season search walks the site's own observing nights in order and stops at the first hit, exactly as the
season panel does (`analyseSeason`, `SEASON.horizonDays` = 366). When the session is at the visitor's saved
location the answer already computed for the season panel is reused rather than searched twice; at a point it
is searched once, on demand, and kept for the session.

Two rules are structural, not stylistic:

- **A window is never borrowed from another place.** Every date is recalculated at the selected site with that
  site's coordinates, timezone and night boundaries. Changing **Where** re-applies the chosen date mode, so a
  "first favourable night" found for Camp Cadiz cannot survive a switch to your own location.
- **A night without a window has nothing to save.** The conditions step says why the engine refused
  (`analysis.refusals`), states the core's actual highest altitude so "no window" is never read as "invisible",
  and disables save, print, calendar and plan.

## Scientific assumptions

Everything astronomical comes from the existing engines and none of it is re-derived here:

- Night boundaries: `OverheadAstro.sunsetSunrise` at the site's own coordinates (the same builder the ninety-day
  plan uses), extended night by night by the page.
- Window, core altitude/azimuth/compass, Moon, darkness, quality: `OverheadMilkyWay.analyseNight` with the
  visitor's own threshold (`state.settings.minimum`, bounded 8–45°, default 10°), so a session agrees with the
  Milky Way plans above it.
- Terrain: the point artifact's 16-azimuth bare-earth profile, interpolated linearly between neighbouring
  directions at the core's actual azimuth for **this** night. The interpolation is checked in
  `tests/photography-sessions.cjs` against `src/geodata/terrain-horizon.mjs` (`horizonAtAzimuth`,
  `clearanceFor`), so there is one method and not a second one.
- Weather: the same Open-Meteo hourly forecast the satellite side already uses, requested for the selected
  place's own coordinates and interpreted only over the hours of this night's observing window. The provider's
  model grid is coarser than the coordinate; the panel says so rather than turning a grid value into a point
  measurement. See **Destination weather** below.

Categories that are never mixed: geometry (certain, years ahead), moonlight (certain), weather (a forecast that
is reissued), local sky brightness (**not assessed anywhere**), and physical horizon visibility (a model with an
uncertainty). The window quality is the Milky Way category's own 45/30/25 scale and every surface that shows it
says it is not comparable with satellite, meteor or planetary values.

## Site and access evidence rules

**Verified observation points** carry their own evidence into the session: facility name, managing agency,
coordinate provenance (agency marker or third-party map, with its precision), the verification date, the
night-presence classification, the parking classification, the quoted statement and its URL. Night presence and
parking are separate fields and the builder prints them separately:

- `verified` presence with `verified-at-designated-campsite` parking means overnight presence is documented at a
designated campsite; it does **not** mean a day-visitor lot may be used at night.
- A point is never described as a place to park unless the agency said so (Garden of the Gods' backpacker lot is
the only one of the three).

**My saved location** is classified as unverified in the panel and in every exported file: the app holds no
public-access evidence for it and does not acquire any by using it. The saved site is never modified by opening a
session, selecting a point, saving a plan or exporting a calendar event (asserted in the browser test).

An area record without a verified observation point never appears as a destination.

## Equipment guidance

The checklist is a prompt, not a requirement. Thirteen items, all unticked by default, stored in
`overhead.session.checklist.v1` as soon as they are ticked, and copied into a saved plan. An empty checklist is
valid and prints as empty boxes. The seven **Before you leave** prompts are a separate list in
`overhead.session.readiness.v1`; ticking one records that the reader did it and never turns an agency rule into a
verified fact.

## Camera-setting estimation limits

Two families of output, and a deliberate refusal:

- **Without a sensor and focal length** the builder gives only direction — manual mode, RAW, manual focus on a
  star, wide aperture, test frame and histogram — and says that no duration is suggested because no lens was
  given. It never invents a camera.
- **With a sensor and focal length** it applies the 500-rule family: `500 / (focal × crop)` for a usable frame and
  `300 / (focal × crop)` for a stricter one, both labelled as rules of thumb from the film era. The assumptions
  say plainly that they do not model pixel pitch or the target's declination, that trailing grows towards the
  celestial equator (the core sits near −29°), and that ISO is a compromise rather than a setting to copy.
- **With a tracking mount** no duration is derived at all: the limit becomes what the mount can guide and what the
  sky brightness tolerates.

There is no equipment database, no lens lookup and no exposure model pretending to be scientific.

## Destination weather

The forecast is asked for the selected destination's own coordinates. Selecting a verified point therefore
requests that point's latitude and longitude, not the visitor's home; the home answer is never moved onto a
point, and the field summary names the place the forecast belongs to.

- **Provider.** Open-Meteo's free forecast endpoint, already used by the satellite plan: global coverage, a model
  grid the provider describes as possibly "a few kilometres away from the requested coordinate", hourly time
  steps, `forecast_days=9` and `past_days=1`, with no API key. Models are refreshed "typically every few hours"
  (some hourly), and Open-Meteo's servers are eventually consistent, so a just-published model run can take a few
  minutes to appear everywhere. The free service is non-commercial, CC BY 4.0, attributed in the page's source
  line and subject to the published daily/hourly/minute call limits recorded in [providers.md](providers.md).
- **Coordinate precision.** The request carries the published point coordinate. Forecasts are cached under the
  coordinate rounded to three decimals (about 111 m); that is a cache identity, **not** a claim that the model
  resolves 111 m. The response returns the centre of the grid cell that was actually used, which can be several
  kilometres away, and a valley, ridge or lake can differ from that cell.
- **Fields used.** Cloud cover (mean, with the window's minimum and maximum), precipitation probability (the
  window's maximum), 2 m temperature (the window's minimum and maximum), 10 m wind speed and gusts (the window's
  maximum), the units the provider returned, the fetch time and the forecast's own valid interval — the hours of
  the observing window. A series the provider omitted stays missing; it is never filled with zero or described
  as still air.
- **Horizon.** The product asks for nine days and refuses beyond them. Open-Meteo can publish up to 16 days, but
  the shared request is deliberately kept to nine so the homepage payload stays small; the limit is a product
  choice, not a provider ceiling. A night outside it reads **"Weather is not yet forecastable for this date."**
  and **no request is made**. A past night reads that it is in the past. Nothing is extrapolated.
- **Refresh cadence.** A response is reused for 30 minutes per coordinate key; the page's existing
  `overhead-cache` IndexedDB store keeps the same response for up to seven days as a fallback. A cached answer is
  always labelled `cached`, with its age. Switching away from a place and back inside the cache window does not
  send a second request.
- **Failure.** A failed or invalid request shows **Forecast unavailable**, never clear skies. If an unexpired
  cached response exists it is shown as cached and dated; otherwise the saved plan's last-known forecast is shown
  separately and labelled as history.
- **Not modelled.** Cloud cover is a forecast, not a measurement of transparency, smoke, haze or seeing. The
  panel never derives any of those, and never converts a forecast into a probability that a photograph works.

The forecast is requested only while a session is open (or a saved plan is reopened), never on homepage load,
and never from a tick in either checklist. If the browser reports that a connection has returned while a session
is open, the panel makes one request for that open plan, still subject to the horizon and cache rules.

## Pre-departure review and access freshness

**Before you leave** is a summary and a short list, not another wizard. It states the destination and whether it
is a verified point, the night in the site's zone, the observing window, the forecast state and age, the access
classification, parking, the verification date, the terrain limits and the number of unresolved items. Then it
offers seven actions: recheck the facility's rules and alerts, confirm parking or campsite eligibility, look at
the latest forecast, check roads and gates, check the real horizon, charge and pack the kit, and tell someone the
plan. Ticking one stores a user acknowledgement; it is not an independent verification of an official rule.

A saved plan keeps the evidence it was made with. When it is reopened, the panel compares that `evidenceRef` with
the current `data/geodata/points.json` record and distinguishes:

| Status | Meaning |
| --- | --- |
| `current` | the published record still matches the saved one |
| `changed` | night presence, parking, classification, summary, verification date or restrictions differ; both versions are listed field by field |
| `expired` | the published verification is older than a year; it is shown as history rather than as a current permission |
| `withheld` | the point is no longer published; the plan stays at the saved coordinates and the saved evidence is shown as history |

That snapshot is what makes the comparison possible, so **refresh never overwrites it**. A refresh writes the
recalculated astronomy, terrain and weather into the plan but keeps the planning-time `evidenceRef`; only an
explicit **Save this plan** takes a new snapshot of the published record. Without that rule, refreshing after a
change would quietly make the changed record look like the record the plan was saved with.

The operation is labelled **"Checked against the latest Worth Looking Up site record"**, because reloading a
static artifact is not contacting the managing agency. A direct official-source link is always shown. A point
that is withheld is never silently replaced by the visitor's home location, and a saved plan keeps its own
identity and coordinates.

## Refresh semantics

**Refresh evidence and forecast** reports each component separately; there is no "everything updated":

1. **Astronomy** — a deterministic local recalculation at the same place and night, with the visitor's threshold.
2. **Access** — a fresh read of the published point artifact, compared with the saved evidence.
3. **Weather** — a provider request for the destination coordinates, subject to the horizon and cache rules.
4. **Terrain** — whatever the published bare-earth profile now says for that direction.

A partial failure is reported as a failure on that line and as success nowhere else. Notes, equipment and
readiness ticks survive the refresh, and the session identity is unchanged, so refreshing can never create a
duplicate plan. If the reader has changed the place or night since opening a saved plan, refresh says that it did
not overwrite the saved plan rather than silently writing a second one; **Save this plan** is still the explicit
action that does that. If the recalculation finds no qualifying window, the saved window remains visible for
reference but save, print, calendar, field copy and observing-plan actions stay disabled until the issue is
resolved. The chosen place and date are never changed by a refresh.

## Print layout

A hidden `#session-print` article is filled at print time and `window.print()` opens the browser dialog; no PDF
service and no dependency is involved. `@media print` hides every other element, switches to black on white and
sets `@page{margin:16mm}`, which is legible on both US Letter and A4. The sheet carries: session identity, site
and coordinates, local timezone, window, best moment with bearing and altitude, Moon, darkness, quality,
**forecast state with the fetch age and the valid window**, or the not-yet-forecastable refusal, any last-known
forecast saved with the plan, terrain with its uncertainty and the bare-earth caveat, night presence and parking,
the quoted access evidence with its publisher, URL and verification date, the current-versus-saved access status,
the equipment checklist, the camera starting points and their assumptions, notes, **still to do before leaving**,
unresolved items, source lines and the print date. It never prints a departure time, a drive duration or more
certainty than the panel.

## Local storage schema

All keys are `overhead.` prefixed in `localStorage`, never synchronised, never uploaded:

| Key | Content | Bound |
| --- | --- | --- |
| `session.list.v1` | array of session records, newest first | 12 records |
| `session.current.v1` | the most recently saved record | 1 record |
| `session.checklist.v1` | `{itemId: boolean}` | 13 known ids |
| `session.readiness.v1` | `{itemId: boolean}` for the Before you leave prompts | 7 known ids |

A session record (`worthlookingup.session/1`) holds: `id`, `schema`, `subject`, `date`, `siteKey`, `site`
(name, lat, lon, tz), `pointId`, `evidenceRef` (agency, coordinate provenance, verification date, access, URL),
`window`, `core`, `moon`, `darkness`, `terrain`, `weather` (state, save time, forecast fetch time, label, rows and
any last-known forecast), `accessStatus`, `quality`, `engine` (name, schema, threshold, calculation time,
release), `checklist`, `readiness`, `camera`, `notes`, `createdAt`, `updatedAt`, `limitations`.

Identity is `session:<siteKey>:<YYYY-MM-DD>`, so saving the same site and night twice updates one entry instead
of creating a duplicate, and a plan for a different night is a different plan. Records from an earlier schema are
migrated; a record that cannot be read is skipped and reported ("One saved plan could not be read and was
skipped"), never rendered half-built. Notes are stripped of control characters, capped at 2000 characters and
escaped on every render.

Nothing else is stored: no credentials, no payment information, no personal identification, no location history.
Clearing site data removes saved plans, and the panel says so.

## Accessibility and the field view

- Every row of both checklists is a real `<label>` around a native checkbox; the whole row toggles once, the
  minimum target height is 44 CSS px, and the focus ring is visible on the box itself. No custom switch replaces
  the standard control, so Space works, the screen reader announces the label and checked state, and a stray tap
  cannot double-toggle.
- Every choice is a real `<button>` with `aria-pressed`, so it is reachable and operable by keyboard.
- The field summary leads with the facts a reader needs with a torch in one hand: destination, window, best
  moment, camera direction, Moon, forecast state, and any access warning. Provenance, uncertainties and quoted
  evidence follow below in labelled rows and details.
- Steps are headed by numbers and text, not by colour alone; the terrain verdict carries its words (`clear`,
  `unknown`, `obstructed`) beside its border colour.
- Times are set large and in the site's own zone; the compass direction is given in words as well as degrees.
- Both themes are preserved and no element depends on colour contrast alone.
- No horizontal overflow at 390, 768, 1280 or 1440 px in either theme; checked in the browser suite.

## Offline capabilities and limits

A saved plan stays readable from `localStorage` after a reload or after the network drops, because the record
holds the window, core position, Moon, darkness, terrain, access evidence, checklist, readiness ticks, notes and
the last forecast it was saved with. While the browser reports no connection the field summary says **Offline**,
no refresh is pretended, and a saved forecast is shown under its own **last-known** heading with its age and the
statement that it is not current. **Offline outranks any forecast still in memory**: a response fetched before the
connection dropped is never re-labelled as current, and no provider request is attempted. Checklist edits and note
edits made offline are written locally; a note is written back to its saved plan when the field loses focus.

Cold start is the honest limit. There is no service worker in this release, so the application code itself must
have been loaded before a saved plan can be opened offline. To cover a complete browser restart with no network,
**Download a field copy** writes one self-contained HTML file (no scripts, no external assets) containing the
place, coordinates, window, best moment, direction, Moon, darkness, terrain, access evidence, forecast state or
last-known forecast, equipment, outstanding checks, notes and limitations. It opens from local storage on the
device with no app and no network. It is a snapshot: it cannot verify a rule, a gate or the sky. Maps, third-party
tiles, refreshed evidence and new calculations remain unavailable offline.

## Mobile field display

The summary rows stack rather than squeeze at 390 px: the label sits above the value, long values wrap, and the
window, best moment, direction and Moon remain at the top. Critical access warnings are never behind a
disclosure. Print and mobile read the same session record, so the sheet cannot claim more certainty than the
panel.

## Calendar semantics

The session registers an ordinary Milky Way opportunity through the shared model and the existing RFC 5545
serializer, so the event is the astronomical observing interval at that place and nothing else:

- `DTSTART`/`DTEND` are the window's instants, in UTC with the site's `VTIMEZONE`/local rendering as the
  serializer decides.
- `LOCATION` names the point (or the saved location), never the visitor's home when a point is selected.
- The identity includes the site key and the night, so adding the same session twice is one event and the
  observing plan refuses the duplicate.
- No departure time, travel duration or camping block is added: the app does not know them and does not invent
them.

## Known limitations

- Terrain is bare earth: 3DEP roughly 31 m, no trees, buildings or vehicles, with a stated uncertainty per
  direction. It is a model, not a sight line.
- Local artificial sky brightness has not been assessed for any point or for a saved location, and no darkness
  rating is derived from radiance data.
- The destination forecast is a model-grid forecast, not a measurement at the point. It carries cloud cover,
  precipitation probability, temperature, wind and gusts only; it cannot report transparency, smoke, haze or
  seeing, and a low cloud figure is not a guarantee of a usable sky.
- The product asks the provider for nine days of forecast (Open-Meteo can publish up to 16). Beyond that request
  the plan shows only astronomy and the Moon; it never extrapolates a forecast.
- Offline cold start is covered by the downloaded field copy, not by a service worker. Opening the live builder
  offline requires the application code to have been loaded already.
- Access evidence is re-read from Worth Looking Up's published record, not from the managing agency. It can be
  changed between publications, and only the reader's own check of the official source can confirm tonight.
- A point that is withdrawn from the published record stays in an existing plan as history; it is never silently
  moved to another place and never presented as currently verified.
- Only three verified observation points are published, all in the studied region of southern Indiana,
  southeastern Illinois and western Kentucky; outside that region the builder offers the saved location only.
- Camera durations are rules of thumb, not a model of your sensor.
- No reminder, notification, background sync or weather-monitoring service exists: a saved plan is refreshed
  only when a reader asks.

## Field-readiness test scenario

1. Weeks ahead, open **Plan a Photography Session**, choose Camp Cadiz Campground and a date in the next week.
2. Confirm the panel requests the campground's coordinates (not the home coordinates), shows cloud, temperature,
   wind and the fetch age, and labels the forecast as a model forecast.
3. Tick two equipment items and one pre-departure item, add a note, and save.
4. Reload the page, reopen the saved plan, and confirm the place, date, window, notes, ticks and forecast persist.
5. In the network panel, block or fail `api.open-meteo.com`, press **Refresh evidence and forecast**, and confirm
   the report says astronomy succeeded, weather is unavailable (or cached, if a cached answer exists), access is
   unchanged, and terrain is unchanged — never "everything updated".
6. Change `data/geodata/points.json` so the point is withheld, reopen the plan, and confirm it stays at Camp
   Cadiz with a prominent withheld warning and its saved evidence as history.
7. Switch the browser offline, reopen the already-loaded builder and the saved plan, and confirm the Offline
   label, the last-known forecast heading and its age, and that a checklist tick still persists.
8. Download a field copy, close the browser, disconnect the network, and open the HTML file directly. Confirm the
   place, window, direction, access evidence, kit, notes and the forecast state are present and no script runs.
9. Print the plan and confirm the forecast state, fetch age, access evidence date, terrain uncertainty and
   outstanding checks appear, with no departure or driving time.
10. At 390 px in both themes, confirm every checklist row is at least 44 px tall, toggles once from its text,
    shows a focus ring, and causes no horizontal overflow.

## Future feature opportunities

- Field-verification pass: compare horizon photographs against the DEM at each point and record the residual.
- A wider region, once the facilities west of 88.60°W carry coordinates and quoted permission.
- A licensed sky-brightness mosaic (NASA Black Marble with a precomputed, off-browser product) so "dark" can
  eventually be a measured statement instead of an absent one.
- A minimal versioned service worker for the app shell, only if it can be shown not to mask a scientific fix;
  the downloaded field copy remains the cold-start contract until then.
