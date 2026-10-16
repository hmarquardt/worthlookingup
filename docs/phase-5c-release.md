# Phase 5C release report: evidence audit, pad index and direction research

Release `2026.10.16.2`. Three independent workstreams, in the order the phase asked for them: automated
integrity checks for the published trajectory evidence, less work for the launch calendar, and an honest
answer about mission-specific ascent directions.

Nothing in Phase 5A or 5B was loosened. No gate tolerance changed, no score changed, no satellite or
celestial calculation was touched, and no new claim about a rocket's visibility, brightness, plume or
sighting chance was introduced.

## 1. Monthly trajectory-evidence audit

- **Workflow:** `.github/workflows/trajectory-evidence-audit.yml` — monthly on the 3rd at 07:23 UTC, plus
  `workflow_dispatch`. Own concurrency group, `contents: read`, no `npm ci`, no push, no data artifact of
  its own, so it cannot block the hourly launch refresh.
- **Script:** `scripts/audit-trajectory-profiles.mjs` (read-only; fetches the sources, prints, writes a JSON
  report and a candidate review record outside `data/`).
- **Judgement:** `src/launches/trajectory-audit.mjs`, a pure module, so the failure paths are unit-tested
  offline instead of being inferred from a network run.
- **Checks:** 28 on the current publication (7 integrity per published profile plus artifact, index, digest
  and review-record checks; 5 drift checks per published profile when the sources answer).
- **Verified run:** `node scripts/audit-trajectory-profiles.mjs` on 2026-10-16 → `verdict: clean`, 28 passed,
  0 review, 0 unavailable, 0 failed, exit 0. Every external check was live: the launch instants were
  re-read from the GCAT launch log, the anchor orbits from the satellite catalogue, the pad coordinates from
  the launch-point table, and the terminal samples from each profile's own source URL.

Full policy and instructions: `docs/trajectory-audit.md`.

## 2. Evidence drift and safety policy

Summarised from `docs/trajectory-audit.md`; the important part is what happens by itself and what does not.

| condition | usable | review | suppressed | workflow |
| --- | --- | --- | --- | --- |
| no material change | yes | no | no | pass |
| source temporarily unavailable | yes | no | no | pass, with an `UNAVAILABLE` section |
| source changed, still inside both gates' tolerances | yes | no | no | pass, with the new numbers |
| source changed enough to invalidate a gate, or the anchor is gone | yes, as published | **yes** | not automatically | fail, with a candidate review entry |
| provenance ambiguous | yes | **yes** | by a human decision (`provenance.status: ambiguous`) | fail once flagged |
| published artifact integrity failure | no | **yes** | the product refuses the artifact at read time | fail |

Two properties were made mechanical rather than promised: **nothing is promoted** (no code path raises an
evidence level or restores a withheld output — a test asserts it), and **nothing is demoted automatically**
(the audit has no code path that writes the artifact, the pad index or the review record — a test asserts
that too).

Temporary suppression, when a human decides it is needed, is one small committed file,
`data/launches/trajectory-review.json`, applied at read time: `suppress-elevation` withholds the chart, the
timed window and the vehicle illumination while the direction and the provenance stay; `suppress-all`
withholds everything about the ascent. The recorded gate results are not rewritten, the panel shows them
next to the suspension, and a review record that does not validate suppresses nothing. It needs no rebuild
of any other dataset.

## 3. The compact pad index

- **Generated:** `data/launches/trajectory-pad-index.json` (schema `worthlookingup.trajectory-pad-index/1`)
  by `scripts/build-trajectory-profiles.mjs`, from the artifact it just validated, carrying the SHA-256 of
  the exact artifact bytes. Only pad key, pad name, coordinates, profile ids, mission names, launch
  instants, evidence levels, output classes and counts: no sample, no elevation, no azimuth, and a
  validator plus a test that refuse any such field.
- **Consumed:** `overhead-launch-explorer.js` loads the index, the small geodesy module and the pad-index
  validator for the launch calendar; the evidence module, the artifact and the review record load only when
  a reader opens the historical panel.
- **Guarantees:** a missing, invalid or stale index can only ever *remove* a pad's historical link. The
  panel cross-checks the index digest against the artifact it fetched and says so when they disagree, and
  never changes what it shows on the strength of the index.
