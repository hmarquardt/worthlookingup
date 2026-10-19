# Privacy and local data

Worth Looking Up stores observing location, up to 12 saved places, up to 100 favorites, theme and
settings in this browser. Downloaded orbital/weather responses and mission metadata are bounded
IndexedDB caches. They are not synchronized to an account. Settings offers explicit export/import;
exports include coordinates and should be kept private. Clear downloaded cache leaves preferences.

Weather requests send coordinates to Open-Meteo; explicit place search sends search text. Opening
a ground-track map loads jsDelivr MapLibre and OpenStreetMap tiles. Spacecraft identity requests
send identifiers to CelesTrak/Wikidata, not your observing coordinates. Providers receive ordinary
network metadata such as IP address; see their linked policies in providers.md.

Analytics is the shared CFLab Analytics collector (the `cflab-analytics` Cloudflare Worker), reached
through its legacy-compatible ingestion route at lab.aismallbizguru.com/api/analytics/collect with the
site identity worthlookingup. This site is registered there as `as_PKAOHGDzw9aJP98hZxaPQB` with the
domains worthlookingup.com (primary) and www.worthlookingup.com (alias), 90-day raw retention, and
DNT/GPC respected; the collector refuses any other source origin. What is sent: page views, and three
interaction events — event detail views (a category label), category selections (the view name) and
location searches (the method: place, coordinates or geolocation). No coordinates, no search text, no
favorite or saved-place names and no observation times are sent. Random browser and session identifiers
live under worthlookingup.analytics.* and are never included in preference transfers. Do Not Track
suppresses collection in the browser and the collector also refuses requests that carry DNT or Sec-GPC;
see [analytics.md](analytics.md). Do not put private coordinates or other secrets in page URLs. Shared
collector retention and access are governed by that service; no new retention claim is made here.

Origin storage cannot be read across sites: old Overhead data is neither moved nor deleted by
visiting this domain. Use the explicit documented transfer process. Browser storage is not encrypted.

The optional equipment profile (`overhead.equipment.v1`) is stored only in this browser. It contains the
instrument categories and numbers the reader chooses to enter (for example binocular magnification, telescope
aperture or camera focal length), never a manufacturer, serial number, account or purchase history. It is not
sent to analytics or any provider, not included in the preference-transfer export, and is removed with the
site's other local data. The equipment guide is a local file, loaded only when the reader opens it.
