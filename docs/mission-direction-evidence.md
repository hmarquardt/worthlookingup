# Mission-specific ascent direction: what public evidence actually exists

Phase 5C asked whether an upcoming Falcon 9 or Falcon Heavy mission ever has an independently verifiable
ascent azimuth, and what a defensible evidence process for one would look like. This is the answer, source
by source, with the parts that could not be established written down as plainly as the parts that could.

The contract these findings feed is `src/launches/mission-direction.mjs` (schema
`worthlookingup.mission-direction-evidence/1`), with representative fixtures in
`tests/fixtures/launches/mission-direction-cases.json`. Nothing in the product imports it: a validated
record is a candidate for review, not permission to publish.

## The five kinds of "direction" evidence

| # | class | what it is | may drive an upcoming mission's sector? |
| --- | --- | --- | --- |
| 1 | `published-mission-direction` | this mission's operator or range authority stated the ascent direction, in a documented frame | yes, with independent corroboration |
| 2 | `reconstructed-mission-direction` | derived from this mission's own evidence with a published method and a stated uncertainty | yes, with independent corroboration |
| 3 | `physically-constrained-direction` | bounded by something real (an inclination, a hazard area, a corridor) but never observed as a flown heading | **no** — a constraint is not a direction |
| 4 | `vehicle-family-analogy` | how this vehicle class has flown before, from this pad or any other | **no** |
| 5 | `pad-bearing-only` | where the pad points | **no** |

Three rules in the validator are the whole point of the phase:

- **A derived heading is not independent verification of itself.** A heading computed from an orbital
  inclination may only be filed as class 3, because the derivation and the thing it would be checked against
  are the same piece of evidence. It cannot support a claim about how a particular vehicle flew.
- **A hazard polygon is not a flight path.** A hazard area or a launch corridor may only be class 3, and must
  carry that limitation in writing.
- **A historical flight from the same pad is not evidence about an upcoming flight.** A family history may
  only be class 4, and matching a vehicle family, a launch site or a hazard polygon to an upcoming launch is
  refused by construction, because only classes 1 and 2 can ever be eligible.

Corroboration is defined strictly, because "two sources" is easy to fake by accident: an entry counts only
when it is marked independent, is a different document from the primary, is not one of the source types that
cannot express a direction at all, and differs from the primary in kind or in author. A second copy of the
same press kit, and a second derivation from the same inclination, corroborate nothing.

## Source inventory

Verified on 2026-10-16 against the sources named, with `curl` and `fetch`.

| source | publisher | recency | mission-specific? | what it establishes | machine-readable | commercial use | corroborable | class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Launch Library 2 detailed launch record | The Space Devs (the feed this site already serves) | continuously updated | yes, per launch | pad coordinates, orbit **class name**, T-0 and its precision, window, status. Checked directly: the detailed record for the next Falcon 9 from SLC-4E carries **no** direction, azimuth, heading, corridor or hazard field, and no inclination | yes (JSON) | check the publisher's terms; already relied on for the schedule | n/a | none |
| GCAT launch log, satellite catalogue, launch-point table | J. McDowell | updated daily; the copies read on 2026-10-15/16 | yes, per flight | launch instant, per-piece insertion orbit, pad position. Checked directly: **no azimuth column exists** in any of the three tables | yes (TSV) | CC-BY-4.0 | yes, against a second catalogue | none (already used for the historical anchors) |
| SpaceX mission page and webcast | SpaceX | per mission | yes | mission name, vehicle, pad, window; the webcast describes the ascent in words | no (the mission page is script-driven; the webcast is video) | not licensed for reuse | no | at most class 3 |
| SpaceX press kits, as archived by third parties | SpaceX, archived elsewhere | the current format lists events and orbit, not headings | yes | timeline, orbit, payload; no ascent heading | PDF/HTML only | archival copies are third-party, not licensed | no | none |
| Environmental assessments for a launch programme (for example the Vandenberg Falcon 9 SLC-4E series) | US Space Force / FAA process | per programme, years apart | **no** — programme and orbit class, not per flight | the azimuth ranges a programme may use, and its hazard areas | no (PDF) | government publication; redistribution not assumed | partially | 3 at best |
| Launch hazard area, airspace and maritime notices | range authority, US Coast Guard | per launch | yes | closed areas, corridors and time windows, by corner coordinates | no (PDF and notice boards; the source pages returned HTTP 403 to this environment) | government publication | partially | 3 |
| Instrumented reconstruction of a **past** flight (for example the SAOCOM 1A analysis already used for a published profile) | third-party analysts | per flight, after the fact | yes, for that flight | that flight's flown azimuth, with a stated method and uncertainty | paper/PDF | analysis published for reuse with attribution where stated | yes, from a second observation | 2, for the past flight only |
| Launch-pad position | GCAT launch points, feed record | stable | n/a | where the pad points from an observer | yes | CC-BY-4.0 | yes | 5 |