- **Verified offline and in CI:** `npm test` rebuilds the index from the committed artifact and compares
  digests (`tests/launches-trajectory-audit.cjs`), and `tests/migration.cjs` asserts the staged index was
  built from the staged profiles.

## 4. Measured performance change

Measured on 2026-10-16, gzip as served, with `Accept-Encoding: gzip` and an ordinary user agent, against
production for both releases (so the "before" numbers come from the deployed 2026.10.16.1 and the "after"
numbers from the deployed 2026.10.16.2, not from local estimates).

**Before (release 2026.10.16.1, measured from production):**

| asset | transferred | when |
| --- | --- | --- |
| `overhead-launch-explorer.js` | 8,339 B | every page |
| `src/launches/launch-trajectory.mjs` | 22,563 B | opening the launches category |
| `data/launches/trajectory-profiles.json` | 7,258 B | opening the launches category |
| **launch category total** | **29,821 B** | before any historical panel is opened |

**After (release 2026.10.16.2, measured from production):**

| asset | transferred | when |
| --- | --- | --- |
| `overhead-launch-explorer.js` | 9,910 B | every page |
| `src/launches/launch-geodesy.mjs` | 3,451 B | opening the launches category |
| `src/launches/launch-pad-index.mjs` | 2,907 B | opening the launches category |
| `data/launches/trajectory-pad-index.json` | 530 B | opening the launches category |
| **launch category total** | **6,888 B** | before any historical panel is opened |
| `src/launches/launch-trajectory.mjs` | 21,635 B | only when the historical panel is opened |
| `data/launches/trajectory-profiles.json` | 7,258 B | only when the historical panel is opened |
| `data/launches/trajectory-review.json` | 343 B | only when the historical panel is opened |

The category-specific cost of the launch calendar falls from 29,821 B to 6,888 B: **22,933 B less, 77 %
less**. Including the adapter, the whole cost of the category falls from 38,160 B to 16,798 B. The honest
other half of the ledger: a reader who *does* open the historical panel transfers 29,236 B at that moment
instead of having paid 29,821 B on arrival, so the panel path is about 8.4 KB heavier than before, once,
for the minority who ask for it. That is the trade the phase asked for — the common path pays for the
common path — and it is why the panel assets are now genuinely deferred rather than merely named as lazy.

**Production browser probe** (Chrome, viewport 1280×900, ordinary user agent, against
`https://worthlookingup.com`, release `2026.10.16.2`):

- after arriving and opening the launches category, exactly three tracked requests had been made:
  `src/launches/launch-geodesy.mjs`, `src/launches/launch-pad-index.mjs`,
  `data/launches/trajectory-pad-index.json` — and **zero** requests for `launch-trajectory.mjs` or
  `trajectory-profiles.json`;
