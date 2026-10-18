import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
import { readGeoTiff } from './geotiff.mjs';
// A small genuine 3DEP extract around the Lusk Creek/Pound Hollow ridge country: enough relief for a real
// obstruction case, small enough to commit.
const bbox = '-88.50,37.55,-88.42,37.61';
const url = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage' +
  '?bbox=' + bbox + '&bboxSR=4326&imageSR=4326&size=96,96&format=tiff&f=image';
const response = await fetch(url, { headers: { 'user-agent': 'worthlookingup-geodata-research/0.1' } });
if (!response.ok) throw new Error('HTTP ' + response.status);
const tiff = readGeoTiff(Buffer.from(await response.arrayBuffer()));
const values = Array.from(tiff.values, v => (Number.isFinite(v) ? Math.round(v) : null));
const fixture = {
  schema: 'worthlookingup.geodata-dem-fixture/1',
  note: 'A genuine USGS 3DEP extract, committed at reduced size so offline tests can run the real terrain pipeline. Regenerate with research/geodata/tools/make-fixture.mjs.',
  source: 'usgs-3dep',
  sourceUrl: url,
  retrievedAt: new Date().toISOString(),
  attribution: 'courtesy of the U.S. Geological Survey',
  request: { bbox: bbox.split(',').map(Number), size: '96x96' },
  bbox: tiff.bbox,
  width: tiff.width,
  height: tiff.height,
  units: 'm',
  kind: tiff.kind,
  pixelSizeMDeg: (tiff.bbox[2] - tiff.bbox[0]) / tiff.width,
  values,
};
fs.mkdirSync(path.join(here, '..', 'fixtures'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'fixtures', 'shawnee-ridge-dem.json'), JSON.stringify(fixture) + '\n');
const finite = values.filter(v => v !== null);
console.log('fixture', tiff.width + 'x' + tiff.height, 'bbox', tiff.bbox.map(v => v.toFixed(3)).join(','),
  'min', Math.min(...finite), 'max', Math.max(...finite), 'relief', Math.max(...finite) - Math.min(...finite),
  'bytes', JSON.stringify(fixture).length);
