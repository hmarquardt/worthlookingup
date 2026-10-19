# Phase 7A release: equipment awareness, difficulty and the beginner's guide

Release: `2026.10.19.3`. Phase 7A adds three separated answers to every observing opportunity:

- **Opportunity:** the existing observing-suitability score, unchanged.
- **Difficulty:** a conservative, object-specific visual tier and, where meaningful, a separate imaging tier.
- **Equipment:** a recommended instrument/technique category, plus optional guidance against a local profile.

No astronomy, ranking, scoring formula, calendar writer or provider call changed. A faint comet still gets its
favourable opportunity score; the card now also says plainly that it is an advanced visual target.

## Taxonomy

| Level | Label |
| --- | --- |
| 1 | Easy |
| 2 | Accessible |
| 3 | Moderate |
| 4 | Challenging |
| 5 | Advanced |

These are Worth Looking Up's own guidance tiers, not an astronomical standard, a limiting-magnitude
calculation or a detectability model. The full contract is in [equipment-difficulty.md](equipment-difficulty.md).

## Object-specific implementation

- **Comets:** total magnitude is used conservatively, never as a stellar limiting magnitude. When the latest
  measurement is CCD and a 30-day median exists, the fainter value sets the visual tier. Photometry age controls
  confidence and is disclosed. Measured/predicted disagreement of at least 1.5 mag is reported, not resolved.
  `coma_diameter_arcmin` is carried with `unitVerified: false`; no surface brightness is derived.
- **Planets:** model magnitude plus an approximate angular diameter from the model geocentric distance and
  documented NASA equatorial radii. Identification, detail and imaging technique are separate. Uranus and
  Neptune stay telescope-only; Mercury and Venus carry the twilight limitation; seeing and empty magnification
  are explained.
- **Meteor showers:** naked-eye, wide-field primary; binoculars/telescopes are the wrong field of view; a
  camera is a separate trail-recording technique; ZHR is not a forecast.
- **Satellites/Starlink trains:** naked-eye wide field usually; binoculars only on bright passes; manual
  high-magnification telescope tracking is called advanced; camera trails and tracked imaging are separate.
- **Milky Way:** wide-field camera or naked eye; a telescope is explicitly unsuitable for the whole-sky
  landscape, while it can show individual clusters.
- **Eclipses:** lunar is naked-eye; solar requires a certified filter the app cannot verify.
- **Unknown types:** Difficulty uncertain, rather than a universal magnitude cutoff.

## Profile and guide

- Lazy `overhead-equipment.js` fetched only when the guide is opened from Settings, a difficulty block or the
  session builder.
- Local profile `worthlookingup.equipment/1` in `overhead.equipment.v1`; every field optional, bounded,
  normalised, migrating a legacy `kind`, tolerant of corrupt JSON.
- User-reported capability only: no manufacturer, serial, account or purchase history; never uploaded, never
  in analytics, never in the preference-transfer export.
- Equipment never hides an opportunity and never changes a score or rank.
- The guide covers naked eye, binoculars, visual telescopes, smart telescopes, cameras and advanced imaging,
  including aperture, magnification, field of view, mounts, tracking and the limits of each.

## Session integration

- A camera profile may prefill session sensor/focal length/aperture/tracking only when the plan has no camera
  choices.
- Saved plans and explicit session choices are never overwritten. The Prepare step says when values were
  prefilled or when a saved plan's camera differs from the current profile.
- The existing camera estimates remain the 500/300-rule family and still say they are rules of thumb.

## Card and accessibility changes

- Difficulty appears immediately below the card summary, not below orbital elements or catalog metadata.
- Two chips (Visual, Imaging), suggested approach, one reason and an optional profile fit are always visible;
  inputs, limitations, evidence/confidence and the "not a promise" statement sit in a native disclosure.
- Discovery cards carry one compact difficulty line; the satellite detail dialog carries the full block.
- Native labels/fieldsets/checkboxes, 44px profile rows, keyboard focus, no overflow at 390/768/1280/1440 in
  both themes. Six categories remain in their existing order.
- The opportunity score keeps its position and meaning. The Milky Way score remains its own window quality.

## Scientific and deterministic tests

- `tests/equipment-difficulty.cjs`: **25** deterministic checks — bright vs faint comets, 13.7/14.3/14.5
  fixtures, diffuse vs point-source, stale/recent photometry, measured/predicted disagreement, unverified coma
  units, missing magnitude, conditions modifiers, visual vs imaging, aperture tiers, no profile, binoculars,
  smart telescope, planet angular size, meteor/satellite/Milky Way/eclipse rules, unknown types, score
  immutability, profile migration/corruption.
