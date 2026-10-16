# Worth Looking Up: photographic discovery

Release direction, 2026-10-15. Preserve the vanilla application and every scientific source hash.

## Composition
Use an editorial Earth-at-night photograph, a warm serif headline and compact, plainly labelled
controls. The hero answers what the application does; the header always exposes the current place.
Keep the hero under 240px on phones. Move the existing weekly opportunity above the briefing so a
real calculated event reaches the first viewport. Do not introduce cross-category ranking or fetch
extra feeds for a decorative overview. All five categories remain visible on phones; the calendar's
90-day horizon stays in the category view.

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
