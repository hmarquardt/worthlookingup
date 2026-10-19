# Photography sessions

Phase 6C. A session is one night, one place, the astronomy that place actually has that night, the kit you
intend to carry and a plan you can print. It is a recording of what was calculated and published when it was
made; it is not a permission, a forecast, a brightness measurement or a promise of a photograph.

The builder lives inside the Milky Way category, immediately below **Where to go**, and it opens only when a
reader asks for it. Nothing about sessions is fetched, calculated or stored before that.

## The workflow

One panel, five numbered steps. There is no wizard and no page change, so a phone in the field keeps its place
and the Milky Way category above it stays visible.

1. **When** — Tonight, the first favourable night, the season opening, or a date of your own.
2. **Where** — one of the verified observation points, or your own saved location.
3. **Conditions at the chosen place and date** — window, best moment, compass direction, Moon, darkness,
   window quality, terrain (points only), weather state, and the unknowns.
4. **Prepare** — the readiness checklist, the equipment checklist and the camera starting points.
5. **Save or export** — notes, save, print, calendar, observing plan, refresh, and the saved list.

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
- Weather: the Open-Meteo hourly forecast the page already holds, and only for the visitor's own coordinates.

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

The checklist is a prompt, not a requirement. Thirteen items, all unticked by default, all editable, stored in
`overhead.session.checklist.v1` as soon as they are ticked, and copied into a saved plan. An empty checklist is
valid and prints as empty boxes.

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

## Weather refresh behaviour

- A point **never** shows the visitor's forecast. The session says the forecast held by the page is for the saved
  location and that substituting it would describe a different sky.
- Your own location within the nine-day forecast horizon shows the mean cloud cover of the forecast hours that
  overlap the night, with the age of the fetch, and the caveat that one forecast says nothing about transparency,
  smoke or haze.
- A date beyond that horizon always reads **"Weather is not yet forecastable for this date."** — including when
  the current forecast request failed, because the distance is the reason.
- **Refresh evidence and forecast** re-reads `data/geodata/points.json`, recalculates, updates a saved plan in
  place and says that the agency may change the notice after the evidence was published. It never claims an
  unchanged rule.

No reminder service, notification, background sync or scheduled job is created.

## Print layout

A hidden `#session-print` article is filled at print time and `window.print()` opens the browser dialog; no PDF
service and no dependency is involved. `@media print` hides every other element, switches to black on white and
sets `@page{margin:16mm}`, which is legible on both US Letter and A4. The sheet carries: session identity, site
and coordinates, local timezone, window, best moment with bearing and altitude, Moon, darkness, quality, weather
status, terrain with its uncertainty and the bare-earth caveat, night presence and parking, the quoted access
evidence with its publisher, URL and verification date, the equipment checklist, the camera starting points and
their assumptions, notes, unresolved items, source lines and the print date.

## Local storage schema

All keys are `overhead.` prefixed in `localStorage`, never synchronised, never uploaded:

| Key | Content | Bound |
| --- | --- | --- |
| `session.list.v1` | array of session records, newest first | 12 records |
| `session.current.v1` | the most recently saved record | 1 record |
| `session.checklist.v1` | `{itemId: boolean}` | 13 known ids |

A session record (`worthlookingup.session/1`) holds: `id`, `schema`, `subject`, `date`, `siteKey`, `site`
(name, lat, lon, tz), `pointId`, `evidenceRef` (agency, coordinate provenance, verification date, access, URL),
`window`, `core`, `moon`, `darkness`, `terrain`, `weather` (state, timestamp, forecast age), `quality`, `engine`
(name, schema, threshold, calculation time, release), `checklist`, `camera`, `notes`, `createdAt`, `updatedAt`,
`limitations`.

Identity is `session:<siteKey>:<YYYY-MM-DD>`, so saving the same site and night twice updates one entry instead
of creating a duplicate, and a plan for a different night is a different plan. Records from an earlier schema are
migrated; a record that cannot be read is skipped and reported ("One saved plan could not be read and was
skipped"), never rendered half-built. Notes are stripped of control characters, capped at 2000 characters and
escaped on every render.

Nothing else is stored: no credentials, no payment information, no personal identification, no location history.
Clearing site data removes saved plans, and the panel says so.

## Accessibility

- Every choice is a real `<button>` with `aria-pressed`, so it is reachable and operable by keyboard; the
  checklist is a real checkbox list with a 40 px row, so space toggles it.
- Steps are headed by numbers and text, not by colour alone; the terrain verdict carries its words (`clear`,
  `unknown`, `obstructed`) beside its border colour.
- Times are set large and in the site's own zone; the compass direction is given in words as well as degrees.
- Both themes are preserved and no element depends on colour contrast alone.
- No horizontal overflow at 390, 768, 1280 or 1440 px in either theme.

## Offline capabilities and limits

A saved plan remains readable from `localStorage` after a reload or without a network, because the record holds
the window, the core position, the access evidence and the notes. What is **not** available offline: the
builder's module (first open needs it), a new calculation, refreshed evidence, the forecast, and any map. No map
tiles or third-party assets are cached, and the panel makes no claim of offline maps.

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
- Weather exists only for the visitor's own coordinates; the builder will not extrapolate it.
- Only three verified observation points are published, all in the studied region of southern Indiana, southeastern
  Illinois and western Kentucky; outside that region the builder offers the saved location only.
- A saved plan keeps the access evidence it recorded. If the agency changes a rule, only a refresh and a reader
  who checks the site's own notice will catch it.
- Camera durations are rules of thumb, not a model of your sensor.

## Future feature opportunities

- Field-verification pass: compare horizon photographs against the DEM at each point and record the residual.
- A wider region, once the facilities west of 88.60°W carry coordinates and quoted permission.
- A licensed sky-brightness mosaic (NASA Black Marble with a precomputed, off-browser product) so "dark" can
  eventually be a measured statement instead of an absent one.
- Per-point wind and temperature forecasts, if a provider's terms allow deriving them at the point's coordinates.
