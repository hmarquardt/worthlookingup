/* Where to go: the regional area explorer.

   This module is loaded only when a reader opens the section, and it is deliberately small: a validator, a
   distance function, and a renderer that builds plain DOM. It does no astronomy, no geometry beyond a local
   plane, and no network — the page hands it the artifact and the visitor's own window.

   The rules it will not break:
     * an area is never described as an observation point, a trailhead, a parking place or an entrance;
     * no distance is a drive, and no travel time exists;
     * no sky brightness, darkness rating or Bortle class is shown, because none is known;
     * the comparison list is the interface; the map is a sketch beside it. */

(function (root) {
  'use strict';

  var SCHEMA = 'worthlookingup.geodata-sites/1';
  var FORBIDDEN = ['coordinates', 'latitude', 'longitude', 'parkinglot', 'trailhead', 'traveltime',
    'driveminutes', 'drivetime', 'bortle', 'skybrightness', 'mpsas', 'radiance', 'score', 'rank'];

  function text(value) {
    return String(value === null || value === undefined ? '' : value);
  }

  function esc(value) {
    return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* The artifact is validated before anything is shown, so a broken or partial file produces one clear
     message instead of a half-rendered list. */
  function validate(artifact) {
    if (!artifact || typeof artifact !== 'object') throw new Error('the area data did not load');
    if (artifact.schema !== SCHEMA) throw new Error('the area data is not the expected version');
    if (!artifact.region || !Array.isArray(artifact.areas)) throw new Error('the area data has no region');
    var seen = {};
    artifact.areas.forEach(function (area) {
      if (!area.id || seen[area.id]) throw new Error('the area data repeats an identifier');
      seen[area.id] = true;
      if (area.type !== 'area') throw new Error('a record is not an area');
      if (!area.access || area.access.state !== 'verified-night-access') {
        throw new Error('an unverified area is present in the published list');
      }
      if (!area.boundary || !Array.isArray(area.boundary.rings) || !area.boundary.rings.length) {
        throw new Error('an area has no mapped boundary');
      }
      var flat = JSON.stringify(area).toLowerCase();
      FORBIDDEN.forEach(function (word) {
        if (flat.indexOf('"' + word + '"') !== -1) throw new Error('the area data contains ' + word);
      });
    });
    return artifact;
  }

  function regionContains(artifact, point) {
    var region = artifact.region;
    return track(point) && point.lat >= region.south && point.lat <= region.north &&
      point.lon >= region.west && point.lon <= region.east;
  }

  function track(point) {
    return point && Number.isFinite(point.lat) && Number.isFinite(point.lon);
  }

  /* Nearest point on the mapped outline, measured on a local plane. Over a few tens of kilometres the
     difference from a great circle is far below the width of a boundary line, and the number is labelled as
     a straight-line distance to a management edge either way. */
  function nearestBoundary(area, point) {
    if (!track(point)) return null;
    var latScale = 111320;
    var lonScale = 111320 * Math.cos(point.lat * Math.PI / 180);
    var best = null;
    function project(pair) {
      return { x: (pair[0] - point.lon) * lonScale, y: (pair[1] - point.lat) * latScale };
    }
    area.boundary.rings.forEach(function (ring) {
      for (var i = 0; i < ring.length; i++) {
        var a = project(ring[i]);
        var b = project(ring[(i + 1) % ring.length]);
        var dx = b.x - a.x, dy = b.y - a.y;
        var lengthSquared = dx * dx + dy * dy;
        var t = lengthSquared ? -(a.x * dx + a.y * dy) / lengthSquared : 0;
        t = Math.max(0, Math.min(1, t));
        var x = a.x + dx * t, y = a.y + dy * t;
        var metres = Math.sqrt(x * x + y * y);
        if (best === null || metres < best.metres) {
          best = { metres: metres, lat: point.lat + y / latScale, lon: point.lon + x / lonScale };
        }
      }
    });
    return best;
  }

  function distanceLabel(metres) {
    if (!Number.isFinite(metres)) return 'distance unavailable';
    if (metres < 1000) return 'about ' + (Math.round(metres / 50) * 50) + ' m';
    if (metres < 10000) return 'about ' + (Math.round(metres / 100) / 10).toFixed(1) + ' km';
    return 'about ' + Math.round(metres / 1000) + ' km';
  }

  /* The comparison: one entry per published area, ordered by name so that nothing implies a quality ranking.
     Each entry carries its distance to the nearest mapped edge and every unknown that remains unknown. */
  function compare(artifact, origin) {
    return artifact.areas.map(function (area) {
      var nearest = nearestBoundary(area, origin);
      return {
        id: area.id, name: area.name, area: area,
        distanceMetres: nearest ? Math.round(nearest.metres) : null,
        distanceKind: 'great-circle',
      };
    }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  }
  /* One area as an expandable record. A summary carries the name, the record type and the distance to the
     nearest mapped edge; the body carries the evidence, the restrictions, the terrain and sky status, and the
     unknowns, each with its source. */
  function areaMarkup(entry) {
    var area = entry.area;
    var restrictions = (area.restrictions || []).map(function (item) {
      return '<li>' + esc(item.text) + ' <a href="' + esc(item.sourceUrl) + '" rel="noopener">source</a></li>';
    }).join('');
    var evidence = (area.access.evidence || []).map(function (item) {
      return '<li><strong>' + esc(item.publisher) + '</strong>, ' + esc(item.verifiedAt) +
        ' — <a href="' + esc(item.url) + '" rel="noopener">official page</a><br>' + esc(item.summary) +
        (item.quote ? '<br><q>' + esc(item.quote) + '</q>' : '') + '</li>';
    }).join('');
    var unknowns = (area.unknowns || []).map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('');
    var parkingNote = area.access.parkingInferred
      ? '<br>Parking is covered by the property\'s own hours statement and is not documented separately.' : '';
    return '<details class="whereto-area" data-area="' + esc(area.id) + '">' +
      '<summary><span class="whereto-name">' + esc(area.name) + '</span>' +
      '<span class="whereto-chip">area</span>' +
      '<span class="whereto-chip whereto-distance">' + esc(distanceLabel(entry.distanceMetres)) +
      ' to nearest mapped edge</span></summary>' +
      '<dl class="whereto-facts">' +
        '<dt>Manager</dt><dd>' + esc(area.agency.managerName) + ' · ' + esc(area.agency.designation) + ' · ' +
          esc(area.agency.state) + ' · ' + esc(Number(area.agency.acres).toLocaleString('en-US')) + ' acres</dd>' +
        '<dt>After-dark access</dt><dd>' + esc(area.access.label) +
          (area.access.nightWindow ? '<br>Stated hours: ' + esc(area.access.nightWindow) : '') + parkingNote +
          '</dd>' +
        '<dt>Evidence</dt><dd><ul class="whereto-list-plain">' + evidence + '</ul></dd>' +
        (restrictions ? '<dt>Restrictions</dt><dd><ul class="whereto-list-plain">' + restrictions + '</ul></dd>' : '') +
        '<dt>Terrain</dt><dd>' + esc(area.terrain.note) + '</dd>' +
        '<dt>Sky brightness</dt><dd>' + esc(area.sky.message) + '</dd>' +
        '<dt>Still unknown</dt><dd><ul class="whereto-list-plain">' + unknowns + '</ul></dd>' +
      '</dl></details>';
  }


  /* The map is a sketch of the mapped outlines and the visitor, with no basemap and no tiles. It is labelled
     for screen readers by the same facts the list carries, so the two cannot disagree. */
  function mapMarkup(artifact, origin) {
    var region = artifact.region;
    var width = 640, height = 420, pad = 24;
    var extents = artifact.areas.reduce(function (acc, area) {
      return { west: Math.min(acc.west, area.boundary.bbox[0]), east: Math.max(acc.east, area.boundary.bbox[2]),
        south: Math.min(acc.south, area.boundary.bbox[1]), north: Math.max(acc.north, area.boundary.bbox[3]) };
    }, { west: region.west, east: region.east, south: region.south, north: region.north });
    if (track(origin)) {
      extents.west = Math.min(extents.west, origin.lon); extents.east = Math.max(extents.east, origin.lon);
      extents.south = Math.min(extents.south, origin.lat); extents.north = Math.max(extents.north, origin.lat);
    }
    var scale = Math.min((width - pad * 2) / Math.max(0.2, extents.east - extents.west),
      (height - pad * 2) / Math.max(0.2, extents.north - extents.south));
    function project(lon, lat) {
      return [pad + (lon - extents.west) * scale, height - pad - (lat - extents.south) * scale];
    }
    var paths = artifact.areas.map(function (area) {
      var d = area.boundary.rings.map(function (ring) {
        return ring.map(function (pair, index) {
          var p = project(pair[0], pair[1]);
          return (index ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
        }).join(' ') + ' Z';
      }).join(' ');
      return '<path d="' + d + '" fill="#91c9da" fill-opacity="0.18" stroke="#91c9da" stroke-width="1.2">' +
        '<title>' + esc(area.name) + '</title></path>';
    }).join('');
    var marker = '';
    if (track(origin)) {
      var at = project(origin.lon, origin.lat);
      marker = '<circle cx="' + at[0].toFixed(1) + '" cy="' + at[1].toFixed(1) + '" r="4.5" fill="#d3ed95">' +
        '<title>Your selected location</title></circle>';
    }
    var frame = [project(region.west, region.north), project(region.east, region.south)];
    var label = 'Mapped outlines of ' + artifact.areas.length + ' published areas near your selected location, ' +
      'with the studied region outlined and your location marked. Distances are straight-line to the nearest ' +
      'mapped edge.';
    return '<figure class="whereto-map"><svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' +
      esc(label) + '">' +
      '<rect x="' + frame[0][0].toFixed(1) + '" y="' + frame[0][1].toFixed(1) + '" width="' +
        Math.abs(frame[1][0] - frame[0][0]).toFixed(1) + '" height="' + Math.abs(frame[1][1] - frame[0][1]).toFixed(1) +
        '" fill="none" stroke="#304047" stroke-dasharray="4 4"/>' + paths + marker + '</svg>' +
      '<figcaption>Mapped management outlines (USGS PAD-US), not property lines and not entrances. ' +
      'The dashed frame is the studied region. No basemap is shown and none is implied.</figcaption></figure>';
  }

  function render(container, options) {
    var artifact = validate(options.artifact);
    var entries = compare(artifact, options.origin);
    var astronomyNote = options.astronomy
      ? '<p class="whereto-window"><strong>Your window, at your location.</strong> ' + esc(options.astronomy) + '</p>'
      : '';
    container.innerHTML = '<p class="whereto-intro">These are <strong>areas</strong>, not observation points: ' +
      'no parking place, trailhead, gate or tripod position has been verified. Distances are straight-line to the ' +
      'nearest mapped edge of an area, which is a management boundary — not a drive, an entrance or a destination.</p>' +
      '<p class="whereto-status">' + esc(artifact.sky.message) + '</p>' +
      astronomyNote +
      '<div class="whereto-grid"><div class="whereto-records">' +
        '<h3 class="whereto-heading">Published areas <span class="small">(' + entries.length + ', listed by name)</span></h3>' +
        entries.map(areaMarkup).join('') + '</div>' + mapMarkup(artifact, options.origin) + '</div>' +
      '<ul class="whereto-limits">' + artifact.limitations.map(function (line) {
        return '<li>' + esc(line) + '</li>';
      }).join('') + '</ul>' +
      '<p class="small whereto-attribution">Boundaries: ' + esc(artifact.attribution[0].publisher) + ' (' +
        esc(artifact.attribution[0].licence) + '). Terrain context: ' + esc(artifact.attribution[1].publisher) +
        ' (' + esc(artifact.attribution[1].licence) + '). Access evidence checked ' +
        esc(artifact.checked_at) + '; official links are on each record.</p>';
    return { entries: entries, listIsAuthoritative: true };
  }

  root.OverheadSites = { SCHEMA: SCHEMA, validate: validate, regionContains: regionContains,
    nearestBoundary: nearestBoundary, distanceLabel: distanceLabel, compare: compare, render: render,
    mapMarkup: mapMarkup, esc: esc };
})(typeof self !== 'undefined' ? self : globalThis);
