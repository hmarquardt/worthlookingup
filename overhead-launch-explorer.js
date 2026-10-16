/* Historical ascent geometry for the launch calendar (Phase 5B).

   This is the only product-facing module of the trajectory work, and it is deliberately thin: it loads
   the Phase 5A geometry module (src/launches/launch-trajectory.mjs) and the published profile artifact
   (data/launches/trajectory-profiles.json) on demand, calls the documented entry points on them, and
   renders the objects they return. It performs no geometry of its own, so a gate result cannot be
   contradicted by the presentation layer, and it never shows a brightness, a plume size or a probability,
   because the module has no way to express one.

   Loading is lazy: nothing here fetches anything until someone opens the historical explorer or a launch
   card asks for its pad geometry, and neither is on the initial page-load path. If the geometry module or
   the artifact cannot be loaded, the interface says so and shows nothing else. */
(function () {
  "use strict";

  var MODULE_PATH = "src/launches/launch-trajectory.mjs";
  var ARTIFACT_PATH = "data/launches/trajectory-profiles.json";
  var REVIEW_PATH = "data/launches/trajectory-review.json";
  var GEODESY_PATH = "src/launches/launch-geodesy.mjs";
  var PAD_INDEX_PATH = "src/launches/launch-pad-index.mjs";
  var PAD_INDEX_DATA_PATH = "data/launches/trajectory-pad-index.json";
  var pending = null, pendingCard = null;

  // Every path is resolved against the document base: a specifier like "src/x.mjs" would be read as a
  // bare module specifier and refused, and resolving here keeps the panel working when the site is
  // served from anywhere other than the domain root.
  var at = function (path) { return new URL(path, document.baseURI).href; };
  var moduleUrl = function () { return at(MODULE_PATH); };
  var artifactUrl = function () { return at(ARTIFACT_PATH); };
  var servesModules = function () { return /^https?:$/.test(window.location.protocol); };

  var esc = function (value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/[&<>"']/g, function (character) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
      });
  };
  var fixed = function (value, digits) { return Number.isFinite(value) ? value.toFixed(digits) : "—"; };
  var kilometres = function (metres) {
    if (!Number.isFinite(metres)) return "—";
    return metres >= 100000 ? (metres / 1000).toFixed(0) + " km" : (metres / 1000).toFixed(metres >= 10000 ? 0 : 1) + " km";
  };
  var clockTime = function (seconds) {
    if (!Number.isFinite(seconds)) return "—";
    var minutes = Math.floor(seconds / 60), rest = Math.round(seconds % 60);
    return "T+" + minutes + ":" + String(rest).padStart(2, "0");
  };

  // The geometry module and the published artifact, fetched once and shared by every caller.
  // The launch-card path: the small geodesy module and the compact index, nothing else. This is what the
  // launch category needs to draw one pad-direction line and to know whether a pad has a reviewed
  // profile; the evidence module and the profile artifact stay untouched until a reader opens the
  // historical panel. The index is optional: a missing or invalid one removes the historical link and
  // leaves the pad line, which needs only the geodesy.
  function ensureCardData() {
    if (!pendingCard) {
      // A module import and a fetch both need a real origin. A file:// page can load neither, and
      // attempting it would only produce a cross-origin console error in someone's browser, so the
      // refusal is explicit and the interface explains itself instead.
      if (!servesModules()) {
        return Promise.reject(new Error("the ascent geometry needs the site to be served over http or https"));
      }
      pendingCard = Promise.all([
        import(at(GEODESY_PATH)),
        import(at(PAD_INDEX_PATH)).catch(function () { return null; }),
        fetch(at(PAD_INDEX_DATA_PATH), { cache: "no-cache" })
          .then(function (response) { return response.ok ? response.json() : null; })
          .catch(function () { return null; }),
      ]).then(function (loaded) {
        var geodesy = loaded[0], padIndex = loaded[1], index = loaded[2];
        var usable = null;
        if (padIndex && index && padIndex.validatePadIndex(index).ok) usable = index;
        return { geodesy: geodesy, padIndex: padIndex, index: usable, indexUnavailable: usable === null };
      });
    }
    return pendingCard;
  }

  // The explorer path: the full module, the published artifact and the review record. The review record
  // is optional and its absence is reported rather than assumed safe.
  function ensureData() {
    if (!pending) {
      if (!servesModules()) {
        return Promise.reject(new Error("the ascent panel needs the site to be served over http or https"));
      }
      pending = import(moduleUrl()).then(function (module) {
        return Promise.all([
          fetch(artifactUrl(), { cache: "no-cache" }).then(function (response) {
            if (!response.ok) throw new Error("profile artifact unavailable (" + response.status + ")");
            return response.text();
          }),
          fetch(at(REVIEW_PATH), { cache: "no-cache" }).then(function (response) {
            return response.ok ? response.json() : null;
          }).catch(function () { return null; }),
        ]).then(function (loaded) {
          var artifactText = loaded[0], review = loaded[1];
          var artifact = JSON.parse(artifactText);
          var validation = module.validateProfileArtifact(artifact);
          if (!validation.ok) throw new Error("profile artifact did not validate: " + validation.errors.slice(0, 3).join("; "));
          var reviewErrors = null;
          if (review) {
            var checked = module.validateReviewRecord(review);
            reviewErrors = checked.ok ? null : checked.errors;
          }
          return { module: module, artifact: artifact, artifactText: artifactText,
            review: review && !reviewErrors ? review : null,
            reviewMissing: review === null, reviewErrors: reviewErrors };
        });
      }).catch(function (error) {
        pending = null;
        throw error;
      });
    }
    return pending;
  }

  // Solar geometry comes from the astronomy layer the page already loads, so this module carries no
  // ephemeris of its own and the explorer and the launch cards agree by construction.
  function sunSource() {
    var Astro = window.OverheadAstro;
    if (!Astro || !Astro.AE || typeof Astro.geometricEquatorial !== "function") return null;
    return {
      sunUnitEcefAt: function (milliseconds) {
        var equatorial = Astro.geometricEquatorial("Sun", milliseconds);
        var hours = Astro.AE.SiderealTime(Astro.AE.MakeTime(new Date(milliseconds)));
        // The same one-line bridge the module documents: right ascension and sidereal time to Earth-fixed.
        var hourAngle = (equatorial.raDeg - hours * 15) * Math.PI / 180;
        var declination = equatorial.decDeg * Math.PI / 180;
        return { x: Math.cos(declination) * Math.cos(hourAngle),
          y: Math.cos(declination) * Math.sin(hourAngle), z: Math.sin(declination) };
      },
      solarElevationAt: function (milliseconds, latDeg, lonDeg) {
        return Astro.sunAltitude(milliseconds, { lat: latDeg, lon: lonDeg });
      },
    };
  }

  /* ---- rendering ---------------------------------------------------------- */

  // The compass sector: the one graphic that is honest at every evidence level, because it shows a range
  // of directions rather than a path. Used whenever elevation is not permitted.
  function sectorSVG(direction, padRangeM, padCompass) {
    var size = 128, centre = size / 2, radius = centre - 16;
    var point = function (degrees, length) {
      var radians = degrees * Math.PI / 180;
      return [centre + Math.sin(radians) * length, centre - Math.cos(radians) * length];
    };
    var span = (((direction.toDeg - direction.fromDeg) % 360) + 360) % 360;
    var large = span > 180 ? 1 : 0;
    var from = point(direction.fromDeg, radius), to = point(direction.toDeg, radius);
    var heading = point(direction.centreDeg, radius);
    var cardinals = [[0, "N"], [90, "E"], [180, "S"], [270, "W"]].map(function (entry) {
      var at = point(entry[0], radius + 7);
      return '<text x="' + at[0].toFixed(1) + '" y="' + (at[1] + 3).toFixed(1) + '" text-anchor="middle" font-size="8">' + entry[1] + "</text>";
    }).join("");
    var label = "Compass sector from " + fixed(direction.fromDeg, 0) + " to " + fixed(direction.toDeg, 0) +
      " degrees, centred on " + direction.compass + " at " + fixed(direction.centreDeg, 0) + " degrees; the launch site lies " +
      padCompass + " at " + kilometres(padRangeM) + ", and the ascent direction is not the same thing";
    return '<svg class="ascent-sector" viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="' + esc(label) + '">' +
      '<circle cx="' + centre + '" cy="' + centre + '" r="' + radius + '" fill="none" stroke="currentColor" stroke-width="1" opacity="0.5"/>' +
      cardinals +
      '<path d="M ' + centre + " " + centre + " L " + from[0].toFixed(1) + " " + from[1].toFixed(1) + " A " + radius + " " + radius +
        " 0 " + large + " 1 " + to[0].toFixed(1) + " " + to[1].toFixed(1) + ' Z" fill="currentColor" opacity="0.3"/>' +
      '<line x1="' + centre + '" y1="' + centre + '" x2="' + heading[0].toFixed(1) + '" y2="' + heading[1].toFixed(1) +
        '" stroke="currentColor" stroke-width="2"/>' +
      '<circle cx="' + centre + '" cy="' + centre + '" r="2.5" fill="currentColor"/></svg>';
  }

  // Elevation against time, for the profiles that passed both gates. The below-horizon part stays on the
  // chart so a reader can see the geometry cross the horizon rather than only being told about it.
  function elevationSVG(series, summary) {
    var width = 330, height = 150, left = 30, right = 8, top = 10, bottom = 24;
    var times = series.map(function (sample) { return sample.t; });
    var elevations = series.map(function (sample) { return sample.elevationDeg; });
    var minTime = Math.min.apply(null, times), maxTime = Math.max.apply(null, times);
    var minElevation = Math.min(-2, Math.min.apply(null, elevations));
    var maxElevation = Math.max(5, Math.max.apply(null, elevations));
    var x = function (t) { return left + (t - minTime) / Math.max(1, maxTime - minTime) * (width - left - right); };
    var y = function (e) { return top + (maxElevation - e) / Math.max(1e-6, maxElevation - minElevation) * (height - top - bottom); };
    var curve = series.map(function (sample) { return x(sample.t).toFixed(1) + "," + y(sample.elevationDeg).toFixed(1); }).join(" ");
    var horizon = y(0);
    var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (fraction) {
      var t = minTime + (maxTime - minTime) * fraction;
      return '<text x="' + x(t).toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle" font-size="8">' +
        clockTime(t) + "</text>";
    }).join("");
    var peak = summary && summary.aboveHorizon
      ? '<circle cx="' + x(summary.aboveHorizon.maxElevationT).toFixed(1) + '" cy="' +
        y(summary.aboveHorizon.maxElevationDeg).toFixed(1) + '" r="3" fill="currentColor"/>'
      : "";
    var label = "Elevation above your horizon against time since liftoff, from " + fixed(minElevation, 0) +
      " to " + fixed(maxElevation, 0) + " degrees, " + (summary && summary.aboveHorizon
        ? "above the horizon from " + clockTime(summary.aboveHorizon.fromT) + " to " + clockTime(summary.aboveHorizon.toT)
        : "never above the horizon");
    return '<svg class="ascent-chart" viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(label) + '">' +
      '<line x1="' + left + '" y1="' + horizon.toFixed(1) + '" x2="' + (width - right) + '" y2="' + horizon.toFixed(1) +
        '" stroke="currentColor" stroke-dasharray="3 3" opacity="0.5"/>' +
      '<text x="' + (left - 3) + '" y="' + (horizon - 3).toFixed(1) + '" text-anchor="end" font-size="8">0 deg</text>' +
      '<text x="' + (left - 3) + '" y="' + (top + 8) + '" text-anchor="end" font-size="8">' + fixed(maxElevation, 0) + " deg</text>" +
      '<polyline points="' + curve + '" fill="none" stroke="currentColor" stroke-width="1.6"/>' + peak + ticks + "</svg>";
  }

  // The time-step view: the same geometry as the chart, in a form a phone and a screen reader can use.
  // The wrapper scrolls sideways on a narrow screen rather than forcing the whole dialog wider.
  function stepsTable(series) {
    var stride = Math.max(1, Math.round(series.length / 8));
    var rows = series.filter(function (sample, index) { return index % stride === 0; });
    if (rows[rows.length - 1] !== series[series.length - 1]) rows.push(series[series.length - 1]);
    var light = { sunlit: "sunlit", penumbra: "penumbra", umbra: "in shadow" };
    return '<div class="table-scroll"><table class="ascent-steps">' +
      '<caption class="small">Where the reconstruction places the vehicle, at intervals</caption>' +
      '<thead><tr><th scope="col">Time</th><th scope="col">Direction</th><th scope="col">Elevation</th>' +
      '<th scope="col">Range</th><th scope="col">Sunlight</th></tr></thead><tbody>' +
      rows.map(function (sample) {
        return "<tr><td>" + clockTime(sample.t) + "</td><td>" + esc(sample.azimuthCompass) + " · " +
          fixed(sample.azimuthDeg, 0) + " deg</td><td>" + fixed(sample.elevationDeg, 1) + " deg" +
          (sample.aboveHorizon ? "" : " (below)") + "</td><td>" + kilometres(sample.slantRangeM) + "</td><td>" +
          esc(light[sample.shadow] || "—") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* ---- the flight panel --------------------------------------------------- */

  function facts(explored, context) {
    var profile = explored.profile;
    var local = context.formatLocal ? context.formatLocal(Date.parse(explored.schedule.launchUtc), explored.observer.tz) : null;
    var rows = [
      ["Flight", profile.mission],
      ["Vehicle", profile.vehicle || "—"],
      ["Launched", explored.schedule.launchUtc + (local ? " · " + local + " your time" : "") +
        " (to the " + explored.schedule.precision + ")"],
      ["Pad", explored.pad.site],
      ["Observer", explored.observer.latDeg.toFixed(3) + ", " + explored.observer.lonDeg.toFixed(3)],
    ];
    return '<dl class="ascent-facts">' + rows.map(function (row) {
      return "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>";
    }).join("") + "</dl>";
  }

  function directionSection(explored) {
    var direction = explored.direction;
    var parts = ['<h3 id="ascent-direction">Which way it went</h3>'];
    if (!direction) {
      parts.push('<p class="small">This profile carries no published direction, so none is shown.</p>');
      return parts.join("");
    }
    parts.push('<div class="ascent-figure">' + sectorSVG(direction, explored.pad.slantRangeM, explored.pad.azimuthCompass) + "<div>");
    parts.push('<p><strong>' + esc(direction.compass) + " · " + fixed(direction.centreDeg, 1) + "°</strong> plus or minus " +
      fixed(direction.uncertaintyDeg, 1) + "° from " + esc(direction.basis) + ".</p>");
    parts.push('<p class="small">The launch site itself lies ' + esc(explored.pad.azimuthCompass) + " at " +
      kilometres(explored.pad.slantRangeM) + " and " + fixed(explored.pad.elevationDeg, 0) +
      "° above your horizon: that is where the pad is, not where the rocket went.</p>");
    if (Number.isFinite(direction.alternateDeg)) {
      parts.push('<p class="small">The orbital plane reaches your latitude on two headings. The reconstruction used ' +
        esc(direction.branch || "an unstated branch") + "; the mirror heading is " + fixed(direction.alternateDeg, 1) + "°.</p>");
    }
    parts.push('<p class="small">Source: ' + esc(direction.source) + "</p></div></div>");
    return parts.join("");
  }

  function geometrySection(explored) {
    var parts = ['<h3 id="ascent-geometry">What your sky would have shown</h3>'];
    if (!explored.series || !explored.summary) {
      parts.push('<p class="small">No elevation and no timed window are published for this flight. ' +
        "The reconstruction did not pass both anchoring gates, so its own altitude and downrange series is " +
        "what failed the check, and nothing is derived from it.</p>");
      return parts.join("");
    }
    var summary = explored.summary;
    parts.push('<div class="ascent-figure">' + elevationSVG(explored.series, summary) + "<div>");
    parts.push(summary.aboveHorizon
      ? '<p><strong>Above your horizon ' + clockTime(summary.aboveHorizon.fromT) + " to " + clockTime(summary.aboveHorizon.toT) +
        "</strong>, peaking at " + fixed(summary.aboveHorizon.maxElevationDeg, 1) + "° in the " +
        fixed(summary.aboveHorizon.azimuth.fromDeg, 0) + "°–" + fixed(summary.aboveHorizon.azimuth.toDeg, 0) +
        "° sector, nearest " + kilometres(summary.aboveHorizon.closestSlantRangeM) + " away.</p>"
      : "<p><strong>Never above your horizon at this observing location</strong> during the reconstructed ascent.</p>");
    parts.push('<p class="small">This is reconstructed geometry from a past flight, not a forecast, and a geometric ' +
      "horizon crossing is not a statement that anyone saw anything: optics, cloud and your own skyline are not in it.</p>");
    parts.push('<p class="small">The reconstruction lays the flown downrange along the heading above as a great ' +
      "circle; a real ascent yaw-steers, so cross-track position degrades with distance.</p>");
    parts.push("</div></div>");
    parts.push(stepsTable(explored.series));
    return parts.join("");
  }

  function illuminationSection(explored) {
    var illumination = explored.illumination || {};
    var parts = ['<h3 id="ascent-light">Light</h3>'];
    if (!Number.isFinite(illumination.observerSunElevationDeg)) {
      parts.push('<p class="small">No solar geometry was available, so no lighting context is stated.</p>');
    } else {
      parts.push('<p>At liftoff your own sky was <strong>' + esc(illumination.observerTwilight) + "</strong> — the Sun " +
        Math.abs(illumination.observerSunElevationDeg).toFixed(1) + "° " +
        (illumination.observerSunElevationDeg < 0 ? "below" : "above") + " your horizon.</p>");
    }
    if (illumination.sunlitRuns && illumination.sunlitRuns.length) {
      parts.push('<p class="small">Reconstructed vehicle sunlight: sunlit ' +
        illumination.sunlitRuns.map(function (run) { return clockTime(run.fromT) + " to " + clockTime(run.toT); }).join(", ") +
        (illumination.penumbraTimes && illumination.penumbraTimes.length
          ? "; penumbra at " + illumination.penumbraTimes.map(clockTime).join(", ") : "") +
        ". " + esc(illumination.method || "") + "</p>");
      if (illumination.darkObserverWhileVehicleSunlit && illumination.darkObserverWhileVehicleSunlit.length) {
        parts.push('<p class="small">Two separate facts, deliberately not combined into a chance of seeing ' +
          "anything: the vehicle was reconstructed as sunlit while your sky was dark from " +
          illumination.darkObserverWhileVehicleSunlit.map(function (run) {
            return clockTime(run.fromT) + " to " + clockTime(run.toT);
          }).join(", ") + ".</p>");
      }
    } else if (explored.series) {
      parts.push('<p class="small">No vehicle-illumination run is published for this profile.</p>');
    }
    parts.push('<p class="small">Brightness, plume size, apparent size and the chance of seeing anything are not ' +
      "computed anywhere in this product: the sources do not support them.</p>");
    return parts.join("");
  }


  function validationSection(explored) {
    var validation = explored.validation || {};
    var plane = validation.plane || {};
    var terminal = validation.terminal || {};
    var parts = ['<h3 id="ascent-checks">How it was checked</h3>', '<ul class="small">'];
    parts.push("<li><strong>Orbital plane:</strong> " + (plane.applicable
      ? "a published azimuth was checked against the achieved inclination; the check " +
        (plane.consistent ? "agreed" : "did not agree") +
        (Number.isFinite(plane.deltaDeg) ? " (difference " + fixed(Math.abs(plane.deltaDeg), 1) + "°, tolerance 3°)" : "")
      : "not applicable here — " + esc(plane.note || "no independent azimuth was available") + "</li>"));
    parts.push("<li><strong>Terminal state:</strong> " + (terminal.applicable
      ? "the reconstructed end state was compared with the catalogued orbit by vis-viva at the reconstructed " +
        "geocentric radius: " + fixed((terminal.speedRelativeError || 0) * 100, 1) + "% in speed and " +
        fixed(terminal.altitudeErrorKm, 1) + " km in altitude — " +
        (terminal.passes ? "within" : "outside") + " the published tolerances."
      : "not applicable — " + esc(terminal.reason || "no insertion orbit was available") + "</li>"));
    if (explored.permissions && explored.permissions.reasons && explored.permissions.reasons.length) {
      parts.push("<li><strong>Withheld:</strong> " + esc(explored.permissions.reasons.join("; ")) + "</li>");
    }
    parts.push("<li><strong>Orbit anchor:</strong> " + esc(explored.provenance.anchor || "none") + " (" +
      esc(explored.orbit && explored.orbit.appliesTo ? explored.orbit.appliesTo : "unstated") + " state)" +
      (explored.provenance.anchorUrl ? ' — <a href="' + esc(explored.provenance.anchorUrl) +
        '" target="_blank" rel="noopener">catalogue</a>' : "") + ".</li>");
    parts.push('<li><strong>Profile:</strong> <a href="' + esc(explored.provenance.sourceUrl) +
      '" target="_blank" rel="noopener">' + esc(explored.provenance.source) + "</a> — " +
      esc(explored.provenance.licence) + ", retrieved " + esc(explored.provenance.retrievedUtc) + ". " +
      esc(explored.provenance.method) + "</li>");
    parts.push('<li><a href="docs/trajectory-profiles.md" target="_blank" rel="noopener">Full provenance and ' +
      "validation record</a></li>");
    parts.push("</ul>");
    if (explored.limits && explored.limits.length) {
      parts.push('<details class="small"><summary>Limits of this reconstruction</summary><ul>' +
        explored.limits.map(function (limit) { return "<li>" + esc(limit) + "</li>"; }).join("") + "</ul></details>");
    }
    if (explored.refusals && explored.refusals.length) {
      parts.push('<details class="small"><summary>What this cannot tell you</summary><ul>' +
        explored.refusals.map(function (refusal) { return "<li>" + esc(refusal) + "</li>"; }).join("") +
        (explored.unknown || []).map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("") +
        "</ul></details>");
    }
    return parts.join("");
  }



  /* ---- the historical explorer dialog -------------------------------------- */

  function observerEntries(context) {
    var entries = [], seen = {};
    var push = function (name, site) {
      if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return;
      var key = site.lat.toFixed(4) + "," + site.lon.toFixed(4);
      if (seen[key]) return;
      seen[key] = true;
      entries.push({ name: name, latDeg: site.lat, lonDeg: site.lon, tz: site.tz || "UTC" });
    };
    push(context.site && context.site.name ? "Current location — " + context.site.name : "Current location", context.site);
    (context.observers || []).forEach(function (site) { push(site.name, site); });
    return entries;
  }

  function currentObserver(context, entries) {
    var select = document.getElementById("ascent-observer");
    var index = select && select.selectedIndex >= 0 ? Number(select.value) : 0;
    return entries[Number.isFinite(index) ? index : 0] || entries[0] || null;
  }

  function render(context, entries) {
    var body = document.getElementById("ascent-body");
    var status = document.getElementById("ascent-status");
    var flightSelect = document.getElementById("ascent-flight");
    if (!body || !flightSelect) return;
    var observer = currentObserver(context, entries);
    if (!observer) {
      body.innerHTML = '<p class="small warn">No observing location is available, so no observer geometry can be shown.</p>';
      return;
    }
    return ensureData().then(function (data) {
      var profile = data.artifact.profiles.find(function (entry) { return entry.id === flightSelect.value; });
      if (!profile) { body.innerHTML = '<p class="small warn">That profile is not in the published set.</p>'; return; }
      var explored = data.module.exploreHistorical({ profile: profile, observer: observer, sun: sunSource(),
        stepS: null, review: data.review });
      body.innerHTML = '<article class="ascent-panel">' + reviewNotice(explored, data) + facts(explored, context) +
        directionSection(explored) + geometrySection(explored) + illuminationSection(explored) +
        validationSection(explored) + "</article>";
      if (status) {
        status.textContent = effectiveSummary(explored);
      }
      // A stale index is a consistency signal, not a claim: it never changes what is shown, because the
      // artifact is the only source of geometry, but it is worth saying out loud.
      staleIndexNotice().then(function (notice) {
        if (notice && status) status.textContent = effectiveSummary(explored) + " " + notice;
      });
    }).catch(function (error) {
      body.innerHTML = '<p class="small warn">The reviewed profiles could not be loaded (' + esc(error.message) +
        "). Nothing is shown rather than something unchecked.</p>";
      if (status) status.textContent = "";
    });
  }

  // Two facts that must never be merged into "the numbers are fine": whether the gates passed, and
  // whether an evidence review has suspended the output anyway.
  function effectiveSummary(explored) {
    var gates = explored.gatePermissions && explored.gatePermissions.elevation
      ? "passed both anchoring gates" : "did not pass both anchoring gates";
    if (explored.review && explored.review.action && explored.review.action !== "none") {
      return "The reconstruction " + gates + ", but an evidence review (" + explored.review.action +
        " since " + explored.review.since + ") suspends what it may show.";
    }
    return explored.permissions && explored.permissions.elevation
      ? "Reconstruction passed both anchoring gates: direction, elevation and timed geometry are shown."
      : "Reconstruction is direction-only: its elevation and timed window are withheld.";
  }

  function reviewNotice(explored, data) {
    var parts = [];
    if (explored.review && explored.review.action && explored.review.action !== "none") {
      parts.push('<p class="small ascent-banner"><strong>Output suspended pending evidence review.</strong> ' +
        esc(explored.review.reason) + " (since " + esc(explored.review.since) + "; " + esc(explored.review.evidence) +
        "). The recorded gate results are unchanged and the profile stays in the record.</p>");
    }
    if (data.reviewMissing) {
      parts.push('<p class="small">The evidence review record could not be read, so this panel cannot confirm ' +
        "that no review is pending. The gate results below are the profile's own and are unaffected.</p>");
    } else if (data.reviewErrors) {
      parts.push('<p class="small warn">The evidence review record did not validate, so no review entry was ' +
        "applied: " + esc(data.reviewErrors.slice(0, 2).join("; ")) + "</p>");
    }
    return parts.join("");
  }

  // Compare the digest of the artifact bytes we already fetched with the index's recorded digest, when
  // the browser can hash. No material change here ever alters what is shown: the artifact is the only
  // source of geometry, and this is a consistency signal about a pad link.
  function staleIndexNotice() {
    var subtle = window.crypto && window.crypto.subtle;
    return ensureData().then(function (data) {
      if (!subtle || !window.TextEncoder) return "";
      return ensureCardData().then(function (cards) {
        if (!cards.index) return "";
        return subtle.digest("SHA-256", new TextEncoder().encode(data.artifactText)).then(function (buffer) {
          var digest = Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
            return byte.toString(16).padStart(2, "0");
          }).join("");
          return digest === cards.index.artifact_digest ? ""
            : "The published pad index was built from a different revision of the profiles, so its pad links may be stale.";
        });
      });
    }).catch(function () { return ""; });
  }


  function open(context) {
    context = context || {};
    api._context = context;
    var dialog = document.getElementById("ascent-dialog");
    var flightSelect = document.getElementById("ascent-flight");
    var observerSelect = document.getElementById("ascent-observer");
    var status = document.getElementById("ascent-status");
    if (!dialog || !flightSelect || !observerSelect) return Promise.resolve();
    if (!dialog.open) { if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "open"); }
    var entries = observerEntries(context);
    observerSelect.innerHTML = entries.map(function (entry, index) {
      return '<option value="' + index + '">' + esc(entry.name) + "</option>";
    }).join("");
    if (status) status.textContent = "Loading the reviewed historical profiles…";
    return ensureData().then(function (data) {
      flightSelect.innerHTML = data.artifact.profiles.map(function (profile) {
        return '<option value="' + esc(profile.id) + '">' + esc(profile.mission) + " · " +
          esc(profile.launch.utc.slice(0, 10)) + " · " + esc(String(profile.site.pad).split(",")[0]) + "</option>";
      }).join("");
      flightSelect.disabled = false;
      return render(context, entries);
    }).catch(function (error) {
      if (status) status.textContent = "";
      var body = document.getElementById("ascent-body");
      if (body) body.innerHTML = '<p class="small warn">The historical profiles could not be loaded (' +
        esc(error.message) + ").</p>";
    });
  }

  document.addEventListener("change", function (event) {
    var target = event.target;
    if (target && (target.id === "ascent-flight" || target.id === "ascent-observer") && api._context) {
      render(api._context, observerEntries(api._context));
    }
  });

  /* ---- launch-card pad geometry ------------------------------------------- */

  // The upcoming-launch enhancement: the direction of the *pad* from the observer, which needs no
  // trajectory and no launch time, plus a clearly separated way into the historical reconstructions from
  // the same pad. It never attaches a historical profile to an upcoming flight.
  function enhanceLaunchCards(context) {
    var placeholders = document.querySelectorAll("[data-pad-geometry]");
    if (!placeholders.length || !context || !context.records) return Promise.resolve();
    // A card's own link opens the panel with the same observing location the card was drawn for.
    api._context = context;
    // Only the small geodesy module and the compact pad index are loaded here. The full evidence module
    // and the profile artifact are not touched until a reader opens the historical panel.
    return ensureCardData().then(function (cards) {
      Array.prototype.forEach.call(placeholders, function (node) {
        var record = context.records.find(function (entry) { return entry.id === node.getAttribute("data-pad-geometry"); });
        if (!record || !record.pad || !Number.isFinite(record.pad.latitude) || !Number.isFinite(record.pad.longitude)) return;
        var site = context.site;
        if (!site || !Number.isFinite(site.lat)) return;
        var between = cards.geodesy.greatCircleBetween(site.lat, site.lon, record.pad.latitude, record.pad.longitude);
        var sight = cards.geodesy.look({ latDeg: site.lat, lonDeg: site.lon, heightM: 0 },
          cards.geodesy.geodeticToEcef(record.pad.latitude, record.pad.longitude, 0));
        var shared = cards.padIndex.profilesForPad(cards.index, record.pad);
        node.innerHTML = "<strong>Launch pad direction</strong> " + esc(sight.azimuthCompass) + " (" +
          sight.azimuthDeg.toFixed(0) + "°) at " + kilometres(between.distanceM) + ", " +
          (sight.elevationDeg >= 0 ? sight.elevationDeg.toFixed(0) + "° above your horizon"
            : Math.abs(sight.elevationDeg).toFixed(0) + "° below your horizon") +
          " — the pad's direction, not the rocket's path." +
          (shared.length ? ' <button type="button" class="link-button" data-ascent-open>See ' +
            (shared.length === 1 ? "the reconstructed ascent from this pad" : shared.length + " reconstructed ascents from this pad") +
            " (historical)</button>" : "");
        node.hidden = false;
      });
    }).catch(function () { /* the launch card keeps its published facts and says nothing further */ });
  }

  var api = { open: open, enhanceLaunchCards: enhanceLaunchCards, ensureData: ensureData, _context: null };
  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest("[data-ascent-open]") : null;
    if (!button) return;
    event.preventDefault();
    api.open(api._context || {});
  });
  window.OverheadLaunchExplorer = api;
})();
