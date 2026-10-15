const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const manifest=require('../docs/source-manifest.json');
for(const [file,hash]of Object.entries(manifest.unchanged_files)){
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,file+' differs from migration source');
}
const html=fs.readFileSync('index.html','utf8');
assert.match(html,/<title>Worth Looking Up/);
assert.match(html,/data-site-id="worthlookingup"/);
assert.match(html,/rel="canonical" href="https:\/\/worthlookingup.com\/"/);
assert.doesNotMatch(html,/https?:\/\/[^\s'"<>]*junkdrawer/i);
assert.doesNotMatch(html,/data-junkdrawer|data-site-id="junkdrawer"/);
const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,m=>m.slice(0,m.indexOf('>')+1));
for(const match of markup.matchAll(/(?:src|href)="([^"#?]+)"/g)){
  if(/^(https?:|data:)/.test(match[1]))continue;
  assert.ok(fs.existsSync(match[1]),'Missing HTML asset '+match[1]);
}
for(const worker of ['overhead-worker.js','overhead-celestial-worker.js']){
  const text=fs.readFileSync(worker,'utf8');
  for(const block of text.matchAll(/importScripts\(([^)]+)\)/g))for(const file of block[1].matchAll(/'([^']+)'/g))assert.ok(fs.existsSync(file[1]),worker+' missing '+file[1]);
}
const versions=[...html.matchAll(/(?:version="|data-deploy-version="|· version )(\d{4}\.\d{2}\.\d{2}\.\d+)/g)].map(x=>x[1]);
assert.equal(versions.length,3);assert.equal(new Set(versions).size,1);
const transfer=require('../preferences-transfer.js');
const site={name:'Princeton',lat:38.3,lon:-87.5,tz:'America/Chicago'};
const input={schema:'worthlookingup.preferences/1',values:{site,sites:[site],favorites:['25544'],theme:'light',settings:{minimum:'20',score:50,show:'likely',units:'metric',clock:'24'}}};
class Storage{
  constructor(){this.map=new Map([['overhead.theme','dark'],['unrelated','preserve']]);this.fail=null;}
  getItem(k){return this.map.get(k)??null;}
  setItem(k,v){if(k===this.fail)throw Error('quota');this.map.set(k,v);}
  removeItem(k){this.map.delete(k);}
}
const storage=new Storage();transfer.apply(input,storage);assert.deepEqual(transfer.snapshot(storage),input);assert.equal(storage.getItem('unrelated'),'preserve');
for(const bad of [
  {...input,schema:'other'},
  {...input,values:{site:{...site,lat:100}}},
  {...input,values:{site:{...site,tz:'invented/zone'}}},
  {...input,values:{sites:Array(13).fill(site)}},
  {...input,values:{favorites:Array(101).fill('25544')}},
  {...input,values:{'analytics.visitor_id':'must not import'}},
  {...input,values:{settings:{...input.values.settings,score:101}}}
])assert.throws(()=>transfer.apply(bad,new Storage()));
const failed=new Storage();failed.fail='overhead.favorites';assert.throws(()=>transfer.apply(input,failed));assert.equal(failed.getItem('overhead.site'),null);assert.equal(failed.getItem('overhead.theme'),'dark');
assert.equal(spawnSync(process.execPath,['scripts/build.cjs'],{stdio:'inherit'}).status,0);
for(const forbidden of ['.git','.env','tests','tools','node_modules','package.json','agents.md'])assert.ok(!fs.existsSync(path.join('dist',forbidden)),forbidden+' leaked into deployment');
assert.ok(fs.existsSync('dist/404.html'));assert.match(fs.readFileSync('dist/_redirects','utf8'),/https:\/\/www.worthlookingup.com\/\* https:\/\/worthlookingup.com\/:splat 301/);
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(['.git','node_modules','.wrangler','test-results','playwright-report'].includes(e.name))continue;
  assert.equal(e.name,e.name.toLowerCase(),'Non-lowercase path '+e.name);
  const file=path.join(dir,e.name);if(e.isDirectory())walk(file);
}}
walk('.');
console.log('PASS: unchanged scientific source, local assets and worker imports, canonical/analytics identity, lowercase paths, release versions, bounded preference validation/rollback, deployment allowlist.');
