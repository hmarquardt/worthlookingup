# Phase 6B.2 — the regional area explorer

**Status: shipped.** A reader in southern Indiana, southeastern Illinois or western Kentucky can now open
**Where to go** inside the Milky Way category and see the areas whose after-dark access is documented by the
managing agency, with a straight-line distance to the nearest mapped edge of each one.

There is no site ranking, no drive time, no darkness rating and no observation point. That is the release.

## What a reader sees

1. A door, not a download. The section says what it holds and offers **Show areas near me**; the module and the
data are fetched only when that is used.
2. The visitor's own window, labelled as theirs.
3. Four areas, in a plain list (the authoritative interface) with a sketch map beside it.
4. Each area expands to its manager, its stated after-dark access, the quoted agency evidence with an official
   link and the date it was read, its restrictions, its terrain status, its sky-brightness status and — in its
own list — what remains unknown.
5. One shared limitation list, and the attribution for the boundaries and the terrain context.

## Published areas

| area | manager | acres | after-dark evidence |
| --- | --- | --- | --- |
| Shawnee National Forest | USFS · National Forest · IL | 165,650 | overnight parking where posted, such as trailheads, for overnight camping |
| Garden Of The Gods Wilderness | USFS · Wilderness Area · IL | 3,978 | the same forest rule, plus: vehicles and mechanized equipment are prohibited inside the wilderness |
| Lusk Creek Wilderness | USFS · Wilderness Area · IL | 6,632 | as above |
| Sugar Ridge Fish & Wildlife Area | Indiana DNR · state conservation area · IN | 7,935 | "Property hours 24/7", with parking covered by that statement and recorded as an inference |

## What was excluded, and why

Seven reviewed candidates are **not** in the public artifact. Their identifiers do not appear in it at all, and
a test asserts that:

| candidate | classification | reason |
| --- | --- | --- |
| Glendale FWA (IN) | public, night unknown | the property page carries an Hours heading but no property access hours, and no after-dark statement |
| Hovey Lake FWA (IN) | public, night unknown | only office and visitor-centre hours are published |
| Harmonie State Park (IN) | public, night unknown | the published Hours block is office hours (9 a.m.–3 p.m.); office hours are not access permission |
| Patoka Lake (IN) | public, night unknown | federal reservoir designation; no managing-agency statement about after-dark access located |
| Higginson-Henry WMA (KY) | public, night unknown | the Kentucky agency site returned HTTP 403 to this review, so nothing could be confirmed |
| Wabash River – Mount Carmel (IL) | private | PAD-US records private ownership and management with no public permission |
| AEP Rockport (IN) | private | PAD-US flags it open-access while owner and manager are private; a dataset flag is not permission |

The last row is the whole argument of this phase in one line. Ownership is not permission, and a public-access
flag in a federal dataset is not a statement that anyone may stand there at 2 a.m.

## Re-verification, and its honest limit

Phase 6B.1 compiled the evidence; this phase re-read every agency page before publishing, and the record lives
in `src/geodata/access-verifications.json` with the quote, the URL, the date and the units a statement applies
to. Two things should be said plainly:

- The re-verification happened **on the same day** as the Phase 6B.1 review (2026-10-18). It is a genuine
  re-fetch, not an ageing of the earlier reading, and it is not an independent second opinion.
- The pages are not uniform, even inside one agency. Indiana DNR states 24/7 on Sugar Ridge, 7 a.m.–11 p.m. on
  Atterbury, office hours only on Harmonie and Glendale, and nothing usable on Hovey Lake. That is why each
  unit carries its own quotation instead of an agency-wide rule.

Evidence expires in the policy after a year, and an expired verification downgrades rather than persisting. No
scheduled job re-checks these pages; a human does, and the release notes say so.

## Areas, not observation points

The Phase 6B.1 inventory is a list of land parcels. A parcel centroid is not a trailhead, a gate, a parking
place or a place to put a tripod, so this release **does not promote any of them to an observation point**:

