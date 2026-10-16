# Discovery and planning release — 2026.10.15.5

## Outcome
A unified presentation adapter, not a new engine: Tonight shows the strongest available leader from
each category in time order, with one initially visible. Coming up offers up to six distinct events,
reserving available-category variety and limiting any one category to two. Launches occupy a separate
preview with provider precision, status, source, freshness and unknown local visibility.

Initial viewing adds no data-feed requests or calculations. The explicit Build my sky guide action
uses the existing seven-day planners and shared launch feed. Existing results are retained in bounded
session memory. A repeat build and source-card navigation reuse them. Uncalculated categories are
labelled as such. Full [contracts](discovery.md) describe score boundaries, data and navigation.

## Comparable measurements
Chrome, headless, 900px height, no network throttling, same September 7 ISS fixture and unavailable
weather for both releases. The initial guide has satellite coverage only, with limits shown.
Document coordinates in CSS px; active test uses seven simultaneous captured/cloned pass intervals.
All raw measurements and script timings: [phase-3-measurements.json](phase-3-measurements.json).
Reproduce with scripts/measure-discovery.cjs and the documented baseline HTML/CSS environment inputs.

| Width | First useful before → after | First detailed row before → after | Active panel before → collapsed / expanded | CLS before → after |
| --- | --- | --- | --- | --- |
| 390 | 558 → 558 | 1318 → 1348 | 1211 → 264 / 1052 | .0145 → .0153 |
| 768 | 569 → 563 | 1177 → 1268 | 920 → 210 / 856 | .0596 → .0596 |
| 1280 | 584 → 582 | 1130 → 1164 | 920 → 221 / 885 | .0010 → .0008 |
| 1440 | 586 → 584 | 1131 → 1165 | 920 → 221 / 885 | .0008 → .0006 |

The first detailed satellite row is slightly lower because discovery adds real planning controls;
the first actionable opportunity retains Phase 2's position. Moving the full weekly card below the
list limits the tradeoff. Main-thread ScriptDuration was 38–46ms before, 42–43ms after; these are
single-run lab samples and omit worker CPU, not a causal performance improvement claim. LCP was
76–140ms before and 72–112ms after in this local lab. No field Core Web Vitals claim.
Initial requests: 33 → 34 (one local 7KB presentation script); provider requests stay 4 → 4, preview
feed requests stay 0 → 0. Explicit guide construction loads three local celestial artifacts and one
same-origin launch feed, once each. No duplicate orbital/weather requests or remote provider service.

## Visual and accessibility evidence
[Before mobile](screenshots/phase3/before-mobile.png), [after mobile](screenshots/phase3/after-mobile.png),
[before desktop](screenshots/phase3/before-desktop.png), [after desktop](screenshots/phase3/after-desktop.png).
Built guide: [mobile light](screenshots/phase3/guide-mobile-light.png),
[desktop dark](screenshots/phase3/guide-desktop-dark.png).
Active intervals: [before](screenshots/phase3/before-active-mobile.png),
[collapsed after](screenshots/phase3/after-active-mobile.png).
All four widths and both themes captured under /tmp/wlu-discovery-{dark,light}-{width}.png and
/tmp/wlu-now-{dark,light}-{width}.png. No overflow or overlapping controls observed; no new animations,
fonts, photography or dependencies. Native details, 44px controls, keyboard focus, exact source-card
navigation, dialog dismissal and Back to discovery verified. No formal assistive-technology audit.

## Checks
- npm ci, npm test, npm run build, npm run check and offline launch-feed validation passed.
- Full browser suite: 39 passed, 2 intentional opt-in live-provider skips.
- New discovery suite: 4 passed; final focused rerun passed after minute/focus refinements.
- Pure adapter checks: mappings, within-category priorities, category diversity, deduplication,
  astronomical windows, midnight/DST, equipment/source warnings, stale/missing data, launch day/
  month/quarter/year precision and provider postponement/status handling passed.
- Python precision: 6 passed; comet --check, comet --no-network and meteor --check passed.
- Scientific source hashes and fixtures unchanged. Existing orbital/celestial/worker, storage,
  maps, themes, lifecycle, launch and redirect tests retained. Homepage position test now asserts
  the discovery opportunity at <600px; it no longer measures the relocated weekly summary.
- Production verifier now also checks the exact deployed discovery module bytes.

## Production evidence
Implementation commit, Actions/Pages deployment, independent strict production checks and live
screenshots will be recorded here and in migration-status.md after release.

## Limits and next task
A fresh page initially knows only existing satellite calculations; full category coverage is explicit
and on demand. The guide is not a historical rarity ranking or an all-category guarantee. Nightly
clouds, stale elements and optical demand can still prevent a sighting. Full warnings can grow when
expanded. Recommended next: allow a user to export selected observing windows to a calendar, with
explicit timezone, uncertainty and update semantics; keep approximate launches as approximate.
