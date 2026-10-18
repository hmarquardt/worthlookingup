# Can Worth Looking Up say where to go? A geographic-data feasibility study

**Status: research completed, prototype built, nothing published.** No location recommendation, map layer or
candidate site appears in the public application. This document records what the data allows, what it forbids,
and what the smallest honest next step would be.

The question was: *can we move from "here is when the sky will be right" to "here is a place you can
responsibly consider going"?* The short answer is **yes for terrain and access, no for sky brightness, not
yet for driving** — and the access answer is the one that decides whether the feature can exist at all.

## Why the three dimensions stay apart

| dimension | what it answers | what it cannot answer |
| --- | --- | --- |
| sky quality | how much artificial light is above this place | whether the sky will be clear, transparent or free of smoke |
| physical visibility | does bare ground rise into the direction of the core | whether trees, crops, buildings or a levee do |
| practical access | may somebody legally be there after dark, and leave a car | whether the gate is open tonight, or whether it is safe |

A single number across these would hide exactly the disagreement that matters. The prototype therefore
returns a verdict per dimension, the evidence behind it, and the gaps — and a test asserts that no combined
score, rank or travel time exists anywhere in the output.

## Light pollution: what the datasets actually are

Every candidate was checked against its publisher's own metadata on **2026-10-18**. Resolution, units, access
and licence are recorded in `src/geodata/sources.json`, which the licensing gate reads.

| source | what it measures | resolution | vintage | access | licence |
| --- | --- | --- | --- | --- | --- |
| **Falchi et al. 2016, World Atlas of Artificial Night Sky Brightness** (GFZ Data Services, doi:10.5880/GFZ.1.4.2016.001) | modelled **artificial zenith sky luminance**, mcd m⁻², from VIIRS DNB 2015 propagated through a radiative-transfer model calibrated on Sky Quality Meters | 30″ (≈900 m) | 2015 | 2.9 GB GeoTIFF, **FTP by request form** | **CC BY-NC 4.0** — non-commercial only |
| **EOG VIIRS Nighttime Lights V2.1/V2.2** (Colorado School of Mines) | **upward radiance**, nW cm⁻² sr⁻¹ | 15″ (≈450 m) | 2012→present, annual | web portal; **every download directory redirected to a sign-in page** when checked | CC BY 4.0 per the product page |
| **World Bank — Light Every Night** (AWS Open Data) | upward radiance, per-orbit nightly scenes | 15″ | 2012–2020 | **anonymous S3, no account** | registry says "World Bank Open Database License (ODbL)" but links **CC BY 4.0** — contradictory |
| **NASA Black Marble VNP46A4** | upward radiance, lunar- and atmosphere-corrected annual | 500 m | 2012→present | LP DAAC, **Earthdata token required**, HDF5 tiles | NASA open data policy — public domain in effect |
| **Lorenz Light Pollution Atlas 2025** | modelled artificial zenith brightness, from EOG VIIRS | 1/120° (≈900 m) | 2025 | **PNG maps and a viewer only**; no numeric raster download | no licence statement |
| **DMSP-OLS (EOG)** | digital numbers (uncalibrated) | 30″ | 1992–2013 | login-gated | CC BY 4.0 per the product page |
| **lightpollutionmap.info** | aggregator of the above, Bing basemaps | — | — | its own FAQ states the underlying atlas is **CC BY-NC 4.0** and points to NASA VNP46A4 for raw data | rendered GeoTIFFs have no stated licence: not reusable |

### The consequences, stated plainly

