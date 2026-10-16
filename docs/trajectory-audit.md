# Trajectory evidence audit and drift policy

The published historical ascent profiles are not refreshed on a schedule. They are committed by hand, with
their gate results, their anchors and the digest of the artifact the pad index was built from. That means
they can only become wrong in one of two ways: an external source changes underneath them, or somebody
edits a file. The monthly audit exists to notice both before a reader does.

## What runs, and when

`.github/workflows/trajectory-evidence-audit.yml`, on the third of each month at 07:23 UTC, and on
`workflow_dispatch` for a manual run. Deliberately not on the hour, and in its own concurrency group, so it
can never meet the hourly launch refresh or the celestial-data workflows.

It is read-only, in a job whose permissions are `contents: read`:

- it writes nothing to the repository and pushes nothing;
- it owns no published data artifact, so it cannot block the hourly launch-feed refresh, which runs in a
  different workflow with a different concurrency group;
- it needs no `npm ci` — it imports only the repository's own modules and Node's standard library, so a
  broken dependency tree cannot stop the audit and the audit cannot break anything else;
- its outputs are the console, the GitHub step summary, a JSON report, and — only when drift is found — a
  *candidate* review record written to `trajectory-audit-out/`, never to `data/`.

Run it by hand with:

```
node scripts/audit-trajectory-profiles.mjs                       # live sources
node scripts/audit-trajectory-profiles.mjs --offline             # cached sources where available
node scripts/audit-trajectory-profiles.mjs --json out.json --emit-review out/
```

`npm test` covers the judgement itself offline (`tests/launches-trajectory-audit.cjs`), because the
failure paths — a contradictory source, an unreachable source, a hand-edited permission, a stale index —
are the parts that have to be tested without a network.

## What it checks

Integrity, from the committed files alone (`src/launches/trajectory-audit.mjs`, `auditIntegrity`):

1. the artifact validates against the published-profile rules the product holds it to;
2. the compact pad index validates, and its `artifact_digest` equals the SHA-256 of the committed
   artifact bytes, so a stale index is detected rather than suspected;
3. the evidence review record validates (schema, known actions, a reason and a date on every entry);
4. every published profile reproduces its own recorded gate results from its own numbers and anchor;
5. every published profile's stated permissions follow from its recorded gates;
6. every published profile's evidence level is still the level its code and provenance kind imply — the
   audit detects a change here and stops; it never moves a level in either direction;
7. any active review entry is repeated as a review item, so an already-suspended profile is never mistaken
   for a clean one.

Drift, against fresh copies of the sources (`auditAnchor`):

| what is compared | source | tolerance |
| --- | --- | --- |
| launch instant | GCAT launch log | one minute (a log that adds seconds is a refinement, not drift) |
| anchor orbit: perigee, apogee, inclination | GCAT satellite catalogue | 1 km, 1 km, 0.05° |
| the terminal gate, recomputed against the live orbit | derived | the published gate tolerances (3 % speed, 25 km altitude) |
| pad coordinates | GCAT launch-point table, matched by name | 0.05° (about 5 km) |
| the reconstruction's terminal sample | the profile's own `sourceUrl` | 1 m altitude, 0.1 m/s speed |

These are deliberately wider than the gate tolerances: they answer "has the record changed", and the gate
is recomputed separately against whatever the source now says.

## The drift policy

| condition | profile stays usable? | human review? | output suppressed? | workflow | deployment |
| --- | --- | --- | --- | --- | --- |
| No material change | yes | no | no | pass (exit 0) | none |
| Source temporarily unavailable (network, 5xx, a row we cannot match) | yes, unchanged | no | no | pass, with an `UNAVAILABLE` section (exit 0) | none |
| Source changed, geometry still inside both gates' tolerances | yes | no; reported as a pass with the new numbers | no | pass (exit 0) | none |
| Source changed enough to invalidate a gate, or the anchor record is gone | yes, exactly as published | **yes** | not automatically: the record is unchanged until a human commits a review entry | fail (exit 1), warning annotation plus a candidate review entry | a review entry is a small, reviewable commit |
| Source identity or provenance becomes ambiguous | yes | **yes** | no automatic suppression; a human sets `provenance.status` to `ambiguous`, which withholds the sector | fail once the drift is visible | deliberate commit |
| Published artifact integrity failure (permissions disagree with the gates, index digest mismatch, missing index or review record, hand-raised evidence level) | no: the publication is internally inconsistent | **yes** | the product refuses the artifact at read time, so a reader sees a refusal rather than a number | fail (exit 1) with an error annotation | fix and redeploy |

Two rules are absolute:

- **Nothing is promoted.** No code path in the audit raises an evidence level, restores a withheld output or
  rewrites a gate result. A source update cannot make a historical reconstruction stronger.
- **Nothing is demoted automatically.** A drift finding produces a proposal, not a change. The audit has no
  code path that writes `trajectory-profiles.json`, `trajectory-pad-index.json` or `trajectory-review.json`,
  and a test asserts those writes do not exist.

## Temporary suppression, when a human decides it is needed

`data/launches/trajectory-review.json` (schema `worthlookingup.trajectory-review/1`) is a small, committed,
validated list:

```json
{ "schema": "worthlookingup.trajectory-review/1", "reviewed_utc": "2026-10-16", "entries": [
  { "id": "formosat-5-2017-049", "action": "suppress-elevation", "since": "2026-10-16",
    "reason": "the catalogued orbit moved and the terminal gate is being re-checked",
    "evidence": "the drift table in the 2026-11-03 audit run" } ] }
```

- `suppress-elevation` withholds the elevation chart, the timed window and the vehicle illumination. The
  direction, its uncertainty and the provenance stay, exactly as they do for a profile that failed a gate.
- `suppress-all` withholds everything about the ascent, including the direction.
- `none` records that a review happened and found nothing; it changes no output.

Applying an entry never rewrites history: the recorded gate results stay in the artifact, the panel shows
them next to the suspension, and the refusal states the review reason and date. The mechanism needs no
regeneration of any other dataset — it is one small file the explorer reads alongside the artifact — and an
entry in a record that does not validate suppresses nothing, so an unreadable safety file can never
authorise output.

The audit never writes that file. When it finds drift it prints the exact entry a human could commit, and
`--emit-review` writes the candidate outside `data/` for review.

## How to read a run

- One `UNAVAILABLE` section and nothing else: read the reason. A provider outage, a rate limit, a document
  that stopped being machine-readable and a renamed source all look the same from here, and none of them is
  evidence about the profile. Nothing to do.
- One `REVIEW` with numbers: open the drift table, compare the new value with the committed one, and decide
  whether the profile's own evidence still stands. If it does, re-verify by hand and update the record
  through the normal generator path (never by editing numbers in the artifact). If it does not, commit a
  suppression entry while that re-verification happens.
- A `FAIL` on integrity: the publication is internally inconsistent, which is a bug rather than science.

