# Worth Looking Up: photographic discovery

Release direction, 2026-10-15. Preserve the vanilla application and every scientific source hash.

## Composition
Use an editorial Earth-at-night photograph, a warm serif headline and compact, plainly labelled
controls. The hero answers what the application does; the header always exposes the current place.
Keep the hero under 240px on phones. Move the existing weekly opportunity above the briefing so a
real calculated event reaches the first viewport. Do not introduce cross-category ranking or fetch
extra feeds for a decorative overview. All categories remain visible on phones; the calendar's 90-day horizon stays in the category view. Phase 6A added the sixth — MILKY WAY — as the last tab, so the five existing tabs keep their positions on a phone and the satellite page still opens first. Phase 6B.2 adds **Where to go** below it, inside the same category: a panel that opens on a button, holds an
expandable list of areas (the authoritative interface) and a tile-free SVG sketch beside it, and never becomes a
map-first view. It reuses the panel, line, lime and blue tokens, 44 px actions and native `<details>` disclosures,
collapses to one column under 900 px, and adds no homepage element. Phase 6A.1's **Next Galactic-core season** block lives inside that category, under the cards and the chart: it is a plain panel when the horizon is empty (where it is the answer, and carries `data-prominent="true"` with the amber border) and a collapsed `<details>` when there are windows to look at, so it never competes with tonight. It uses the existing panel, line, lime and amber tokens and the same 44 px action buttons as a card, adds no homepage element and does not move the first-opportunity geometry.

## Phase 2 refinement
The hero names the active place in its overline (`#hero-place`, updated by the existing place render),
so the photograph has local meaning before the first event is read. Its primary action is a filled
sage button with a visible arrow, while the calculation/privacy reassurance is secondary text that is
hidden below 720px. The photograph, crop, credit and fallback are unchanged; mobile hero height stays
222px.

Every discovery card now starts with the event title, then a metadata row containing the category and
one explicit state chip: **Local opportunity** (sage), **Scheduled · visibility unknown** (amber), or
**Announcement · no local window** (muted). This is a presentation of the existing
`classification`; it is never derived from a new score or a cross-category comparison. Launch records
still state their global-schedule nature in text, and no launch becomes a local opportunity.

## Reusable patterns
- Ink/navy dark surfaces, paper light surfaces, sage actions and muted blue information. Use semantic
  palette variables so charts, confidence chips and dialogs retain their established meanings.
- Serif only for editorial headings; system sans for controls and content; tabular numerals for time.
- Photograph only in the introduction and sharing preview. Cards remain readable, compact text.
- Scores mean local calculated opportunities. Amber visibility-unknown labels on launch cards remain
  distinct from green scheduling status. Preserve optical-aid, weather, freshness and precision copy.
- Minimum 44px primary controls, visible focus, real headings, skip link, no decorative animation.
- Fixed image geometry and a dark background keep the hero useful if photography fails. The original
  local illustration is the fallback background. Photography is contextual, never today's forecast.

## Photography
NASA/JSC image iss039e009160: Earth, aurora and Moon from the ISS, photographed by astronaut
Rick Mastracchio (2014-04-02). NASA catalog explicitly identifies the photographer and mission;
NASA media guidelines allow informational use of NASA material, subject to third-party exceptions
and no endorsement. No people, logos or third-party credit appear in this asset. Show a source credit
on the hero. Source/rights URLs, derivative dimensions and acquisition date are in assets/provenance.json.
Use locally served WebP at 640/1280/1920px with JPEG fallback, no third-party font or image requests.
Retain original vector artwork; do not imply photographic evidence for an event or local aurora.

## Verification
Record deterministic before/after geometry, local lab LCP/CLS (not field Core Web Vitals), actual
screenshots, production byte checks and Actions evidence in docs/phase-2-release.md. Existing
scientific, lifecycle, storage and launch tests must remain unchanged and passing.