1. **Upward radiance is not sky brightness.** A satellite measures light leaving the ground. Turning that into
the luminance at an observer's eye needs an emission spectrum, an aerosol profile and a radiative-transfer
model — which is precisely what Falchi et al. did. The prototype therefore exposes two units and **refuses**
the conversion: a radiance sample has no magnitude-per-arcsecond value, and comparing a radiance sample with
a sky-brightness sample returns `comparable: false` with that reason.
2. **Within one unit, comparison is exact.** Two mcd m⁻² samples give a ratio and a magnitude difference
(2.5 log₁₀ of the ratio). Two radiance samples likewise. Nothing is compared across units.
3. **The natural sky is added, never assumed zero.** A pristine site is about 22.0 mag arcsec⁻²
(0.17 mcd m⁻²) of airglow, zodiacal light and the Milky Way itself. The published atlas covers **artificial
light only**, so `combineWithNaturalSky()` adds a stated natural value before anything is called a total sky
brightness — and the number is labelled as an assumption, not a measurement of the place.
4. **A masked pixel is unavailable, never dark.** A zero in a radiance composite usually means the pixel was
masked, not that nowhere is lit. Every sample carries `value: null` and a reason; a zero cannot be used in a
ratio.
5. **No Bortle class.** Bortle is a subjective naked-eye scale over the whole sky; the atlas is a modelled
zenith luminance. The author of the Lorenz atlas asks explicitly that the two not be conflated, and a test
asserts that no function or record in this layer contains the word.

### The verdict for a public product

**No sky-brightness or radiance source is production-eligible today.** The gate computes this from the
recorded facts rather than trusting a flag:

- Falchi 2016 is legally usable for research and **cannot** be used in a product that earns money, and its
  access is a manual request — two independent blockers.
- EOG's licence looks permissive, but downloads now require an account whose terms are not published, so
  redistribution cannot be assumed.
- World Bank Light Every Night is open and anonymous, but its own registry entry states two different
  licences, one of which (ODbL) would impose share-alike on any derived database.
- Lorenz publishes images, not data, with no licence.
- NASA Black Marble clears both legal tests and is automatable with an Earthdata token. It is the one viable
  production route, and it needs a token in a refresh job and a precomputed mosaic — never a browser request.

Until one of those is settled, the honest interface says **"sky brightness unavailable"**, which is not the
same as "dark" and is not the same as "bright".

## Terrain: what a DEM may and may not claim

**Source: USGS 3DEP** (`3DEPElevation` ImageServer, EPSG:4326, NAVD88 metres, public domain, no key). Indiana,
Kentucky and Illinois are complete at 1 m lidar; the prototype asks the server for a 1024 × 1024 extract over a
32 km box, which is **≈31 m per pixel**, and reads the returned GeoTIFF directly with a 120-line reader (tiled,
uncompressed, float32) rather than adding a GDAL dependency.

**Method.** Sixteen azimuths, a sample every 60 m out to 16 km. The observer stands **1.6 m above the modelled
ground**, which is added to the ground elevation in metres above the datum — getting that wrong turns a 150 m
plateau into a 60° wall, which is exactly the bug the first run produced and a test now pins down. Each sample
is converted to an apparent elevation angle with Earth curvature (drop = 0.87 d²/2R) and standard refraction
(k = 0.13). The largest angle along the ray is the horizon in that direction; the profile is interpolated
between azimuths; and the core's own altitude and azimuth come from the unchanged Milky Way engine.

**What this proves, and what it does not.** In this pilot region the modelled horizon is **0.1° to 3.8°** while
the core reaches **22° to 23.5°** on the target night, so **bare-earth terrain never blocks the core** — every
candidate clears by at least 19°, and several by more than 21°. That is a real finding: *in southern Indiana,
terrain is not the limiting factor; vegetation, levees and access are.* A 3.8° ridge matters for a 15° target
at the start of the season, and would matter much more on a valley floor in hill country, which is why the
method is kept general rather than optimised away.

A bare-earth model contains **no trees, crops, hedgerows, buildings, fences, levees' vegetation or vehicles**.
A low profile is reported as "no modelled terrain obstruction" and never as a clear view. The interface repeats
that sentence wherever the number appears.

**Uncertainty.** One number, quoted with every clearance: twice the DEM's vertical RMSE plus half the measured
step-to-step rise around the sample that sets the angle, over that distance, with a 0.5° floor. The roughness
term is the data's own proxy for what could hide between two samples, and it is described as a proxy, not a
bound. In the pilot the values run 0.5°–4.4°. Nothing here is a survey grade statement, and a 60 m obstruction
is inherently less certain than a 4 km ridge.

