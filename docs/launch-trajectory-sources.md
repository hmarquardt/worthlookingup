# Launch trajectory sources and licensing inventory

Phase 5A research artifact. This is the prose companion to `src/launches/trajectory-sources.json`, which
is the machine-readable form of the same list; the test suite asserts that the two agree on every id and
licence, so a source cannot be quietly added, relabelled or dropped from one without the other.

Evidence levels are defined in [launch-trajectory-feasibility.md](launch-trajectory-feasibility.md):
1 verified telemetry, 2 mission reconstruction, 3 documented mission profile, 4 corridor or hazard area,
5 pad location and time only. `Evidence ceiling` is the strongest level the source can honestly support,
not the level it sometimes reaches.

The licence column is the reading this phase made from the source itself on 2026-10-16, with the wording
that matters kept in the notes below the table. Nothing here is legal advice, and where a licence is
unclear the conservative reading is the one recorded.

| id | source | category | contributes | evidence ceiling | access | licence | commercial reuse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `spacex-press-kit` | SpaceX mission pages and press kits | official mission documents | trajectory | 3 | js-only | copyright-holder-retained | no |
| `spacex-webcast` | SpaceX launch webcasts | official mission documents | trajectory | 2 | html-only | copyright-holder-retained | no |
| `faa-part-420` | 14 CFR part 420 and its appendices, including Appendix B to part 420 | faa licensure and regulation | method | 4 | open-http | us-government-work | yes |
| `faa-launch-licence-documents` | FAA licence orders, environmental assessments and environmental impact statements | faa licensure and regulation | constraint | 4 | open-http | us-government-work | yes |
| `faa-tfr-wfs` | FAA temporary flight restriction geoserver (OGC WFS) | airspace restrictions | constraint | 4 | open-http | us-government-work | yes |
| `faa-notam` | FAA notices to air missions (NOTAM search and the SWIM feed) | airspace restrictions | constraint | 4 | open-http-with-registration | us-government-work | yes |
| `uscg-lnm` | US Coast Guard local notices to mariners and broadcast notices | maritime warnings | constraint | 4 | pdf-only | us-government-work | yes |
| `nga-msi` | NGA maritime safety information (NAVAREA warnings) | maritime warnings | constraint | 4 | open-http-with-registration | us-government-work | yes |
| `webcast-telemetry-archive` | Webcast telemetry transcriptions (shahar603/Telemetry-Data) | public flight data, reconstructed | trajectory | 2 | open-http | public-domain | yes |
| `gcat` | General Catalog of Artificial Space Objects (J. McDowell) | catalogues and anchors | anchor | 5 | open-http | cc-by-4.0 | yes |
| `celestrak-and-spacetrack` | CelesTrak and Space-Track element sets for launch-related objects | catalogues and anchors | anchor | 2 | open-http | us-government-work | yes |
| `flightclub` | Flight Club | commercial reconstructions | trajectory | 2 | commercial-licence | proprietary-commercial | no |
| `rocketpy` | RocketPy and similar open-source ascent simulators | open-source simulation | trajectory | 3 | local-install | mit | yes |
| `observation-reports` | Independent observation analyses, including Oberg's review draft on the 2018 SAOCOM 1A ascent | observations | observation | none | pdf-only | copyright-holder-retained | no |
| `apod` | NASA Astronomy Picture of the Day and press imagery | observations | observation | none | html-only | copyright-holder-retained | no |

## Notes per source, with what was actually verified

### `spacex-press-kit` — SpaceX mission pages and press kits


- Machine-readable: no. Automation: poor. Update frequency: per mission; historical URLs are withdrawn.

- Spatial precision: none: no ground position is published. Temporal precision: event times to the second.

- Coverage: Falcon 9, Falcon Heavy and Starship, one document per mission.

- Limitations: Pages are script-rendered with no API. The 2018 SAOCOM 1A press kit URL now returns 404 and survives only in the Internet Archive, so a pipeline cannot rely on the source staying available. Timelines give altitudes for a few events and no downrange, which cannot be turned into a bearing.

- Citation: SpaceX press kit, quoted here through the Oberg 2018 review draft. Source: https://www.spacex.com/launches/


### `spacex-webcast` — SpaceX launch webcasts


- Machine-readable: no. Automation: poor. Update frequency: per launch.

- Spatial precision: none disclosed. Temporal precision: seconds, as displayed.

- Coverage: every mission since 2010, in archived video.

- Limitations: The source of the public reconstructions, read by a human or transcribed by a third party. The telemetry graphics have changed repeatedly and are not published as data, so a pipeline built on them depends on somebody else's transcription.

- Citation: SpaceX launch webcasts and the third-party transcriptions derived from them. Source: https://www.spacex.com/launches/


