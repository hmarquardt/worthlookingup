# External providers and rights review (2026-10-15)

| Provider | Terms / operational decision |
| --- | --- |
| Open-Meteo | [Terms](https://open-meteo.com/en/terms) verified: free API noncommercial only, <10,000 daily / 5,000 hourly / 600 minute calls; data CC BY 4.0 attribution retained. Paid commercial plan required before monetization. Current product has no ads/subscriptions. Coordinates appear in provider requests/logs. |
| CelesTrak | [GP formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php) verified; OMM preserves wider catalog IDs. Preserve 4h GP / 2h SupGP caches, backoff/fallback; no blanket commercial redistribution grant inferred. Review [data](https://celestrak.org/NORAD/elements/) before scale-up. |
| Wikidata | [Data access](https://www.wikidata.org/wiki/Wikidata:Data_access): structured data CC0, query service limits apply; resolve selected identifiers only, 21d bounded cache. |
| MapLibre / jsDelivr | Optional pinned 5.6.1; BSD-3-Clause library, CDN availability external; no API key. |
| OpenStreetMap | [Tile policy](https://operations.osmfoundation.org/policies/tiles/) verified: attribution and browser Referer required; honor HTTP cache; no bulk/prefetch/offline downloads; best effort, no SLA. Referrer policy permits origin disclosure. Switch provider for scale. OSM data ODbL distinct from tile service policy. |
| NASA/JPL | [SSD API policy](https://ssd-api.jpl.nasa.gov/doc/) and artifact source URLs: build-time SBDB/Horizons requests, no browser proxy needed. Preserve provenance/units/frames; no endorsement or accuracy guarantee. |
| IMO / MDC / Internet Archive | Factual calendar/radiant reference material, hashes and attribution preserved. No blanket right to redistribute full publications inferred. Fixture is extracted table text; commercial redistribution review outstanding. |
| COBS | [Source](https://cobs.si/): measured comet brightness in validated pipeline. Retain provenance; commercial redistribution rights not established during migration. Obtain clarification before commercial release. |
| Analytics Lite | Locally hosted source; independent lab.aismallbizguru.com collector reused with worthlookingup identity. Browser IDs and page/device metadata sent; Do Not Track respected. No Junk Drawer hosting dependency. Collector-side retention/administration belongs to shared service. |

This is an engineering inventory, not a claim that all provider contracts authorize commercial
redistribution. Revisit terms before monetization or substantially increased traffic. No API/R2
service is provisioned for reserved api/data hostnames.
