import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {verifyProductionRedirects} from './verify-redirects.mjs';
import {verifyUntilReady} from './verify-readiness.mjs';
const base=new URL(process.argv[2]||'https://worthlookingup.com/');
async function verify() {
async function get(file){
  const response=await fetch(new URL(file,base),{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,file+' HTTP status');return Buffer.from(await response.arrayBuffer());
}
const html=(await get('/')).toString();
assert.match(html,/<title>Worth Looking Up/);assert.match(html,/data-site-id="worthlookingup"/);
assert.match(html,/rel="canonical" href="https:\/\/worthlookingup.com\/"/);
const local=fs.readFileSync('index.html','utf8');
assert.equal(html,local,'Deployed HTML must match this checkout');
const manifest=JSON.parse(fs.readFileSync('docs/source-manifest.json'));
await Promise.all(Object.entries(manifest.unchanged_files).map(async([file,hash])=>{
  assert.equal(crypto.createHash('sha256').update(await get(file)).digest('hex'),hash,file+' deployed hash');
}));
// Pipeline outputs are refreshed on a schedule and deployed by their own workflow, so a frozen
// migration digest would fail as soon as the pipeline legitimately regenerated them (and the deployed
// copy can briefly lag the checkout until that workflow's own deploy finishes). What must hold for
// these is that the deployed artifact is a real, valid, attributed artifact of the documented schema.
for(const [file,spec] of Object.entries(manifest.pipeline_outputs||{})){
  const deployed=JSON.parse((await get(file)).toString('utf8'));
  assert.equal(deployed.schema,spec.schema,file+' deployed schema');
  assert.ok(Number.isFinite(Date.parse(deployed.generated_at)),file+' deployed generation time');
  assert.ok(deployed[spec.list]&&Object.keys(deployed[spec.list]).length,file+' deployed '+spec.list);
  assert.ok(deployed[spec.provenance]&&Object.keys(deployed[spec.provenance]).length,file+' deployed provenance');
  const identical=JSON.stringify(deployed)===JSON.stringify(JSON.parse(fs.readFileSync(file,'utf8')));
  console.log('Pipeline output:',file,'deployed schema/provenance valid, bytes match this checkout:',identical);
}
for(const file of ['overhead-discovery.js','overhead-calendar.js','overhead-milkyway.js','analytics-lite.js','preferences-transfer.js','assets/brand/identity.css','assets/icons/favicon.svg','assets/imagery/night-sky.svg','assets/brand/social.png','assets/imagery/earth-at-night-640.webp','assets/imagery/earth-at-night-1280.webp','assets/imagery/earth-at-night-1920.webp','assets/imagery/earth-at-night.jpg',
  // Phase 5B/5C: the reviewed historical profiles are committed by hand, not refreshed on a schedule, so
  // their deployed bytes must equal this checkout exactly, together with the two geometry modules, the
  // compact pad index the launch calendar reads, the evidence review record and the adapter that binds
  // them. A mismatch here is how a stale index or a dropped review record is caught in production.
  'overhead-launch-explorer.js','src/launches/launch-trajectory.mjs','src/launches/launch-geodesy.mjs',
  'src/launches/launch-pad-index.mjs','data/launches/trajectory-profiles.json',
  'data/launches/trajectory-pad-index.json','data/launches/trajectory-review.json','docs/trajectory-profiles.md',
  // Phase 6C: the session builder is fetched on demand, and the point artifact it reads now carries the
  // azimuth profiles, so both are checked against this checkout rather than assumed to have deployed.
  'overhead-sessions.js','data/geodata/points.json']) {
  assert.deepEqual(await get(file),fs.readFileSync(file),file+' deployed bytes');
}
const missing=await fetch(new URL('/missing-worker-verification.js',base));assert.equal(missing.status,404);
if(base.hostname==='worthlookingup.com'){
  for (const chain of await verifyProductionRedirects()) console.log('Redirect:',JSON.stringify(chain));
}
console.log('PASS: HTTPS deployed HTML, release, scientific hashes, both workers and data, brand/transfer/analytics bytes, real 404'+(base.hostname==='worthlookingup.com'?', permanent canonical/legacy redirects preserve queries and nonlegacy paths':'')+' at '+base.origin);

}
if(process.argv.includes('--wait')) await verifyUntilReady(verify);
else await verify();
