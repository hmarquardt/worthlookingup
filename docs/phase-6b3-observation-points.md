# Phase 6B.3 — verified observation points

**Status: shipped.** The Where to go explorer now lists three specific facilities where a photographer may
legitimately be after dark, each with its own coordinate provenance, its own quoted evidence, its own terrain
result and its own Milky Way window.

The success criterion was never a number of pins. It was whether the product can point at a real facility and
say: *this is a documented location, this is what the agency permits, this is what remains uncertain, and this
is when the core is above it.*

## Where the facilities came from

The Forest Service publishes every recreation facility with its name, a point, an activity group, operational
hours and restrictions, in the agency's own words, through its Enterprise Data Warehouse. That dataset is the
reason a facility-level decision is possible at all: a forest-wide rule can say "overnight parking at
trailheads", but only the facility record can say *which* trailhead, or that a picnic area closes at 10 p.m.

**33 facilities** in the Shawnee National Forest were retrieved and reviewed on 2026-10-18.

## Accepted: three points

| point | facility type | coordinate provenance | why it is published |
| --- | --- | --- | --- |
| **Camp Cadiz Campground** | campground | agency marker (EDW point), ±50 m | camping is permitted year-round at designated campsites, which is overnight presence with a vehicle |
| **Tower Rock Campground** | campground | agency marker (EDW point), ±50 m | camping is free and limited to 14 days, in season 1 May – 15 December |
| **Garden of the Gods backpacker parking (Indian Point Trailhead)** | trailhead parking | **OpenStreetMap node** (third-party), ±30 m | the facility record permits "overnight parking … at Backpacker's Parking Lot **only** (Indian Point Trailhead)", and closes the picnic area and Observation Trail 10 p.m.–6 a.m. |

Every point carries two axes that are never collapsed into one boolean:

- **night presence**: verified for all three (camping permission, or the named overnight-parking allowance);
- **parking**: `verified` for the trailhead lot, `verified-at-designated-campsite` for the campgrounds — a
  campsite is not a general overflow lot, and a dawn-only visitor is not a camper.

## Rejected: four facilities, with the evidence that refused them

| facility | decision | reason |
| --- | --- | --- |
| **Illinois Iron Furnace Historic Site** | reject | the agency record says **"No overnight parking"** — an explicit prohibition |
| **High Knob Lookout** | reject | day-use only, 6 a.m.–10 p.m.; overnight parking is allowed outside the site near the stone pillar entrance, and the agency publishes no point for that spot |
| **Oakwood Bottoms & Turkey Bayou Campground** | reject | the agency record reports the campground and boat launch **temporarily closed due to flooding** |
| **Trigg Observation Tower** | reject | the forest's own alerts page listed it as temporarily closed, and the record says nothing about overnight use |

**23 further facilities** (fishing lakes, day-use picnic areas, trail systems, research natural areas, canoe
access) were reviewed and left **unverified**: nothing in their records addresses overnight presence, and silence
is not permission. The Lusk Creek canoe access is the clearest example — camping is prohibited in the wilderness
natural areas, so the access point cannot be assumed to be an overnight location.

**Three further facilities would have qualified but lie outside the studied region** — Pine Hills Campground
(89.42°W), Redbud Campground at Bell Smith Springs (88.66°W) and the Panther Den Wilderness trailhead
(89.09°W), all west of the 88.60°W edge the area explorer has used since Phase 6B.2. They stay in the research
inventory with their evidence intact; widening the region is a deliberate step, not a side effect.

## Coordinates, honestly labelled

Two provenances, two labels, no blurring:

- **agency marker** — the point geometry the Forest Service publishes with the facility record. Described in the
  interface as "a marker for the facility, not a surveyed point, and not the centre of the surrounding land",
  with an estimated precision of ±50 m.
- **third-party map** — the OpenStreetMap node "Backpackers Parking", used only because the Forest Service names
  the lot without placing it. The interface says so: "a community-mapped feature and not an agency survey", ±30 m.

No point is a parcel centroid. A test asserts every point sits inside its parent area's mapped extent, at least a
kilometre from that area's centre, and carries a facility name different from the area's.

## Terrain, and what it cannot say

Each point got a 3DEP extract (1024² over 32 km, about 31 m per pixel) and a 16-azimuth horizon profile, with the
clearance evaluated at **three moments** — the start of the window, the core's best moment and its end — because
the core moves (Camp Cadiz: azimuth 158.5° → 179.9° → 174.4°).

| point | modelled horizon | core altitude | clearance | uncertainty |
| --- | --- | --- | --- | --- |
| Camp Cadiz Campground | 0.42°–0.52° | 20.0°–23.4° | 19.6°–22.9° | ±0.5° |
| Tower Rock Campground | 0.36°–0.44° | 20.0°–23.6° | 19.6°–23.1° | ±0.5° |
| Garden of the Gods backpacker parking | 3.50°–3.98° | 20.0°–23.4° | 16.5°–19.4° | ±1.7° |

The backpacker lot sits under the bluffs, and the model says so. Every record repeats the caveat: bare earth
only, trees and buildings are not in it, and in a wooded campground they are the likely horizon.

## Astronomy at the point

A point's window is computed **at the point's own coordinates and timezone**, never borrowed from the visitor.
The artifact carries a reference night (2027-04-13, the first favourable season night from Phase 6A.1) and the
page computes tonight at the point when the explorer opens. Both are labelled with their dates. The visitor's
saved home site is never touched, and a browser test asserts it byte for byte.

## Calendar and observing plan

A point's window enters the ordinary machinery: the shared opportunity model, the discovery mapper and the ICS
writer. The event id includes the point, so it can never collide with the visitor's own event for the same night,
and the calendar entry carries the point's name and coordinates:

```
LOCATION:Camp Cadiz Campground (America/Chicago)
```

No drive time, no departure time and no directions are written anywhere. Weather is described as belonging to the
visitor's own location only.

## Light pollution

Unchanged and unrelenting: no Bortle class, no radiance-to-brightness conversion, no darkness rating. Every point
carries "Local artificial sky brightness has not yet been assessed for these locations."

## Regeneration

```
npm run geodata:point-candidates   # USFS EDW facilities for the forest, with the review decisions
npm run geodata:point-profiles     # 3DEP + astronomy per published point, network required
npm run geodata:points             # the public artifact, offline
npm run geodata:points:check       # what npm test runs
```

Re-verification is manual: re-read the facility record and the forest page, update `verifiedAt`, regenerate.
Evidence older than 365 days is withheld in the browser ("Withheld points: verification expired") rather than
kept as current.

## Known limitations

- **Three points**, all in one forest. No state-park, state-forest or Kentucky facility qualified: Sugar Ridge
  publishes 24/7 property hours but no facility point, and the Kentucky agency site refused this review.
- **A campground is not a viewing platform.** The permission is to camp; the horizon is bare earth; trees are
  likely.
- **One coordinate is third-party.** The GotG lot is placed by OpenStreetMap, labelled as such, and should be
  confirmed on the ground.
- **No weather at the point**, no darkness, no drive time, and no visit by anyone from this project.
- **The reference night is 2027-04-13.** Tonight's calculation is live; the reference is a fixed planning date.