## Phase 3 discovery
The original weekly highlight position now holds a compact three-part sky guide: Tonight, Coming up,
and the separate launch calendar. One category leader is initially visible, other leaders and previews
use native details disclosures. Categories are not scored against each other. The weekly satellite
summary stays below the main list. Happening Now shows one prominence leader and expands the rest,
with an always-visible summary of additional orbital-only/weather-uncertain events. See discovery.md
for source, lifecycle, cache and navigation contracts; phase-3-release.md for measured evidence.

## Phase 4 calendar export
Every eligible opportunity card now carries two compact secondary controls: **Add to calendar (.ics)**
and **Add to observing plan**. The observing plan is a small bordered panel above the category view
that appears only while something is selected; it lists selections chronologically with per-event
remove, a clear action and one combined download. Times remain UTC in the file and are rendered by the
calendar client; the description names the observing site's local time. A launch with only a broad
announced period gets the refusal sentence in place of a button, in the same muted `calendar-note`
style. Nothing in the visual system changes: same ink/paper surfaces, sage actions, 44px mobile
controls and visible focus. See [calendar.md](calendar.md).

## Phase 7A equipment and difficulty

Every celestial card keeps its existing observing-suitability value and adds a separate, compact difficulty
block immediately below the summary: two chips (**Visual** and **Imaging**), the suggested approach, one
plain-English reason, an optional profile fit and a disclosure with inputs, limits and provenance. The block
uses the existing panel, line and semantic chip colours; it never replaces or recolours the opportunity score.
The full explanation stays in a native `<details>`, while the level, approach and reason are always visible.

The equipment guide and profile live in one dialog opened from Settings, from any difficulty block and from
the session builder. The guide is a two-column card grid on wide screens and one column under 650px; the
profile uses native fieldsets, legends, checkboxes and numeric inputs with 44px rows. The module is fetched
only when the dialog opens. The profile is local-only and never suppresses an opportunity or changes its rank.

Discovery cards add one small difficulty line and the guide link. The satellite detail dialog uses the same
block. The session builder notes when camera fields were prefilled from the profile, or when a saved plan's
camera differs from the current profile; it never overwrites either silently.


The session builder is one bordered panel in the Milky Way category, below **Where to go**, and it opens
in place instead of navigating to a separate screen. Five numbered steps run top to bottom, each a
`border-top` rule and a small numeral in a 26px circle: **When**, **Where**, **Conditions**, **Prepare**,
**Save or export**. The numeral is decoration; the step name is text, so nothing depends on the colour
or the circle to be understood.

Choices are full-width buttons with a two-line label — the name of the night or the place in the body
text, its date, agency or parking classification in the muted `small` line — laid out as
`repeat(auto-fit,minmax(180px,1fr))`, which becomes a single column at 390px. A selected choice keeps an
`aria-pressed="true"` and an accent ring rather than a colour swap, so both themes stay legible.

Facts are a definition list with uppercase muted terms and 1.15rem values, because the reader is standing
in the dark: **Observing window**, **Best available moment**, **Point the camera**, **Moon**, **Darkness**,
**Window quality**, **Times in**. Terrain reads as a left-bordered block tinted by the verdict — sage for
clear, amber for unknown, red for obstructed — with the verdict spelled out in the heading so the colour
is a reinforcement, not the message. The same block carries the bare-earth sentence.

The readiness list, the equipment checklist and the camera starting points share one visual weight:
`h5` headings, 18px-inset lists, and checkbox rows with a 40px minimum height and an 18px box, so a
thumb can hit them. Camera inputs use the standard field style and sit on one row above the guidance.
An `details` element holds the assumptions, collapsed by default and still reachable by keyboard.

Step five is the only place with primary actions: **Save this plan** is the one accent-filled button, and
print, calendar, plan and refresh are secondary. A disabled primary action is how the interface says a
night has no window — the explanation above it is the reason, so the button never has to carry a
tooltip. Saved plans are a compact two-column row list with Open and Delete, and nothing about them
looks like cloud storage because none exists.

The printed sheet is a separate artefact: black on white, 11pt, two-column definition list, a quoted
evidence block with a left rule, and the equipment list in two newspaper columns via `columns:2`, which
degrades to one column on A4 when the items are long. `@page{margin:16mm}` keeps it inside both Letter
and A4 margins without a page-size-specific rule.
