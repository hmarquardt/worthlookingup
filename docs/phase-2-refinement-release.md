# Homepage refinement release — 2026.10.19.4

## Result

A presentation-only refinement of the photographic homepage and discovery guide. The existing NASA
Earth-at-night hero now names the active observing place in its overline and presents one filled sage
primary action, with the local-calculation reassurance as secondary text. Discovery cards expose one
explicit state chip — **Local opportunity**, **Scheduled · visibility unknown** or **Announcement · no
local window** — before the time and supporting detail, using the existing classifications.

No astronomy engine, scoring formula, orbital propagation path, launch-feed schema, worker, storage
key or category ranking changed. The launch schedule remains global; no launch card becomes a local
opportunity.

## Measurements

Chrome, 900px viewport height, deterministic ISS fixture and fixed 2026-09-07 18:00Z clock, weather
unavailable. Coordinates are document CSS pixels. The existing first useful event remains the weekly
calculated opportunity button.

| Width | First useful event before → after | Hero before → after | Horizontal overflow | Control overlap |
| --- | --- | --- | --- | --- |
| 390 | 557.9 → 557.9 | 222 → 222 | none | none |
| 768 | 562.5 → 562.5 | 273.3 → 273.3 | none | none |
| 1280 | 582.0 → 582.0 | 293.5 → 293.5 | none | none |
| 1440 | 583.8 → 583.8 | 295.3 → 295.3 | none | none |

The state chip is placed after the event title, so its extra line does not move the title or push the
first event lower. The hero action remains at least 44px tall and does not overlap the linked photo
credit at any tested width. Both themes were captured at all four widths.

## Visual evidence

- [Mobile dark](screenshots/phase-2-refinement-dark-390.png) · [mobile light](screenshots/phase-2-refinement-light-390.png)
- [Tablet dark](screenshots/phase-2-refinement-dark-768.png) · [tablet light](screenshots/phase-2-refinement-light-768.png)
- [Desktop dark](screenshots/phase-2-refinement-dark-1280.png) · [desktop light](screenshots/phase-2-refinement-light-1280.png)
- [Wide dark](screenshots/phase-2-refinement-dark-1440.png) · [wide light](screenshots/phase-2-refinement-light-1440.png)

Every capture uses the same fixture, so visual differences are presentation rather than different
orbital data.

## Rights

The single photograph is unchanged: NASA/JSC `iss039e009160`, Earth, aurora and Moon from the ISS,
photographed by Rick Mastracchio during Expedition 39. The source URL, NASA media-use policy,
attribution, derivatives, crop and acquisition date remain in `assets/provenance.json`. No new image,
font, icon or third-party request was added.

## Accessibility and behaviour

The place context is plain text in the existing `<p class="eyebrow">`; the action remains a real link
with a visible focus ring and a 44px target. State is conveyed in words as well as colour, and the
amber launch label remains distinct from the sage local label. The photo-failure test still preserves
the headline, local place, action, fallback illustration and calculated event. Category keyboard
navigation, dialogs, skip link, reduced motion and both themes are unchanged.

## Checks

- `npm test`: **PASS** (scientific, launch, migration, source-hash, storage and redirect suites).
- `npm run test:browser`: **PASS** — 116 passed, 2 intentional live-provider skips (full suite, 2.9m).
- Focused homepage/discovery suites: **7 passed**.
- `npm run build`: **PASS**; `dist/` staged from the public allowlist.
- Existing NASA photograph and all staged derivatives are unchanged and byte-verified by the
  production verifier.

A local unthrottled Chrome observation from the deterministic fixture measured LCP 128ms and CLS
0.0246 at 390px, LCP 108ms and CLS 0.0051 at 1280px, and LCP 100ms and CLS 0.0041 at 1440px. These are
lab numbers, not field Core Web Vitals or a mobile-network claim. The page's layout geometry, image
derivatives and request count are unchanged.

## Scheduled launch ingestion

A genuine GitHub `schedule` event completed successfully on 2026-10-19:
[run 39321749261](https://github.com/hmarquardt/worthlookingup/actions/runs/39321749261). Its refresh,
offline validation, commit, Pages publish and deployed-feed verification all succeeded. The deployed
feed reported 150 launches, `generated_at 2026-10-19T20:43:59.221Z`, `stale false`, source Launch
Library 2.

The preceding scheduled run
([39313384177](https://github.com/hmarquardt/worthlookingup/actions/runs/39313384177)) failed with
`upstream-malformed: upstream payload is not a launch page`; the committed last-good feed was left
untouched, and the next scheduled run recovered. This is the intended failure mode, not a
manual-workflow substitute. No KV, new cache or provider change was added.

## Release evidence

_To be completed after the CI deployment and production verification._

## Limits and next improvement

The homepage still shows one category leader in detail, and the first event list row remains below the
first mobile viewport. Local opportunities and global launch schedules are deliberately not ranked
against each other. No field calibration of difficulty tiers exists yet; the recommended next product
step remains a documented sky-brightness source and voluntary observer calibration, not a new
composite score.
