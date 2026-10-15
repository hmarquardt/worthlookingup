import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {verifyProductionRedirects} from './verify-redirects.mjs';
const base=new URL(process.argv[2]||'https://worthlookingup.com/');
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
for(const file of ['analytics-lite.js','preferences-transfer.js','assets/brand/identity.css','assets/icons/favicon.svg','assets/imagery/night-sky.svg','assets/brand/social.png']){
  assert.deepEqual(await get(file),fs.readFileSync(file),file+' deployed bytes');
}
const missing=await fetch(new URL('/missing-worker-verification.js',base));assert.equal(missing.status,404);
if(base.hostname==='worthlookingup.com'){
  for (const chain of await verifyProductionRedirects()) console.log('Redirect:',JSON.stringify(chain));
}
console.log('PASS: HTTPS deployed HTML, release, scientific hashes, both workers and data, brand/transfer/analytics bytes, real 404'+(base.hostname==='worthlookingup.com'?', permanent canonical/legacy redirects preserve queries and nonlegacy paths':'')+' at '+base.origin);