**Validation.** Analytic cases with hand-computable answers — a flat plane (horizon below horizontal by
the eye-height angle), a single ridge (5.72° at 500 m for 50 m of rise), a higher eye height (lower maximum,
because the near ground falls away more steeply), a hole in the raster (unknown, never clear) — plus a
committed **genuine 3DEP extract** (96 × 96, 211 m of relief, 37 kB) that the offline suite runs end to end.

## Access: the dimension that decides the feature

Everything else is worthless if the answer is "you may not be there at night". The policy is deliberately
narrow, and each rule exists because of a real case found in this study:

| state | what it means | example found here |
| --- | --- | --- |
| `verified-night-access` | an authoritative source permits after-dark presence **and** there is a legal place to leave a vehicle (or a whole-property hours statement that covers it) | **Sugar Ridge FWA, Indiana**: "Property hours 24/7"; **Shawnee National Forest**: overnight parking at trailheads |
| `public-night-unknown` | public land, but no authoritative statement about after dark | **Harmonie State Park**, **Patoka Lake**, **Higginson-Henry WMA**, **Glendale and Hovey Lake FWAs** |
| `restricted-after-dark` | an authoritative source limits the hours | **Atterbury FWA, Indiana**: "Property: 7 a.m. to 11 p.m. unless engaged in authorized activity" — the property is closed before a spring core window is at its best |
| `private-no-permission` | private or non-governmental land with no public permission recorded | **Wabash River – Mount Carmel** (TNC-type), **AEP Rockport** |
| `insufficient-evidence` | nothing authoritative at all | a county road, a pull-off, a map annotation |

Five rules make this safe to ship later:

1. **Ownership is not permission, and a dataset's public-access flag is not permission.** PAD-US marks the
   American Electric Power Rockport parcel `OA` (open access) while its owner and manager are private. The
   prototype classifies it `private-no-permission` and puts it outside the recommendable group; a test asserts
   it. The same flag reads `RA` for the Garden of the Gods *Wilderness*, whose USFS statement does permit
   overnight trailhead parking — so the flag is surfaced as a caution, never as a verdict.
2. **A restriction always wins over a permission**, and the conflict is recorded rather than resolved silently.
3. **A third-party map can raise a question and never answer one.** OSM tags, commercial maps and blogs sit
   below authoritative sources in the evidence ranking, and a test proves they cannot produce a verified state.
4. **A permission without a documented legal parking place is not enough.** Crossing a road on foot at 2 a.m.
   is the part that gets people hurt or ticketed. A whole-property 24/7 statement does cover the property's own
   lot, and when that inference is used it is recorded as `parkingInferred`.
5. **Verification expires after a year**, and an expired verified state is *downgraded*, never kept.

Agency pages are not uniform, which is why each candidate stores its own quote, URL and date: the same Indiana
DNR template states 24/7 on one property, 7 a.m.–11 p.m. on another, and only office hours on a third.

## Roads and travel

No routing is implemented and **no drive time is invented**. Straight-line distance is computed, labelled
"great-circle" and accompanied by "not a drive" wherever it appears. The options, with verdicts, are in
`sources.json`:

- **OSRM public demo** — testing only, no availability commitment: not for production.
- **openrouteservice hosted** — viable for low volume with a server-side key; a new dependency and secret.
- **self-hosted OSRM or Valhalla** — the honest long-term answer for one region (about 1–2 GB RAM for an
  Indiana-scale extract) but a separate service outside the Cloudflare Pages architecture.
- **precomputed road-distance matrix** — the best fit: a few thousand origin–destination pairs generated
  offline by an OSRM run, shipped as a small artefact, no runtime service and no key. ODbL share-alike applies
  to the derived database, which is a decision for whoever owns the ranking, not an accident.

## The pilot: eleven real candidates