- Every record is `type: 'area'` and carries a mapped outline, not a point. No record has coordinates.
- Terrain is reported as **regional context only**: the steepest modelled direction at each of the pilot's
  eleven sampled points, with the sentence that a parcel has no single horizon and a clearance angle needs a
  specific observation point.
- Distance is **straight-line to the nearest mapped edge** of the area, computed client-side from the outline.
  An edge is a management boundary: not an entrance, not a road, not a destination, and never a drive.
- The window shown is the visitor's own, at the visitor's coordinates, because there is no verified point at
  which to recalculate it.

A test fails the build if a record gains coordinates, a parking place, a trailhead, a clearance angle, a drive
time, a darkness rating or a score.

## Light pollution stays unavailable

No dataset passed the Phase 6B.1 licensing gate, so nothing here rates darkness. The section carries the
sentence **"Local artificial sky brightness has not yet been assessed for these locations."** in the interface,
in every record and in the artifact. Upward VIIRS radiance is not converted, no Bortle class is derived, and no
area is described as dark. NASA Black Marble remains the one viable future source and is not a blocker for
this release.

## The data

| artifact | size | what it is |
| --- | --- | --- |
| `data/geodata/sites.json` | 80 kB raw, **8.1 kB gzipped** | four areas: outlines, evidence, restrictions, terrain context, unknowns, attribution |
| `overhead-sites.js` | 13 kB raw | validator, boundary distance, renderer; loaded on demand |
| `research/geodata/boundaries/*.json` | 24 kB | PAD-US polygons, simplified to a 320-point budget with the tolerance and any decimation recorded |

Generation is deterministic: `npm run geodata:sites` writes the artifact from the committed inventory,
the re-verification file, the boundaries and the pilot profiles, and `npm run geodata:sites:check` (which
`npm test` also runs) fails if the committed bytes drift. There is no runtime database, no new Cloudflare
service and no new secret.

Boundaries are PAD-US (public domain). Terrain context is 3DEP (public domain). Both are attributed in the
artifact and in the interface.

## Regenerating

```
npm run geodata:boundaries    # only when an area is added: PAD-US polygons, network required
npm run geodata:profiles      # only when the pilot profiles change: 3DEP, network required
npm run geodata:sites         # always offline, from committed inputs
npm run geodata:sites:check   # what CI runs
```

To add an area: add it to the Phase 6B.1 candidate inventory, fetch its boundary, record the agency statement
in `access-verifications.json` with `appliesTo`, regenerate. The generator refuses a record without verified
after-dark access, without a boundary, or with any forbidden field.

## Expiry is enforced twice

The access policy says a verified statement is good for a year and is then downgraded rather than kept. That
rule is applied in two places, because either one alone would eventually be wrong:

1. **At generation.** The generator classifies every candidate with the verification date as "now", so a stale
   statement cannot become a published record in the first place.
2. **At render.** The browser checks `verifiedAt` again against the real clock. An artifact that has not been
   regenerated for a year stops presenting its records as current: they move to a **Withheld: verification
   expired** list, each named with the date it was last confirmed and a link to the agency page to re-check, and
   the primary list and the map go empty. The empty state says why — "an old permission is not a current one" —
   and offers the re-check as the next step.

The same shell handles an artifact with **no** published areas: it explains the publication rule instead of
rendering an empty list. Four browser tests and four unit checks cover those states, including the exact
364/366-day boundary and a record with no date at all (which is never current).

## Known limitations

- **No observation points.** Nothing in this release tells anyone where to park. That needs a curated trailhead
  or lot with its own evidence, which is the next phase's work.
- **No darkness.** No area is described as dark, and none can be until a licensed dataset exists.
- **No drive time.** A straight-line distance to a boundary is not a drive, and the interface says so twice.
- **One region.** Outside the studied box the explorer explains the limit and the Milky Way calculations continue
  worldwide.
- **Boundaries are simplified** for display (documented tolerance, decimation recorded) and are management
  extents, not surveyed property lines.
- **Access is a snapshot.** Seasonal closures, hunting seasons and drawn hunts are listed as unknowns, not
  resolved.
- **No field verification.** Nobody from this project has visited any of the four areas.
