# Photographic homepage release — 2026.10.15.4

## Result
A compact NASA Earth-at-night hero, editorial typography, dark ink and warm paper themes,
visible location control, all five categories visible on mobile, and the existing calculated weekly
highlight before the detailed briefing. No new ranking, feed requests, framework or client dependency.
Astronomy engines, scientific fixtures, lifecycle, storage schema and scoring are unchanged.

## Measurements
Chrome headless, 900px viewport height, same deterministic ISS orbit and fixed 2026-09-07 clock,
weather unavailable to exercise honest provisional labels. Coordinates are document CSS pixels.
The first useful event is the existing weekly calculated opportunity button, not the hero CTA.

| Width | Highlight before → after | Event-list row before → after | Hero before → after | CLS before → after | LCP before → after (ms) |
| --- | --- | --- | --- | --- | --- |
| 390 | 963 → 558 | 1497 → 1318 | 243 → 222 | .034 → .015 | 120 → 184 |
| 768 | 842 → 569 | 1242 → 1177 | 230 → 273 | .016 → .060 | 68 → 64 |
| 1280 | 860 → 584 | 1205 → 1130 | 235 → 294 | .005 → .001 | 60 → 88 |
| 1440 | 867 → 586 | 1212 → 1131 | 238 → 295 | .004 → .001 | 56 → 64 |

These are local unthrottled single-run lab observations, not field Core Web Vitals or a mobile-network
performance claim. The photo is 9.1KB at 640px, 31KB at 1280px, 84KB at 1920px; JPEG fallback 89KB.
Reserved weekly-card height removes the initial draft's .276 mobile CLS. Tablet remains .060, primarily
asynchronous briefing/data changes; all observed totals below .1. Arbitrarily long content can grow.
Do not hide warnings to improve geometry. No horizontal overflow at any tested width in either theme.

## Visual evidence
Actual production-before screenshots were captured in Chrome. The production-before and local
fixture render had identical geometry. After screenshots use the same deterministic orbit, with
explicit missing-weather/provisional warnings. Inspect:
- [Before mobile](screenshots/before-mobile.png), [before desktop](screenshots/before-desktop.png).
- [After mobile dark](screenshots/after-mobile-dark.png), [desktop dark](screenshots/after-desktop-dark.png).
- [After mobile light](screenshots/after-mobile-light.png), [desktop light](screenshots/after-desktop-light.png).
Full four-width/two-theme captures also at /tmp/wlu-final-{dark,light}-{390,768,1280,1440}.png.
Launch screenshots at /tmp/worthlookingup-launches-{dark,light}-{390,768,1024,1440}.png.

## Rights and accessibility
One photograph: NASA/JSC iss039e009160, Rick Mastracchio, Expedition 39. Catalog and NASA media-use
policy inspected; named astronaut photographer, no third-party credit, no identifiable person or NASA
logo in frame. Credit is visible and linked. Full source, policy, dates and modifications are in
assets/provenance.json. Original illustration remains a local background if the photo cannot load.
Sharing preview uses the same credited photo, locally served. No endorsement claimed.

Added keyboard skip link; all category controls and primary actions have 44px minimum height.
Focus rings, dialogs, reduced motion, charts, sources and uncertainty labels retained. Both themes
visually inspected. Image-failure test preserves content/action/geometry. No formal screen-reader
or complete WCAG audit was performed. Launch visibility remains unknown and optical-aid/cloud/
precision labels remain text, with existing semantic colors. No global launch enters local scores.

## Checks
- npm ci completed.
- npm test: scientific, launch, migration, source hashes, storage and redirect suites passed unchanged.
- Existing browser suite: 32 passed, 2 opt-in live-provider tests skipped.
- New homepage suite: 3 passed (hierarchy, all widths/themes, keyboard/dialogs, photo failure, staged assets).
- Python precision: 6 passed; comet --check, comet --no-network and meteor --check passed.
- npm run build, npm run check and launch-feed offline validation passed.
- Production verifier now checks every photo derivative's exact deployed bytes as well as the
  existing HTML, scientific hashes, workers, static assets, real 404 and ten redirect chains.

## Scheduled ingestion
Verified genuine event `schedule`, successful run 38788844841:
https://github.com/hmarquardt/worthlookingup/actions/runs/38788844841
Its refresh, offline validation, commit, Pages publish and deployed-feed verification steps all passed.
Independent GET /api/launches.json returned generated_at 2026-10-15T18:49:55.904Z, stale=false,
served_from=committed-feed at 19:30:23Z. Hourly cron remains minute 37. No KV introduced.

## Release evidence
Commit, Actions/deployment and final independent production verification are recorded in
migration-status.md after release. Ordinary main push only; preserve scheduled bot history.

## Limits and next improvement
One verified photograph deliberately replaces an unverified stock library. No new cross-category
ranking. First list row remains below the fold; the useful weekly opportunity is now above it.
Real-world weather/orbit source outages still produce honest fallback warnings. Recommended next:
a compact, explicitly scoped cross-category upcoming-events overview using existing engine outputs,
with local opportunities separate from globally scheduled launches. It needs a product decision on
comparison semantics before any new ranking.
