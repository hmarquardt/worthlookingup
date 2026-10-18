/* A minimal reader for the GeoTIFFs the USGS 3DEP ImageServer returns from `exportImage`.

   It is deliberately tiny rather than general: 3DEP serves single-band, uncompressed, little-endian
   float32 (or int16) rasters in one strip, and this reads exactly that — the tags it needs, the pixel
   array, and the georeferencing, with a refusal for anything else. A general TIFF or GeoTIFF library
   would be a large dependency for one endpoint, and a silently mis-read elevation is worse than a
   refusal, so every unsupported case throws with the tag that caused it. */

const TAG = {
  width: 256, length: 257, bitsPerSample: 258, compression: 259, samplesPerPixel: 277,
  rowsPerStrip: 278, stripOffsets: 273, stripByteCounts: 279, sampleFormat: 339,
  tileWidth: 322, tileLength: 323, tileOffsets: 324, tileByteCounts: 325,
  modelPixelScale: 33550, modelTiepoint: 33922, modelTransformation: 34264, geoKeyDirectory: 34735,
};

function readIfd(buffer, offset) {
  const entries = buffer.readUInt16LE(offset);
  const tags = new Map();
  for (let i = 0; i < entries; i++) {
    const at = offset + 2 + i * 12;
    const tag = buffer.readUInt16LE(at);
    const type = buffer.readUInt16LE(at + 2);
    const count = buffer.readUInt32LE(at + 4);
    const valueOffset = at + 8;
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 }[type];
    if (!size) throw new Error('tiff: unsupported field type ' + type + ' for tag ' + tag);
    const bytes = size * count;
    const dataOffset = bytes <= 4 ? valueOffset : buffer.readUInt32LE(valueOffset);
    const read = index => {
      const at2 = dataOffset + index * size;
      return type === 3 ? buffer.readUInt16LE(at2) : type === 4 ? buffer.readUInt32LE(at2) : null;
    };
    const readDouble = index => {
      const at2 = dataOffset + index * 8;
      return type === 12 ? buffer.readDoubleLE(at2) : type === 11 ? buffer.readFloatLE(at2) : null;
    };
    tags.set(tag, { type, count, read, readDouble });
  }
  return tags;
}

/* Reads a 3DEP-style GeoTIFF and returns { width, height, values, nodata, bbox, scale, crs }.
   `bbox` is [west, south, east, north] in the raster's own geographic CRS (EPSG:4326 here). */
function readGeoTiff(buffer) {
  const order = buffer.toString('ascii', 0, 2);
  if (order !== 'II') throw new Error('tiff: only little-endian files are supported (byte order ' + order + ')');
  if (buffer.readUInt16LE(2) !== 42) throw new Error('tiff: not a TIFF (magic ' + buffer.readUInt16LE(2) + ')');
  const tags = readIfd(buffer, buffer.readUInt32LE(4));
  const tag = name => tags.get(TAG[name]);
  const width = tag('width').read(0), height = tag('length').read(0);
  const compression = tag('compression') ? tag('compression').read(0) : 1;
  if (compression !== 1) throw new Error('tiff: only uncompressed rasters are supported (compression ' + compression + ')');
  const samples = tag('samplesPerPixel') ? tag('samplesPerPixel').read(0) : 1;
  if (samples !== 1) throw new Error('tiff: only single-band rasters are supported (' + samples + ' bands)');
  const bits = tag('bitsPerSample').read(0);
  const format = tag('sampleFormat') ? tag('sampleFormat').read(0) : 1;
  const kinds = { '32:3': 'float32', '16:2': 'int16', '32:2': 'int32', '16:1': 'uint16' };
  const kind = kinds[bits + ':' + format];
  if (!kind) throw new Error('tiff: unsupported sample format ' + bits + ' bits, format ' + format);
  const count = tag('stripByteCounts'), offsetTag = tag('stripOffsets');
  const tileOffsets = tag('tileOffsets'), tileCounts = tag('tileByteCounts');
  const tileWidth = tag('tileWidth'), tileLength = tag('tileLength');
  const bytesPerSample = bits / 8;
  const readSample = (at) => kind === 'float32' ? buffer.readFloatLE(at) : kind === 'int16' ? buffer.readInt16LE(at)
    : kind === 'int32' ? buffer.readInt32LE(at) : buffer.readUInt16LE(at);
  // Absent tiles are holes, not corruption: ArcGIS writes a zero-length tile when a whole tile is nodata,
  // so the array starts as NaN and a hole can never be mistaken for a measured zero elevation.
  const values = new Float64Array(width * height).fill(NaN);
  if (tileOffsets && tileCounts && tileWidth && tileLength) {
    // Tiled layout: tiles run left to right, top to bottom, each padded to the full tile size.
    const tw = tileWidth.read(0), tl = tileLength.read(0);
    const across = Math.ceil(width / tw), down = Math.ceil(height / tl);
    for (let ty = 0; ty < down; ty++) {
      for (let tx = 0; tx < across; tx++) {
        const index = ty * across + tx;
        const start = tileOffsets.read(index);
        const bytes = tileCounts.read(index);
        if (bytes === 0) continue;                     // a hole: leave the samples missing
        if (bytes < tw * tl * bytesPerSample) {
          throw new Error('tiff: tile ' + index + ' holds ' + bytes + ' bytes, ' + tw * tl * bytesPerSample + ' expected');
        }
        for (let row = 0; row < tl; row++) {
          const y = ty * tl + row;
          if (y >= height) break;
          for (let column = 0; column < tw; column++) {
            const x = tx * tw + column;
            if (x >= width) continue;
            values[y * width + x] = readSample(start + (row * tw + column) * bytesPerSample);
          }
        }
      }
    }
  } else {
    const expected = width * height * bytesPerSample;
    const bytes = count.read(0), offset = offsetTag.read(0);
    if (bytes < expected) throw new Error('tiff: strip holds ' + bytes + ' bytes, ' + expected + ' expected');
    for (let i = 0; i < values.length; i++) values[i] = readSample(offset + i * bytesPerSample);
  }
  // Georeferencing: 3DEP writes a pixel scale and a tiepoint at the raster's outer corner. A tiepoint at
  // (0,0) is the north-west corner of the first pixel, so the raster covers exactly scale * size.
  const scaleTag = tag('modelPixelScale'), tieTag = tag('modelTiepoint');
  if (!scaleTag || !tieTag) throw new Error('tiff: no ModelPixelScale/ModelTiepoint, so the raster cannot be placed');
  const sx = scaleTag.readDouble(0), sy = scaleTag.readDouble(1);
  const tieX = tieTag.readDouble(3), tieY = tieTag.readDouble(4);
  // GeoKeyDirectory: four header shorts, then triples of (key, tagLocation, count, value). GTModelTypeGeoKey
  // (1024) is 2 for a geographic CRS and 1 for projected; anything else means the raster is not lon/lat.
  const geoKeys = tag('geoKeyDirectory');
  let crs = null, epsg = null;
  if (geoKeys) {
    const keys = geoKeys.count;
    for (let i = 4; i + 3 < keys; i += 4) {
      const id = geoKeys.read(i), location = geoKeys.read(i + 1), value = geoKeys.read(i + 3);
      if (location !== 0) continue;
      if (id === 1024) crs = value;
      if (id === 2048) epsg = value;   // GeographicTypeGeoKey
    }
  }
  return { width, height, values, kind, scale: { x: sx, y: sy },
    bbox: [tieX, tieY - sy * height, tieX + sx * width, tieY], crs, epsg,
    nodata: null };
}

export { readGeoTiff, TAG };