Study box 88.60°W–86.30°W, 37.30°N–38.70°N — southern Indiana, western Kentucky and southeastern Illinois.
Every coordinate is the **centroid of a real PAD-US 4.1 polygon**, returned by the service, with the object id
recorded. Ownership, manager, designation, protection status and acreage come from the same record. Nothing
was typed in from memory, and the generator fails loudly rather than dropping a unit it cannot find.

| candidate | type | owner / manager | access | modelled horizon vs the core |
| --- | --- | --- | --- | --- |
| Shawnee National Forest (IL) | federal forest | FED / FED, 165 650 ac | **verified** — trailhead overnight parking | 1.5° vs 23.5° |
| Garden of the Gods Wilderness (IL) | federal wilderness | DESG / FED, 3 978 ac | **verified** (PAD-US flags RA: caution shown) | 2.9° vs 23.4° |
| Lusk Creek Wilderness (IL) | federal wilderness | DESG / FED, 6 632 ac | **verified** (as above) | 3.5° vs 23.5° |
| Sugar Ridge FWA (IN) | state fish & wildlife | STAT / STAT, 7 935 ac | **verified** — "Property hours 24/7", parking inferred | 3.8° vs 22.7° |
| Hovey Lake FWA (IN) | state fish & wildlife | STAT / STAT, 5 847 ac | public, night unknown | 0.4° vs 23.2° |
| Glendale FWA (IN) | state fish & wildlife | STAT / STAT, 8 127 ac | public, night unknown | 1.3° vs 22.5° |
| Harmonie State Park (IN) | state park | STAT / STAT, 2 912 ac | public, night unknown | 1.0° vs 23.0° |
| Patoka Lake (IN) | federal reservoir designation | DESG / FED, 8 751 ac | public, night unknown | 1.7° vs 22.6° |
| Higginson-Henry WMA (KY) | state wildlife management | STAT / STAT, 5 451 ac | public, night unknown | 3.2° vs 23.4° |
| Wabash River – Mount Carmel (IL) | private conservation | PVT / PVT, 3 680 ac | **private** | 0.1° vs 22.3° |
| American Electric Power – Rockport (IN) | private industrial | PVT / PVT, 4 245 ac, PAD-US says *open access* | **private** — the flag is not permission | 0.1° vs 23.1° |

Target night: **2027-04-13**, the first favourable Galactic-core night from the Phase 6A.1 season search at the
region's centre. Sky brightness: **unavailable for all eleven**, with the reason attached.

The groups the comparison produces: **4 recommendable**, **5 needing verification**, **2 unsuitable**. That
distribution *is* the finding: the region has plenty of public land where the geometry is excellent, and the
open question is almost always permission after dark, not the sky.

## Costs if this became a product

| item | estimate | note |
| --- | --- | --- |
| terrain, on demand | 4 MB per site request | 3DEP extract, computed in a worker, never stored |
| terrain, precomputed | ~2 kB per site | horizon profile + provenance; 50 000 sites ≈ 100 MB total |
| sky brightness, regional | 1–2 GB per year per region | Black Marble annual mosaic at 500 m, precomputed offline |
| sky brightness, national | ~8 GB raw, ~1–2 GB compressed | feasible as a build artefact, not as a browser request |
| new Cloudflare services | **none required** | static artefacts beside the existing Pages deployment |
| new secrets | an Earthdata token if Black Marble is used | lives in the refresh job only |
| routing | none in 6B.2 | a precomputed matrix later, or a small VPS if drive times are ever needed |

No D1, R2, KV, Worker, DNS record or subscription is needed for the recommended scope.

## The smallest defensible Phase 6B.2

Ship **one** thing: a **"where to go" section inside the Milky Way category**, for the reader's own region,
that lists a handful of places whose **after-dark access is documented by the managing agency**, shows the
**modelled terrain clearance in the core's direction for the planned night**, and states in words that

- the sky-brightness layer is unavailable until a licensed dataset exists,
- the terrain is bare earth and says nothing about trees or buildings,
- the drive is unknown, and
- every entry needs a site visit before it is trusted.

