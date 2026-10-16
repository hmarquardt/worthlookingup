# Discovery and planning contracts

Plan recorded before implementation on 2026-10-15; implemented in release 2026.10.15.5.

## Boundaries
Implement a pure presentation adapter in overhead-discovery.js; do not alter any engine or score.
Satellite times are UTC epoch milliseconds and scores are local sighting recommendations. Their
lifecycle/recommendation eligibility remains authoritative. Celestial opportunities carry UTC ms
start/end/best, eligibility, optical demand, observing value, three separate confidences, caveats
and provenance. The celestial consolidated model is useful within that family; its satellite bridge
expects a different score shape from the live numeric pass score. Do not reuse its cross-family rank.
Launches are globally published schedules, with exact/day/period precision and unknown local visibility.

## Selection and sources
Tonight: strongest eligible result within each calculated category, then chronological order; no
universal winner or numerical comparison. Satellites must meet the existing Possible band
(40); celestial results must already pass their engine's plan threshold. Label the scope explicitly.
Coming up: chronological seven-day preview, at most one event per object/circumstance and two per
category, six overall; reserve one place per available category before filling remaining slots.
Never mix broad nonlocal announcements into local opportunities. Retain separate announcement data.
Launch calendar: at most two dated schedules and one announced period, never a local recommendation.
Precision-aware existing launch helpers handle statuses, changes, unknown visibility and freshness.

Initial render consumes existing satellite results only. Already calculated celestial plans are
retained in session memory with location/settings/weather/time identity. Already downloaded launch
feeds may be read from the existing bounded cache without fetching. No preview-only network request.
An explicit Build my sky guide action invokes the existing seven-day category plans and launch
loader once, reusing source/in-flight caches. No extra provider calls, astronomy engine or service.
Guide coverage says what was and wasn't calculated; missing data is never a quiet-sky claim.

## Presentation and navigation
Place compact discovery in the Phase 2 highlight position. Move the full satellite weekly card below
the main list; keep it fully available. Tonight is initially visible; Coming up and the separate
launch calendar use native expandable disclosures to keep the first screen compact. Existing hero,
category/period controls and themes remain. Add explicit Back to discovery, without persisting state.
Event actions carry source IDs plus category/horizon/night. Restore the correct retained plan before
focusing its card. No interpolated selectors, blind scrolling or obsolete location targets.
Happening now shows one existing prominence leader and a native disclosure for the others. All
warnings remain in each event; an overview warning notes additional orbital-only/uncertain events.
Keep the expanded state and focused event across minute renders; no fixed-height clipping.

## Evidence required
Pure adapter tests for boundaries/order/diversity/deduplication/precision/DST/stale and empty inputs;
browser tests for guide navigation, cache reuse, scope invalidation, simultaneous active intervals,
disclosures, themes, four widths, permission denial and actual screenshots. Preserve all scientific
fixtures and hashes. Update the homepage hierarchy test to assert the new discovery opportunity
instead of the relocated weekly card (retain weekly behavior tests). Measure before/after identical
fixtures, requests, script work, CLS, first useful/detailed event and collapsed/expanded active panel.
Run full Node/browser/Python/build checks and strict production/Actions verification.

## Implemented contracts
- Calendar export is a local, session-scoped action on the discovery card, the celestial card, the
  launch card and the pass dialog. It produces RFC 5545 text with UTC instants and a stable
  product-owned UID; the observing plan is in memory only and writes no preference key. See
  [calendar.md](calendar.md) for the eligibility, precision, UID and privacy rules.
- Tonight retains each category leader and displays the earliest leader first; additional leaders
  are under a disclosure. Strongest means within the original category only. No global winner claim.
- No data request or extra calculation is made during preview render. Explicit guide construction
  requests existing seven-day plans; a second build reuses them. Launch cache reads use the existing
  IndexedDB responses store, bounded to the existing seven-day retention policy, without a fetch.
  Opening a cached launch calendar checks the existing 15-minute source TTL.
- Initial view honestly has satellite coverage only. Never call an uncalculated category quiet.
  Plans last at most one hour in memory; location, timezone, minimum elevation, weather/load
  generation or observing-night identity invalidates them. No saved-preference schema changed.
- Coming up excludes exact Tonight IDs, reserves the earliest distinct event from each available
  category, then fills chronologically up to two per category and six total. No category score
  participates in chronological ordering. Duplicate source IDs merge caveats.
- Nonlocal celestial announcements remain separate adapter records and in the category planners'
  nonobservable diagnostics. They are never promoted to a locally observable card.
- Every local window names both local endpoints and timezone abbreviations, including midnight/DST
  folds. Calculated instants say so. Launch days retain the published UTC date, periods never acquire
  an exact timestamp, and provider statuses/changes/source/freshness remain visible or expandable.
  Optical demand, including solar filters, and weather/forecast coverage remain visible on every
  celestial card; the full caveat disclosure preserves the remaining limits.
- Satellite events below the existing Possible band (40), user score threshold, or user Great filter
  are not recommended. Group and favorite selections apply. Invalid timing is not actionable.
  Stale elements remain explicitly warned; missing weather stays provisional. No score is changed.
- The visible active leader uses the established prominence/elevation order. It may have a poor
  sighting score: an active orbital interval is not a predicted sighting. Additional event warnings
  remain in the disclosure, and counts of orbital-only/weather-incomplete intervals remain outside it.
- Native disclosures retain expansion across minute updates. Source IDs retain keyboard focus where
  possible; an expired discovery target returns focus to the guide. Layout changes for activation/
  expiration and genuinely longer warning text are allowed; no animation or clipping conceals them.
- Celestial navigation restores the retained source plan and exact card ID, at its real calculated
  horizon; no second calculation is needed. Satellite actions open original pass details and correct
  observing night. Exact/day launches focus dated cards; period-only schedules focus their period
  entries. Back to discovery preserves location, favorites and preferences.
- A celestial worker failure resolves the guide request with an explicit error instead of leaving
  construction pending; reopening that category uses the existing inline fallback.

## Deliberate limits
Unvisited categories have no computed result to reuse. A fresh visit therefore needs an explicit
Build my sky guide action for full coverage. This avoids unsolicited feed downloads and three new
scientific calculations on every homepage visit. Only loaded or explicitly requested data appears.
Expanded warnings and categories can make a long page; collapsed defaults stay compact. Broad
announcements are available in original category views, not a new all-sky announcement feed.