- `tests/equipment.spec.js`: **7** browser tests — card difficulty, lazy module request, guide content, profile
  save/edit/reset, corrupt storage, comet card separation, camera session prefill, saved-session camera
  preservation, four widths/two themes, keyboard targets.
- `npm test` and `npm run check` pass; `tests/migration.cjs` includes the updated scientific-source baseline
  for the additive planetary/comet/celestial-plan changes.

## Faults found during acceptance

- The existing session checkbox focus ring used only `:focus-visible`; a programmatic focus in Chromium showed
  no ring. The session and equipment controls now also show focus on `:focus`.
- When the optional difficulty script was deliberately withheld, the page referenced it before checking that
  it existed and the satellite dashboard never booted. Difficulty access now goes through a missing-safe
  accessor; the metadata-unavailable test passes again.
- Editing a session camera field and then clicking Save could lose the click: the blur-triggered change
  re-rendered the panel and replaced the button under the pointer. The camera re-render is deferred one turn,
  so the save click completes with the new camera value.
- A calendar browser test compared the exported file with a different horizon's opportunity and could differ
  by a few seconds when discovery snapshots changed. It now compares the file with the item that was actually
  exported, preserving the real serialization assertion.

## Measurements

- `index.html` grew by about **3.5 kB gzip** (91,455 → 94,982 bytes). `overhead-difficulty.js` is a
  **11.6 kB gzip / 42 kB raw** eager module because every card uses it. `overhead-equipment.js` is a
  **4.6 kB gzip / 13 kB raw** lazy module fetched only when the guide opens.
- No homepage network request for the guide; no new dependency, provider, Worker, KV, D1 or R2.
- Existing scores and ranks are unchanged; the tests assert the assessment does not mutate an opportunity.

## Independent production scenarios

All checks passed against the deployed site using real catalog data and the real page:

- `C/2026 A2 (Bok)` appeared with **79/100** observing suitability and **Visual: Advanced**, an imaging tier,
  the "not a stellar limiting magnitude" statement and no numeric surface brightness. The score stayed 79/100
  through every equipment-profile change.
- `C/2024 J3 (ATLAS)` was present and **not** presented as easy visual observing.
- A bright planet grouping (Venus + Mars + Jupiter) received an easier visual tier than the faint comet.
- The Geminids meteor card recommended naked-eye, wide-field observing.
- A Milky Way window card recommended wide-field camera work and did not suggest a telescope as the primary
  instrument.
- With a binocular profile, the comet's fit said binoculars are beyond the range for that target; with a
  150 mm visual telescope it changed to the small-aperture qualified guidance; with a smart telescope it changed
  to imaging-oriented guidance. Resetting returned to general guidance.
- No page errors occurred in the real-data or Milky Way phases.

## Known limitations

- Difficulty is a conservative product heuristic, not a validated detection model.
- No sky-brightness measurement, seeing forecast, telescope transmission, pixel scale, observer experience or
  local horizon model is included.
- Coma units remain unverified; surface brightness remains unavailable by design.
- A planetary angular diameter is geometric and approximate; it is not an observed disc.
- The equipment profile describes reported capability, not calibrated performance.
- Solar-filter safety cannot be verified by the app.
- The guide is intentionally short and is not a buying catalogue.

## Deployment

- Code commits: `3b4b902` (difficulty, guide, cards, tests, docs), `19e773a` (missing-module resilience and
  the focus-ring fix found by CI), `48d30d2` (camera change no longer swallows the save click; coma-unit
  comment) and `b068623` (calendar browser test compares the interval with the item actually exported). All
  were pushed normally; `HEAD` and `origin/main` matched after each push.
- GitHub Actions `validate and deploy` run **39302090323** completed **success** on Chromium for the main
  feature commit. After the resilience/focus/camera fixes and the calendar-test hardening, the final run
  **39304585845** on `b068623` also completed **success** through validate, Chromium browser suite, build,
  Cloudflare Pages deploy and the production verifier. The validate job runs `npm ci`, `npm test`, launch
  check, comet precision/builders/meteors, `npm run test:browser`, `npm run build` and artifact upload.
- The staged `dist/` was also deployed independently through the existing Pages project (deployment
  `02fe9178`) so production verification could proceed while the Actions run was in progress. Production serves
  `2026.10.19.3`; the deployed HTML SHA-256 matched `dist/` (`a92d531d…` before the final documentation-only
  commit). The deployed `overhead-equipment.js` hash matched the checkout.
- `node scripts/verify-production.mjs https://worthlookingup.com --wait` — **PASS**: release, scientific hashes,
  both workers, data, brand/transfer/analytics bytes, real 404 and canonical/legacy redirects.
