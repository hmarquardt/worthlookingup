/* Pages Worker behaviour: host canonicalization regression plus the launch feed endpoint.
   The Worker is imported exactly as it is deployed (dist/_worker.js is a byte copy of pages-worker.mjs),
   so this exercises the real routing, the real cache/KV/stale policy and the real feed handler.
   The provider and the edge cache are replaced with deterministic stand-ins; the committed feed and
   the captured provider fixture supply the data.
   Run: node tests/launches-worker.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/launches/ll2-records.json'),'utf8'));
const committed=JSON.parse(fs.readFileSync('data/launches/upcoming.json','utf8'));
let worker;
const load=(async()=>{worker=(await import('../pages-worker.mjs')).default;})();

// A minimal in-memory edge cache with the Cache API surface the Worker uses.
function fakeCache(){const store=new Map();return {store,async match(request){const hit=store.get(String(request.url||request));return hit===undefined?undefined:new Response(hit);},async put(request,response){store.set(String(request.url||request),await response.text());}};}
function fakeKv(initial=null){const store=new Map();if(initial)store.set('upcoming',initial);return {store,async get(key,options){const value=store.get(key);if(value===undefined)return null;return options&&options.type==='json'?JSON.parse(value):value;},async put(key,value){store.set(key,value);}};}
function assetsOf(files){return {fetch:async request=>{const name=new URL(String(request.url||request)).pathname;if(files[name]!==undefined)return new Response(files[name],{status:200,headers:{'Content-Type':'application/json'}});return new Response('missing',{status:404});}};}
function assetsWithFeed(feed=committed){return assetsOf({'/data/launches/upcoming.json':JSON.stringify(feed)});}
function upstreamStub({records=fixture.records,status=200,fail=null,announced=473}={}){
  const calls=[];
  const impl=async url=>{
    const text=String(url);calls.push(text);
    if(fail)throw fail;
    if(text.includes('/upcoming/'))return new Response(JSON.stringify({count:announced,results:[]}),{status:200});
    if(status!==200)return new Response('{}',{status});
    return new Response(JSON.stringify({count:records.length,next:null,results:records}),{status:200});
  };
  impl.calls=calls;
  return impl;
}
const aged=(minutesAgo,base=committed)=>({...base,generated_at:new Date(Date.now()-minutesAgo*60000).toISOString()});
const get=(url,env,method='GET')=>worker.fetch(new Request(url,{method}),env);

(async()=>{
await load;

// 1. Host canonicalization is unchanged: the deployment still owns www, the legacy path and HTTP.
const redirect=await get('https://www.worthlookingup.com/tonight?x=1',{ASSETS:assetsWithFeed()});
assert.equal(redirect.status,301,'www must redirect permanently');
assert.equal(redirect.headers.get('location'),'https://worthlookingup.com/tonight?x=1','the redirect preserves path and query');
const legacy=await get('https://worthlookingup.com/overhead.html?verify=1&value=a%2Fb',{ASSETS:assetsWithFeed()});
assert.equal(legacy.status,301);
assert.equal(legacy.headers.get('location'),'https://worthlookingup.com/?verify=1&value=a%2Fb','the legacy path keeps its query');
const insecure=await get('http://worthlookingup.com/',{ASSETS:assetsWithFeed()});
assert.equal(insecure.status,301);
assert.equal(insecure.headers.get('location'),'https://worthlookingup.com/');
const ordinary=await get('https://worthlookingup.com/robots.txt',{ASSETS:{fetch:async()=>new Response('ok',{status:200})}});
assert.equal(ordinary.status,200,'ordinary paths still delegate to ASSETS');
assert.equal(await ordinary.text(),'ok');
const missing=await get('https://worthlookingup.com/nope.js',{ASSETS:{fetch:async()=>new Response('missing',{status:404})}});
assert.equal(missing.status,404,'missing assets still return the real 404');
const wwwLegacy=await get('https://www.worthlookingup.com/overhead.html?a=1&a=2&empty=',{ASSETS:assetsWithFeed()});
assert.equal(wwwLegacy.headers.get('location'),'https://worthlookingup.com/?a=1&a=2&empty=','www legacy requests land on the canonical root with repeated and empty query values intact');

// 2. The feed endpoint never calls the provider for a visitor when a usable copy exists, and it always
//    reports where the copy came from, how old it is and whether it is stale.
const realFetch=globalThis.fetch,realCaches=globalThis.caches;
function serve({cache=new fakeCache(),assets=assetsWithFeed(),fetchImpl=null}={}){
  const stub=fetchImpl||upstreamStub({});
  globalThis.fetch=stub;
  globalThis.caches={default:cache};
  return {cache,assets,stub};
}
const feedUrl='https://worthlookingup.com/api/launches.json';
const fresh=serve({assets:assetsWithFeed(aged(5)),fetchImpl:upstreamStub({status:500})});
const freshResponse=await get(feedUrl,{ASSETS:fresh.assets});
assert.equal(freshResponse.status,200);
assert.equal(freshResponse.headers.get('X-WLU-Launch-Feed'),'cached');
assert.match(freshResponse.headers.get('Cache-Control'),/max-age=900/,'a fresh copy is cached at the edge for the refresh interval');
assert.equal(fresh.stub.calls.length,0,'a visitor never triggers an upstream request while the copy is fresh');
const freshBody=await freshResponse.json();
assert.equal(freshBody.available,true);
assert.equal(freshBody.served_from,'committed-feed');
assert.equal(freshBody.stale,false);
assert.equal(freshBody.stale_reason,null);
assert.equal(freshBody.source.name,'Launch Library 2','provenance travels with the served feed');
assert.ok(Number.isFinite(Date.parse(freshBody.generated_at)),'the served feed carries a freshness timestamp');
assert.ok(Number.isFinite(Date.parse(freshBody.served_at)),'the response records when it was served');
assert.ok(Number.isFinite(Number(freshResponse.headers.get('X-WLU-Launch-Feed-Age'))),'the response reports the feed age');
assert.equal(freshBody.launches.length,committed.launches.length,'the committed schedule is served intact');

// 3. A stale copy with a failing provider is served as last-good, with the failure named.
const serverError=serve({assets:assetsWithFeed(aged(200)),fetchImpl:upstreamStub({status:500})});
const degraded=await get(feedUrl,{ASSETS:serverError.assets});
assert.equal(degraded.headers.get('X-WLU-Launch-Feed'),'last-good');
assert.match(degraded.headers.get('Cache-Control'),/max-age=120/,'a degraded copy is re-checked sooner');
const degradedBody=await degraded.json();
assert.equal(degradedBody.stale,true);
assert.match(degradedBody.stale_reason,/server error/);
assert.equal(degradedBody.launches.length,committed.launches.length,'a degraded response still serves the last good schedule');
const rateLimited=serve({assets:assetsWithFeed(aged(200)),fetchImpl:upstreamStub({status:429})});
const throttled=await (await get(feedUrl,{ASSETS:rateLimited.assets})).json();
assert.match(throttled.stale_reason,/rate limit/);
assert.equal(throttled.launches.length>0,true,'a rate limit never empties the calendar');
const unreachable=serve({assets:assetsWithFeed(aged(200)),fetchImpl:upstreamStub({fail:new Error('socket hang up')})});
const offline=await (await get(feedUrl,{ASSETS:unreachable.assets})).json();
assert.match(offline.stale_reason,/could not be reached/);
const emptyUpstream=serve({assets:assetsWithFeed(aged(200)),fetchImpl:upstreamStub({records:[]})});
const noRecords=await (await get(feedUrl,{ASSETS:emptyUpstream.assets})).json();
assert.equal(noRecords.launches.length,committed.launches.length,'an upstream response with no records keeps the previous schedule');
assert.match(noRecords.stale_reason,/no launch records/,'an empty upstream page is reported as a provider failure, not as an empty schedule');
assert.equal(noRecords.available,true);

// 4. With nothing cached anywhere and a failing provider the endpoint says so, instead of showing an
//    empty calendar that would look like a real answer.
const nothing=serve({assets:assetsOf({}),fetchImpl:upstreamStub({status:500})});
const unavailable=await get(feedUrl,{ASSETS:nothing.assets});
assert.equal(unavailable.status,200,'the endpoint still answers, so the page can explain itself');
assert.equal(unavailable.headers.get('X-WLU-Launch-Feed'),'unavailable');
const unavailableBody=await unavailable.json();
assert.equal(unavailableBody.available,false);
assert.equal(unavailableBody.launches.length,0);
assert.match(unavailableBody.notice,/not an empty schedule/,'a missing feed must be described as missing');
assert.equal(unavailableBody.schema,'worthlookingup.launches/1');
assert.equal(unavailableBody.source.name,'Launch Library 2','even an unavailable response credits the provider it could not read');


// 5. When the copy is older than the refresh interval the endpoint refreshes once, merges, stores in
//    KV and the edge cache, and then serves the stored copy without asking the provider again.
const kv=fakeKv();
const refresh=serve({assets:assetsWithFeed(aged(200)),fetchImpl:upstreamStub({records:fixture.records,announced:473})});
const refreshed=await get(feedUrl,{ASSETS:refresh.assets,LAUNCHES:kv});
assert.equal(refreshed.headers.get('X-WLU-Launch-Feed'),'upstream');
const refreshedBody=await refreshed.json();
assert.equal(refreshedBody.stale,false,'a successful refresh is not stale');
assert.equal(refreshedBody.served_from,'committed-feed','the response records which copy it was merged into');
assert.ok(Date.now()-Date.parse(refreshedBody.generated_at)<60000,'a refreshed feed is generated now');
assert.ok(refreshedBody.launches.length>=committed.launches.length,'the refresh merges new flights into the published calendar instead of replacing it');
assert.ok(refreshedBody.launches.some(record=>record.id==='fixture-held-0001'),'a new upstream flight appears in the merged feed');
assert.ok(refreshedBody.launches.some(record=>record.id===committed.launches[committed.launches.length-1].id),'the far-future part of the calendar survives a bounded refresh');
assert.equal(new Set(refreshedBody.launches.map(record=>record.id)).size,refreshedBody.launches.length,'the merged feed contains no repeated id');
assert.equal(refreshedBody.stats.announced_total,473,'the announced total is carried into the feed');
assert.equal(refresh.stub.calls.length,2,'one bounded launch page plus one announced-total request');
assert.equal(kv.store.has('upcoming'),true,'a successful refresh is written to KV when the binding exists');
assert.ok(JSON.parse(kv.store.get('upcoming')).stored_at,'the KV copy records when it was stored');
const secondVisit=await get(feedUrl,{ASSETS:refresh.assets,LAUNCHES:kv});
assert.equal(secondVisit.headers.get('X-WLU-Launch-Feed'),'cached','the second visitor is served from the edge cache');
assert.equal(refresh.stub.calls.length,2,'the second visitor causes no further upstream request');
assert.equal((await secondVisit.json()).served_from,'edge-cache');
// A cache-busting query is ignored, so every visitor shares one cached feed.
const busted=await get(feedUrl+'?refresh=12345',{ASSETS:refresh.assets,LAUNCHES:kv});
assert.equal(busted.headers.get('X-WLU-Launch-Feed'),'cached');
assert.equal(refresh.stub.calls.length,2,'a cache-busting query does not reach the provider');

// 6. KV is preferred when it holds a newer copy, and an unusable KV copy is ignored.
const kvNewer=fakeKv(JSON.stringify(aged(1)));
const fromKv=serve({assets:assetsWithFeed(aged(5))});
const kvResponse=await get(feedUrl,{ASSETS:fromKv.assets,LAUNCHES:kvNewer});
assert.equal((await kvResponse.json()).served_from,'kv','a newer KV copy wins over the committed file');
const kvBroken=fakeKv(JSON.stringify({schema:'something-else/1'}));
const ignoredKv=serve({assets:assetsWithFeed(aged(5))});
const ignoredResponse=await get(feedUrl,{ASSETS:ignoredKv.assets,LAUNCHES:kvBroken});
assert.equal((await ignoredResponse.json()).served_from,'committed-feed','an unusable KV copy is ignored, not served');
const kvThrows={get:async()=>{throw new Error('kv unavailable');},put:async()=>{throw new Error('kv unavailable');}};
const brokenKv=serve({assets:assetsWithFeed(aged(5))});
const brokenKvResponse=await get(feedUrl,{ASSETS:brokenKv.assets,LAUNCHES:kvThrows});
assert.equal((await brokenKvResponse.json()).served_from,'committed-feed','a failing KV binding does not break the endpoint');
assert.equal(brokenKvResponse.status,200);

// 7. A corrupt or foreign committed feed is treated as missing and refreshed, never served.
const corrupt=serve({assets:assetsOf({'/data/launches/upcoming.json':'{"schema":"worthlookingup.launches/1","available":true,"generated_at":"nope","launches":[]}'}),fetchImpl:upstreamStub({records:fixture.records})});
const recovered=await get(feedUrl,{ASSETS:corrupt.assets});
assert.equal(recovered.headers.get('X-WLU-Launch-Feed'),'upstream','an unusable committed feed is replaced by a real refresh');
assert.equal((await recovered.json()).available,true);
const noAssets=serve({assets:undefined,fetchImpl:upstreamStub({records:fixture.records})});
const noAssetsResponse=await get(feedUrl,{});
assert.equal(noAssetsResponse.status,200,'a missing ASSETS binding still produces a response');
assert.equal((await noAssetsResponse.json()).available,true);

// 8. Method handling and the client contract: the served feed is exactly what the browser module reads.
const method=await get(feedUrl,{ASSETS:assetsWithFeed()},'POST');
assert.equal(method.status,405);
assert.equal(method.headers.get('Allow'),'GET, HEAD');
globalThis.fetch=upstreamStub({});
globalThis.caches={default:fakeCache()};
const contract=await (await get(feedUrl,{ASSETS:assetsWithFeed(aged(5))})).json();
assert.equal(contract.schema,'worthlookingup.launches/1');
for(const record of contract.launches){
  assert.equal(typeof record.id,'string','every served launch has a stable id');
  assert.ok(record.precision&&typeof record.precision.kind==='string','every served launch states its precision');
  assert.ok(record.status&&typeof record.status.kind==='string','every served launch states its status');
  assert.equal(Object.hasOwn(record,'visibility'),false,'the feed never carries a visibility field');
  assert.equal(Object.hasOwn(record,'probability'),false,'the feed never carries a probability field');
  assert.equal(Object.hasOwn(record,'azimuth'),false,'the feed never carries a trajectory field');
}
assert.equal(JSON.stringify(contract).includes('visibility'),false,'no visibility claim anywhere in the served feed');
globalThis.fetch=realFetch;
globalThis.caches=realCaches;

console.log('PASS: worker host canonicalization, legacy path, ASSETS delegation and real 404s.');
console.log('PASS: worker canonicalization, launch feed endpoint serving from edge cache/KV/committed feed, bounded refresh and merge, KV failure tolerance, stale degradation with named reasons, unavailable responses, method handling and the no-visibility client contract.');
})().catch(error=>{console.error(error);process.exit(1);});