Concretely: a static `data/geodata/sites-<region>.json` (a few dozen entries, each with its evidence URLs and
verification date), a build step that refuses to publish an entry without a verified access classification and
a fresh date, a client-side join with the existing Milky Way engine, and **no map tiles, no routing, no new
services**. Regions beyond the pilot ship only when someone has actually curated them.

What must **not** ship in 6B.2: a ranked list of "best" sites, any drive time, any Bortle class, any sky
brightness derived from radiance, or any candidate whose access is `public-night-unknown` presented as
a recommendation.

## Test evidence

`npm test` runs three new suites, and none of them touches the network:

- `tests/geodata-geometry-terrain.cjs` — 13 checks: coordinate normalisation and refusal, antimeridian boxes and
  polygons, great-circle distance cross-checked against the cosine law, bearing round-trip, curvature and dip
  against analytic values, raster bilinear interpolation, nodata stencils, a plane and a ridge with hand-computed
  angles, the eye-height datum bug, missing coverage producing `unknown` rather than `clear`, clearance margins,
  uncertainty behaviour, azimuth interpolation, and the committed 3DEP fixture run end to end.
- `tests/geodata-sky-access-sources.cjs` — 12 checks: the mcd ↔ mag arcsec⁻² round trip, the natural-sky addition,
  the refusal to convert radiance, cross-unit comparison refusal, masked and zero pixels, no Bortle class,
  every access state and its precedence, third-party evidence being insufficient, expiry and downgrade, and the
  gate catching an inventory entry that overstates its own eligibility.
- `tests/geodata-sites.cjs` — 6 checks: real inventory records with source and date on every claim, a profile per
  candidate from 3DEP, three axes with no composite score, no drive time anywhere, grouping by access first, the
  private-parcel-with-an-open-access-flag case, report/inventory agreement, and that `dist/` contains neither the
  prototype modules nor any research artefact.

## Known limitations and open questions

- **Sky brightness is missing**, and no candidate may be described as dark until it exists.
- **Vegetation is not modelled.** In this region that is likely the real horizon: a 20 m tree line at 200 m is
  5.7°, larger than every modelled terrain angle here.
- **Access is a snapshot.** Agency pages change; the policy makes an entry expire after a year, but nobody is
  currently re-checking. A named owner for that cadence is a prerequisite for 6B.2.
- **Parking is the weakest link.** "Overnight parking at trailheads" is a general statement; which trailhead, and
  whether it is plowed or gated in March, is a field question.
- **One candidate straddles the study box** (its largest polygon centroid lies just north of it); it is flagged in
  the report rather than dropped.
- **No ground truth.** No candidate has been visited. Terrain profiles agree with the DEM and with analytic cases,
  not with a photograph of the horizon.
- **Routing is unresolved** and the precomputed-matrix approach carries ODbL obligations that need a deliberate
  decision.

## The licensing gate, mechanically

`src/geodata/geo-sources.mjs` turns the inventory into a decision, and refuses to let an entry disagree with
itself: a source declared `productionEligible` while carrying a non-commercial licence throws rather than
passes. Two questions are asked separately, because conflating them is how projects ship data they may not ship:
*may we use it* (`licence.commercialUse`, `licence.redistribution`, `licence.shareAlike`) and *can a job read it*
(`access.automatable`). Today's answer:

```
production-eligible  usgs-3dep, usgs-padus-4-1, nasa-black-marble-vnp46a4,
                     indiana-dnr-properties, usfs-shawnee, aws-terrain-tiles
blocked              falchi-2016-world-atlas   non-commercial + manual access
                     eog-viirs-vnl             account-gated, account terms unpublished
                     worldbank-light-every-night  registry contradicts itself (ODbL vs CC BY 4.0)
                     lorenz-atlas              no licence, no numeric product
                     osm                       share-alike on derived databases
```

What would unblock each: a written commercial permission from the Falchi authors (or a licence change); an
account-terms review with EOG; a clarification from the World Bank on which licence applies; a licence from
Lorenz plus a numeric raster; and a deliberate decision to publish an ODbL-derived database. Until then the
sky column stays empty, and the product says so instead of guessing.
