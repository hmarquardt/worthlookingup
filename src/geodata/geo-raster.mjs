/* A georeferenced single-band raster and how to read one value out of it.

   Both evidence rasters in this prototype — bare-earth elevation and nighttime radiance — arrive as
   single-band grids on a geographic (lon/lat) frame, so they share a reader. The rule that matters is that
   missing data is *missing*: a nodata or out-of-coverage sample is returned as null with a reason, never as
   zero. A zero elevation is Death Valley; a zero radiance is a claim that nowhere is lit. */

export function makeRaster({ width, height, values, bbox, nodata = null, source = null, units = null, resolutionM = null }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('raster: width and height must be positive integers');
  }
  if (!values || values.length !== width * height) {
    throw new Error('raster: expected ' + width * height + ' values, received ' + (values ? values.length : 'none'));
  }
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    throw new Error('raster: bbox must be [west, south, east, north]');
  }
  const [west, south, east, north] = bbox;
  if (!(east > west) || !(north > south)) throw new Error('raster: bbox is empty (' + bbox.join(', ') + ')');
  return { width, height, values, bbox: [west, south, east, north], nodata, source, units, resolutionM,
    pixel: { x: (east - west) / width, y: (north - south) / height } };
}

function isMissing(raster, value) {
  if (!Number.isFinite(value)) return true;
  if (raster.nodata === null || raster.nodata === undefined) return false;
  return Math.abs(value - raster.nodata) <= Math.abs(raster.nodata) * 1e-9;
}

/* Fractional pixel coordinates of a lon/lat position. Pixel (0,0) covers the north-west corner cell, so its
   centre is half a pixel in from the corner — the GeoTIFF convention the 3DEP reader already assumes. */
export function pixelCoordinates(raster, { lat, lon }) {
  const [west, south, east, north] = raster.bbox;
  return { x: (lon - west) / raster.pixel.x - 0.5, y: (north - lat) / raster.pixel.y - 0.5,
    inside: lon >= west && lon <= east && lat >= south && lat <= north };
}

/* Bilinear sampling with a strict stencil: if any of the four surrounding samples is missing, the answer is
   missing. Averaging across a hole would invent a value, and a horizon or a radiance built on an invented
   value is exactly the kind of false precision this project refuses. */
export function sampleRaster(raster, point, { method = 'bilinear' } = {}) {
  const { x, y, inside } = pixelCoordinates(raster, point);
  if (!inside) return { value: null, reason: 'outside-coverage', coverage: 0 };
  const clamp = (v, max) => Math.max(0, Math.min(max - 1, v));
  if (method === 'nearest') {
    const i = clamp(Math.round(x), raster.width), j = clamp(Math.round(y), raster.height);
    const value = raster.values[j * raster.width + i];
    return isMissing(raster, value) ? { value: null, reason: 'nodata', coverage: 0 }
      : { value, reason: null, coverage: 1, pixel: { i, j } };
  }
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const corners = [];
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const i = x0 + dx, j = y0 + dy;
    if (i < 0 || j < 0 || i >= raster.width || j >= raster.height) return { value: null, reason: 'outside-coverage', coverage: 0 };
    const value = raster.values[j * raster.width + i];
    if (isMissing(raster, value)) return { value: null, reason: 'nodata', coverage: 0 };
    corners.push(value);
  }
  const top = corners[0] * (1 - fx) + corners[1] * fx;
  const bottom = corners[2] * (1 - fx) + corners[3] * fx;
  return { value: top * (1 - fy) + bottom * fy, reason: null, coverage: 1 };
}

/* A raster with an explicit sampling interface, which is what the terrain and radiance layers consume. This
   is the seam that keeps both of them independent of where the numbers came from — a test fixture, a
   downloaded extract or a future tile service all look the same. */
export function rasterSampler(raster, options = {}) {
  return {
    describe: () => ({ source: raster.source, units: raster.units, bbox: raster.bbox.slice(),
      width: raster.width, height: raster.height, resolutionM: raster.resolutionM }),
    sample: (point) => sampleRaster(raster, point, options),
  };
}