## What this means for an upcoming mission

There is currently **no class-1 source** for an upcoming Falcon mission: nothing reachable publishes that
mission's ascent azimuth. Class 2 cannot exist before a flight, because a reconstruction needs the flight. So
an upcoming mission can currently be described only as a class-3 constraint or weaker — which means it cannot
be described as a direction at all. The product therefore continues to show:

- the pad direction, labelled as the pad's direction and not the rocket's path, and
- reconstructed ascents of **past** flights from the same pad, labelled historical, with their own dates and
  provenance.

Mission-specific evidence would need one of these to become available: an operator that states an ascent
azimuth; a range authority that publishes a machine-readable mission-specific hazard *direction* rather than
a polygon; or a second independent reconstruction of the same flight, which cannot exist before the flight.
None of those is under this project's control, which is why the phase produced a contract instead of a
feature.



## The one real investigation

**Mission:** USSF-481, Falcon 9 Block 5 from Space Launch Complex 4-E, Vandenberg. T-0 2026-10-16T00:01:05Z
(second precision), recorded by the live feed as "Government/Top Secret", into an orbit the feed names
"Polar Orbit".

**Chain of evidence, in order:**

1. The live detailed launch record (`ll.thespacedevs.com`, read 2026-10-16) gives the pad (34.632, -120.611),
   the T-0 and its precision, the window and the orbit **class name**. Its `mission.orbit` object carries no
   inclination, and the record has no direction, azimuth, heading, trajectory, corridor or hazard field.
   → nothing directional.
2. The operator's mission page and webcast: no azimuth; the ascent is narrated in words.
   → nothing numeric, nothing machine-readable.
3. The GCAT launch log, satellite catalogue and launch-point table (read 2026-10-15/16): no azimuth column
   anywhere, and the catalogue can only describe a *past* flight's achieved orbit.
4. Range-authority hazard notices for this pad: the source pages returned HTTP 403 to this environment, and
   the notices are hazard areas and corridors rather than directions. Reachable or not, they would supply a
   class-3 constraint at best.
5. The target orbit is not published for this mission, so the plane cannot even be fixed: an orbit class is
   not an inclination, and an inclination without a launch time and a pad allows a range of headings, with a
   dogleg or a plane change not excluded.

**Outcome: an incomplete, rejected candidate.** The record is filed as
`incomplete-ussf-481-pad-and-orbit-class-only` in the fixtures: valid as a class-3 physical constraint,
explicitly **not permitted** as an ascent sector, with what is missing named in its own limitations. What
would change the answer: an operator or range-authority statement of this mission's ascent azimuth, or a
bounded sector, in a documented frame, plus one independent corroborating document of a different kind. No
historical template was substituted, and the launch calendar was not changed.

## Prohibited claims, unchanged by this phase

No rocket visibility, no brightness, no plume size, no sighting probability, no historical reconstruction
presented as a future trajectory, no hazard polygon interpolated into a flight path, no vehicle-family
trajectory attached to a specific launch, and no elevation or viewing window derived from a direction that
was never published. Local visibility for an upcoming launch stays `unknown`.