- eight launch cards drew a pad-direction line from real feed data (for example
  "Launch pad direction SSE (147°) at 1266 km, 6° below your horizon — the pad's direction, not the
  rocket's path."), and two carried a historical link;
- opening the historical panel then requested `launch-trajectory.mjs`, `trajectory-profiles.json` and
  `trajectory-review.json`, rendered the panel, and reported
  "Reconstruction passed both anchoring gates: direction, elevation and timed geometry are shown." with no
  staleness warning — which means the deployed index digest matched the deployed artifact in a real
  browser, not only in the tests.

Request-count evidence in a controlled browser is in `tests/launches-explorer.spec.js`: switching
categories and coming back re-requests none of the three, and the heavy pair stays unfetched.

## 5. Mission-direction research outcome

Full findings, source by source, with what each source actually establishes and the one real mission
investigation: `docs/mission-direction-evidence.md`.

The short version: for an upcoming Falcon mission there is currently **no** published mission-specific
ascent direction in any source reachable without authentication. The live launch feed carries the pad, the
orbit class name and a T-0 with a precision, and no direction field of any kind; the GCAT tables have no
azimuth column; the operator publishes events and orbit rather than headings; and range-authority notices
are hazard areas and corridors, which are constraints and not flight paths.

The investigation of USSF-481 (Falcon 9, SLC-4E, T-0 2026-10-16T00:01:05Z) therefore produced an
**incomplete, rejected candidate**: valid as a class-3 physical constraint, explicitly not permitted as an
ascent sector, with what is missing named. The launch calendar was not changed, and nothing was filled in
from a historical template.

## 6. The evidence contract

`src/launches/mission-direction.mjs` (schema `worthlookingup.mission-direction-evidence/1`) and
`tests/fixtures/launches/mission-direction-cases.json` (12 representative fixtures: 2 accepted, 9 rejected,
1 real and incomplete). Five classes — `published-mission-direction`, `reconstructed-mission-direction`,
`physically-constrained-direction`, `vehicle-family-analogy`, `pad-bearing-only` — of which only the first
two may ever be a candidate for an upcoming mission's sector, and only with a validated record, one
genuinely independent corroborating document, unexpired review and unambiguous provenance.

Refused mechanically, with tests: a hazard-area or corridor source filed as a flown direction; an
inclination-derived heading filed as class 1 or 2; a family analogy used as an upcoming sector; corroboration
that is a copy of the same document, a second document from the same author in the same form, or a source
type that cannot express a direction at all; a sector wider than 45°; a frame other than true north through
east; an expired review date; and ambiguous provenance. Nothing in the product imports the contract, the
deployment does not ship it, and tests assert both.

## 7. Scientific regression results

- `npm test`: 24 suites, all passing, including the two new ones and every 5A/5B suite unchanged. The 5A
  and 5B measured values that appear in their output are byte-identical to the pre-Phase-5C run
  (`libraryCoordinatesM 0.42`, `curvatureDifferenceDeg 3.13`, `padVersusDocumentedAzimuthDeg 15.4`,
  `worstPublishedSpeedPct 1.26`, `bestRejectedSpeedPct 4.78`), which is the evidence that extracting the
  geodesy module changed no behaviour: the trajectory module re-exports the same function objects and a
  test asserts the module's public surface still resolves through it.
- `npm run test:browser`: 57 tests, of which 55 passed and 2 skipped (the opt-in live-provider specs),
  run at desktop and mobile widths in both themes. The launches-explorer suite is 9 of them — the 5 from
  Phase 5B plus 4 new ones covering the index-only card path, a missing index, a review suspension, and a
  stale index that is reported but not obeyed — and it passes on its own (9 passed in 25.7 s) exactly as it
  passes inside the full run. The local full-suite command was killed by this machine twice while
  collecting the last few specs (Chrome memory pressure, no failure reported), so the suite was run in
  three overlapping parts: 37 passed + 2 skipped, 9 passed, 9 passed, which accounts for all 57.
- No gate tolerance, score, weighting or fixture value was changed in this phase.


## 8. Deployment and verification

- **Commit:** `9d9b0f8` ("Audit trajectory evidence and cut launch-page loading (Phase 5C)"), replayed on the
  data bot's `fffbc1a` schedule refresh (fetched first, rebased, no force) and pushed to `origin/main`;
  `git fetch` afterwards confirmed `origin/main` contains HEAD.
- **CI:** run [`38972609758`](https://github.com/hmarquardt/worthlookingup/actions/runs/38972609758)
  (*validate and deploy*) finished **success** in 2m47s, running `npm test` (24 suites), the launch-feed
  check, the Python precision test and both builders, the whole browser suite, `npm run build`, the
  Cloudflare Pages deploy and `node scripts/verify-production.mjs https://worthlookingup.com --wait`.
- **Monthly audit, run by hand:** the workflow was dispatched with
  `gh workflow run trajectory-evidence-audit.yml` → run
  [`38972635477`](https://github.com/hmarquardt/worthlookingup/actions/runs/38972635477) finished
  **success** in 19s, and its log shows the real verdict:
  `Verdict: **clean** — 28 passed, 0 need review, 0 unavailable, 0 failed.` So manual dispatch works, and
  the audit passes on a GitHub runner against live sources. The scheduled monthly run has not happened yet
  and is not claimed.
- **Production verification:** `scripts/verify-production.mjs` → **PASS** with the four new assets in its
  byte-equality list (deployed release `2026.10.16.2`); the launch schedule feed is served unchanged
  (`/api/launches.json`, schema `worthlookingup.launches/1`, 148 records, generated 2026-10-16T21:41:43Z by
  the data bot); the scientific engines and both workers are byte-identical to this checkout; the pad index,
  the review record and both new modules are served at the paths the browser asks for; the production
  browser probe in §4 confirms the loading behaviour and the index digest match in a real browser.

## 9. Files added or modified

**Added**

| file | role |
| --- | --- |
| `src/launches/launch-geodesy.mjs` | the observer-facing geometry, extracted verbatim from the trajectory module so the launch calendar need not load the evidence machinery |
| `src/launches/launch-pad-index.mjs` | the pad index builder, validator and pad matcher |
| `src/launches/trajectory-audit.mjs` | the audit's judgement: integrity, drift, summary, review proposals |
| `src/launches/mission-direction.mjs` | the mission-direction evidence contract (five classes, validator, sector accessor) |
| `scripts/audit-trajectory-profiles.mjs` | the read-only audit job |
| `data/launches/trajectory-pad-index.json` | the generated compact index |
| `data/launches/trajectory-review.json` | the evidence review record (empty by default) |
| `tests/launches-trajectory-audit.cjs` | audit, index and review policy tests |
| `tests/launches-mission-direction.cjs` | contract tests |
| `tests/fixtures/launches/mission-direction-cases.json` | accepted, rejected and real-but-incomplete direction fixtures |
| `.github/workflows/trajectory-evidence-audit.yml` | monthly audit workflow |
| `docs/trajectory-audit.md` | audit architecture and drift policy |
| `docs/mission-direction-evidence.md` | direction research findings and the contract |
| `docs/phase-5c-release.md` | this report |

**Modified**

| file | change |
| --- | --- |
| `src/launches/launch-trajectory.mjs` | imports and re-exports the geodesy module; the review record validator, the read-time review application and `review`/`gatePermissions` on the explorer result |
| `overhead-launch-explorer.js` | two loading paths (card: geodesy + index; panel: module + artifact + review), the review notice, effective-versus-gate summary, index digest staleness check, count-aware historical link |
| `scripts/build-trajectory-profiles.mjs` | emits the pad index with the artifact digest; `--check` now compares both files and their digests |
| `scripts/build.cjs` | stages the two new browser modules and documents why the contract and the audit are not deployed |
| `scripts/verify-production.mjs` | four new assets in the byte-equality list |
| `tests/migration.cjs` | staged-asset, index-digest and not-deployed assertions |
| `tests/launches-trajectory-profiles.cjs` | the interface-wiring assertions follow the centralised URL resolution |
| `tests/launches-explorer.spec.js` | four new browser tests (index-only card path, missing index, review suspension, stale index) |
| `agents.md`, `docs/launches.md`, `src/launches/readme.md`, `docs/migration-status.md` | the phase 5C rules, files and milestone record |
| `index.html` | release identifier `2026.10.16.2` |

## 10. Remaining limitations

- **No mission-specific direction exists.** See §5. An upcoming launch still shows the pad's direction and
  historical reconstructions of past flights from that pad, and nothing about its own ascent.
- **The audit's external checks depend on third-party formats.** A GCAT column rename or a
  no-longer-readable transcription turns a check `UNAVAILABLE` rather than a contradiction, which is safe
  but quiet; the monthly summary is the place to notice it.
- **The pad index matches pads by coordinate proximity (0.05°).** That is far tighter than the distance
  between two pads, and it is how the feed's `-120.611` and the catalogue's `-120.6106` are reconciled, but a
  genuinely relocated pad would need the index regenerated.
- **Coverage is still one pad.** Three profiles, all Vandenberg SLC-4E. The index makes adding more cheap
  (each new profile regenerates both files), but the anchors still need the same manual verification.
- **The panel now costs about 8 KB more, once, for the readers who open it** (§4). Deliberate.
- **Licensing is unchanged.** GCAT data is CC-BY-4.0 and the telemetry transcription is Unlicense; the
  operator's pages are referenced, not redistributed, and the direction contract records a licence field
  precisely because a future accepted record would need one.

## 11. Recommendation for the next milestone

1. **Anchor review as a habit, not a phase:** run `build-trajectory-profiles.mjs --check` by hand when the
   monthly audit reports a review item, and keep `visibility: 'unknown'` everywhere until a specific flight's
   trajectory is published.
2. **Broaden coverage where the evidence already exists** — insertion-state anchors for newer missions
   (Starlink-era series; the Iridium NEXT altitude question left open in 5B), using the same two gates and
   the same generator, since the index makes each addition cheap.
3. **Pursue a machine-readable hazard *direction* source** (not a polygon) as the only route to a
   mission-specific upcoming-flight sector, and record any candidate through the Phase 5C contract.
4. **Do not build a trajectory simulator.** The next visible improvement should come from better evidence,
   not better interpolation.