### `faa-part-420` — 14 CFR part 420 and its appendices, including Appendix B to part 420


- Machine-readable: yes. Automation: good. Update frequency: rarely.

- Spatial precision: not applicable: a method, not data. Temporal precision: the regulation requires a nominal trajectory sampled at one second or finer.

- Coverage: the licensing framework for every us commercial launch.

- Limitations: Appendix B tells an applicant how to build a flight corridor from a one-second nominal trajectory and local wind statistics, and lists the vehicle parameters a trajectory generator must model. The trajectory itself belongs to the operator and is not published with the licence, so the regulation proves that precise trajectories exist without making any of them available.

- Citation: 14 CFR part 420, Appendix B, Method for Defining a Flight Corridor. Source: https://www.govinfo.gov/bulkdata/CFR/2024/title-14/CFR-2024-title14-vol4.xml


### `faa-launch-licence-documents` — FAA licence orders, environmental assessments and environmental impact statements


- Machine-readable: no. Automation: poor. Update frequency: per licence action.

- Spatial precision: hazard areas and corridors, kilometres to tens of kilometres. Temporal precision: launch windows only.

- Coverage: site and vehicle programmes, not individual flights.

- Limitations: Maps sit inside PDFs as figures, so polygons have to be digitised by hand. A corridor bounds where debris may land under failure assumptions; it is not the vehicle's path.

- Citation: FAA Office of Commercial Space Transportation licensing documents. Source: https://www.faa.gov/space


### `faa-tfr-wfs` — FAA temporary flight restriction geoserver (OGC WFS)


- Machine-readable: yes. Automation: good. Update frequency: continual.

- Spatial precision: polygon vertices at about 1e-5 degrees. Temporal precision: the window in the title.

- Coverage: every active TFR, including space-operation TFRs.

- Limitations: Verified working: a GetFeature request returned GeoJSON with a polygon, a NOTAM key, a title and a legal category, with no key and no registration. It carries no launch-specific geometry beyond the surface area, and no altitude profile or time-resolved position.

- Citation: FAA TFR service, layer TFR:V_TFR_LOC, fetched 2026-10-16. Source: https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC


### `faa-notam` — FAA notices to air missions (NOTAM search and the SWIM feed)


- Machine-readable: yes. Automation: limited. Update frequency: continual.

- Spatial precision: textual coordinates in launch NOTAMs. Temporal precision: minutes.

- Coverage: us airspace.

- Limitations: The web interface refuses automated access and the machine-to-machine feed needs an account. Coordinates arrive inside free text, so a parser is required and it will break when the prose changes.

- Citation: FAA NOTAM search service. Source: https://notams.aim.faa.gov/notamSearch/


### `uscg-lnm` — US Coast Guard local notices to mariners and broadcast notices


- Machine-readable: no. Automation: poor. Update frequency: weekly per district.

- Spatial precision: named hazard areas with coordinates in the text. Temporal precision: hours to days.

- Coverage: us coastal waters, weekly by district.

- Limitations: Distributed as weekly PDFs. Requests from this environment were refused by the host, so automated retrieval was not demonstrated and is not assumed. Launch hazard areas appear as prose and diagrams with no machine-readable polygon.

- Citation: USCG Navigation Center, local notices to mariners. Source: https://navcen.uscg.gov/local-notices-to-mariners-by-cg-district


### `nga-msi` — NGA maritime safety information (NAVAREA warnings)


- Machine-readable: yes. Automation: limited. Update frequency: continual.

- Spatial precision: textual coordinate lists. Temporal precision: hours.

- Coverage: global ocean areas.

- Limitations: Structured access sits behind a registered key; warnings are prose about a downrange area and do not resolve the ascent.

- Citation: NGA MSI portal. Source: https://msi.nga.mil/


### `webcast-telemetry-archive` — Webcast telemetry transcriptions (shahar603/Telemetry-Data)


- Machine-readable: yes. Automation: good. Update frequency: abandoned.

- Spatial precision: none: altitude and downrange only, no position. Temporal precision: one second, event times to the second.

- Coverage: about sixty Falcon 9 and Falcon Heavy flights, mainly 2016 to 2019; no Starship and nothing recent.

- Limitations: The best public time series that exists: altitude, speed, downrange and event times at one-second spacing, released to the public domain. It is a third-party transcription of a webcast graphic, not operator telemetry. This phase measured its terminal state against the achieved orbits in GCAT and found the altitude series and the speed series disagree with the orbit in different ways for different flights, so absolute values cannot be trusted without an independent anchor.

- Citation: Telemetry-Data repository, Unlicense, reduced by scripts/build-trajectory-fixtures.mjs. Source: https://github.com/shahar603/Telemetry-Data


### `gcat` — General Catalog of Artificial Space Objects (J. McDowell)


