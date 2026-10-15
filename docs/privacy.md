# Privacy and local data

Worth Looking Up stores observing location, up to 12 saved places, up to 100 favorites, theme and
settings in this browser. Downloaded orbital/weather responses and mission metadata are bounded
IndexedDB caches. They are not synchronized to an account. Settings offers explicit export/import;
exports include coordinates and should be kept private. Clear downloaded cache leaves preferences.

Weather requests send coordinates to Open-Meteo; explicit place search sends search text. Opening
a ground-track map loads jsDelivr MapLibre and OpenStreetMap tiles. Spacecraft identity requests
send identifiers to CelesTrak/Wikidata, not your observing coordinates. Providers receive ordinary
network metadata such as IP address; see their linked policies in providers.md.

Analytics Lite sends page/device/referrer/timing metadata and random browser/session identifiers
to the independent lab.aismallbizguru.com service with site ID worthlookingup. Identifiers are
stored under worthlookingup.analytics.* and are never included in preference transfers. It respects
Do Not Track. Do not put private coordinates or other secrets in page URLs. Shared collector
retention and access are governed by that service; no new retention claim is made here.

Origin storage cannot be read across sites: old Overhead data is neither moved nor deleted by
visiting this domain. Use the explicit documented transfer process. Browser storage is not encrypted.