- Machine-readable: yes. Automation: good. Update frequency: continuous.

- Spatial precision: launch point coordinates to 1e-4 degrees. Temporal precision: to the second for some launches, a day for others.

- Coverage: every orbital launch, with achieved orbits per payload.

- Limitations: Gives the pad, the time and the achieved orbit, which is what is needed to validate or anchor a reconstruction, and nothing about the ascent itself. Attribution is required.

- Citation: McDowell, J., 2020, General Catalog of Artificial Space Objects, CC-BY-4.0. Source: https://planet4589.org/space/gcat/


### `celestrak-and-spacetrack` — CelesTrak and Space-Track element sets for launch-related objects


- Machine-readable: yes. Automation: good. Update frequency: several times a day.

- Spatial precision: orbital elements, not ascent positions. Temporal precision: minutes around epoch.

- Coverage: objects that reached orbit, including spent upper stages.

- Limitations: The first useful element set appears after insertion, so it anchors the end state of an ascent rather than the ascent. CelesTrak is already the project's satellite source; only its role as an anchor is new here.

- Citation: CelesTrak, with Space-Track for registration-gated access. Source: https://celestrak.org/


### `flightclub` — Flight Club


- Machine-readable: yes. Automation: limited. Update frequency: per launch.

- Spatial precision: claimed high fidelity, method not published. Temporal precision: sub-second in the published mission profiles.

- Coverage: most orbital launches, curated per flight.

- Limitations: Publishes an OpenAPI-documented developer interface and sells commercial licences shaped by volume, redistribution and branding, so its data cannot be redistributed in a public product without a negotiated agreement. The modelling method and its error budget are not published, which is itself a scientific limitation.

- Citation: Flight Club commercial usage page and API documentation, read 2026-10-16. Source: https://flightclub.io/


### `rocketpy` — RocketPy and similar open-source ascent simulators


- Machine-readable: yes. Automation: good. Update frequency: active.

- Spatial precision: set by the assumed vehicle model. Temporal precision: set by the integration step.

- Coverage: whatever vehicle data is supplied.

- Limitations: An engine, not a data source. A credible Falcon 9 or Starship simulation needs mass, thrust and specific impulse against time, stage dimensions, aerodynamic coefficients and wind profiles. Appendix B lists exactly those parameters as applicant-supplied, and no operator publishes them, so a simulation built without them would be an invented trajectory dressed as a model output.

- Citation: RocketPy repository, MIT licence. Source: https://github.com/RocketPy-Team/RocketPy


### `observation-reports` — Independent observation analyses, including Oberg's review draft on the 2018 SAOCOM 1A ascent


- Machine-readable: no. Automation: poor. Update frequency: rare.

- Spatial precision: observer coordinates in a few cases, tens of kilometres in others. Temporal precision: seconds to minutes.

- Coverage: individual well-observed launches.

- Limitations: A 122-page review draft, explicitly incomplete, that pairs observer coordinates with video-derived bearings and includes an altitude-versus-elevation method using the law of sines. It is the best independent ground truth found for a single flight, and its derived bearings carry the several-degree uncertainty the author states.

- Citation: Oberg, J., Analysis of Observations of SpaceX Falcon-9 Launch October 7, 2018, REVIEW DRAFT 2, 8 December 2018. Source: http://satobs.org/seesat_ref/misc/181007-spaceX_1208.pdf


### `apod` — NASA Astronomy Picture of the Day and press imagery


- Machine-readable: no. Automation: poor. Update frequency: irregular.

- Spatial precision: county level at best. Temporal precision: the minute of exposure.

- Coverage: a handful of photogenic launches.

- Limitations: Published photographs rarely state a bearing, an exposure orientation or an exact location, so they can corroborate that something was seen and cannot measure where it was. Image rights rest with the photographers.

- Citation: NASA APOD 2017 December 24, image credit Craig Bobchin. Source: https://apod.nasa.gov/apod/ap171224.html

## What the licensing landscape means for this product

* Public-domain and open-licence material is the only material that may be redistributed: the webcast
telemetry archive (Unlicense), GCAT (CC-BY-4.0, attribution required), CelesTrak and the US government
sources. Those are enough to build and to validate the geometry.
* Operator material — press kits, webcasts, mission pages — is copyrighted with no open licence. It may
be read, cited and measured against, but not republished, and its URLs are not stable: the 2018 SAOCOM
1A press kit now exists only in the Internet Archive.
* Commercial reconstruction services state plainly that commercial use is a negotiated licence shaped by
volume, redistribution and branding. Redistributing their trajectories would require an agreement, and
their error budgets are not published, so the science would rest on an unexamined model.
* Free access is not a redistribution right. Where the provider carries terms and rate limits (as the
launch schedule provider already does), those terms travel with the data into any new feature.
