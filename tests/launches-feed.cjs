/* Launch schedule engine regression: normalization, scheduling precision, statuses, duplicates,
   postponements, empty and stale feeds, provider failures and the honesty rules.
   Fixtures are captured provider records (tests/fixtures/launches/ll2-records.json) so CI never
   depends on provider uptime. Run: node tests/launches-feed.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/launches/ll2-records.json'),'utf8'));
const NOW=Date.parse('2026-10-15T16:30:00Z');
const feed=require('../data/launches/upcoming.json');
const REAL_SCHEMA='worthlookingup.launches/1';
let engine;
const load=(async()=>{engine=await import('../src/launches/launch-feed.mjs');})();
function response(body,{status=200,ok=true}={}){return {ok,status,json:async()=>body};}

(async()=>{
await load;
const {normalizeLaunch,precisionFor,statusFor,dedupeLaunches,buildFeed,validateFeed,assertValidFeed,feedAgeMinutes,isStale,unavailableFeed,scheduleChange,mergeFeeds,feedStats,fetchUpstreamLaunches,staleReason,effectiveScheduleDigest,publishDecision,FEED_SCHEMA,PROVIDER,MAX_LAUNCHES}=engine;

// 1. The committed artifact is a valid, non-empty, credited feed with a stable schema.
assert.equal(feed.schema,REAL_SCHEMA,'committed feed schema');
assert.ok(Array.isArray(feed.launches)&&feed.launches.length>0,'committed feed must contain launches');
assert.equal(validateFeed(feed).ok,true,'committed feed must validate: '+JSON.stringify(validateFeed(feed).errors.slice(0,3)));
assert.equal(feed.source.name,'Launch Library 2','committed feed must credit the provider');
assert.ok(Number.isFinite(Date.parse(feed.generated_at)),'committed feed needs a generation time');
assert.equal(feed.stats.count,feed.launches.length,'committed feed stats must match its list');
assert.ok(feed.launches.every(record=>typeof record.id==='string'&&record.id.length>0),'every launch needs a stable id');
assert.equal(new Set(feed.launches.map(record=>record.id)).size,feed.launches.length,'committed feed must not repeat ids');
assert.ok(feed.launches.every(record=>record.precision.exact?!!record.net:true),'a published time requires a timestamp');
assert.ok(/15 requests per hour/.test(feed.source.rights||''),'the feed must carry the provider rate limit');
assert.ok(String(feed.source.attribution||'').includes('Launch Library 2'),'the feed must carry attribution');
assert.equal(PROVIDER.api_version,'2.3.0','the engine must target the current API version');
assert.deepEqual(PROVIDER.retired_api_versions,['2.2.0'],'the retired version must be recorded');

// 2. Normalization of captured provider records.
const second=normalizeLaunch(fixture.records[0]);
assert.equal(second.id,fixture.records[0].id,'identity is the provider id');
assert.equal(second.vehicle,'Falcon 9 Block 5');
assert.equal(second.provider,'SpaceX');
assert.equal(second.site.timezone,'America/Los_Angeles');
assert.equal(second.pad.latitude,34.632);
assert.equal(second.precision.kind,'second');
assert.equal(second.precision.exact,true);
assert.equal(second.precision.countdown,true);
assert.equal(second.status.kind,'scheduled');
assert.equal(second.net,new Date(Date.parse(fixture.records[0].net)).toISOString(),'timestamps are normalized to ISO');
assert.ok(second.links.ll2.startsWith('https://'),'the provider record link is kept');
assert.ok(second.mission_description.length<=400,'descriptions are bounded');
assert.equal(second.change,null,'a first normalization has no schedule change');
// Idempotent: the normalized shape survives another pass, which is what the endpoint merge relies on.
assert.deepEqual(normalizeLaunch(second),second,'normalization must be idempotent');
assert.equal(engine.isNormalized(second),true);

// 3. Scheduling precision is never upgraded and never invented.
const byPrecision=new Map(fixture.records.map(record=>[String((record.net_precision||{}).name),record]));
const day=normalizeLaunch(byPrecision.get('Day'));
assert.equal(day.precision.kind,'day');
assert.equal(day.precision.exact,false,'a published date is not a published time');
assert.equal(day.precision.dated,true);
assert.equal(day.precision.countdown,false);
const month=normalizeLaunch(byPrecision.get('Month'));
assert.equal(month.precision.kind,'month');
assert.equal(month.precision.dated,false,'a month is a period, not a date');
assert.equal(normalizeLaunch(byPrecision.get('Quarter 4')).precision.quarter,4);
assert.equal(normalizeLaunch(byPrecision.get('Year')).precision.dated,false);
assert.equal(precisionFor({id:99,name:'Fuzzy'}).kind,'unknown','an unrecognised precision stays unknown');
assert.equal(precisionFor(null).kind,'unknown','a missing precision stays unknown');
// Coarse provider NETs land at the end of the announced period, so they must never read as a date.
assert.ok(String(byPrecision.get('Year').net).startsWith('2026-12-31'),'the captured Year record really does carry a placeholder date');
assert.equal(normalizeLaunch({...byPrecision.get('Year'),id:'placeholder'}).precision.dated,false);

// 4. Statuses come from the provider and are never guessed.
assert.equal(statusFor({id:1,name:'Go for Launch',abbrev:'Go'}).kind,'scheduled');
assert.equal(statusFor({id:2,name:'To Be Determined',abbrev:'TBD'}).kind,'unconfirmed');
assert.equal(statusFor({id:8,name:'To Be Confirmed',abbrev:'TBC'}).kind,'unconfirmed');
assert.equal(statusFor({id:6,name:'On Hold',abbrev:'Hold'}).kind,'hold');
assert.equal(statusFor({id:3,name:'Launch Successful',abbrev:'Success'}).kind,'success');
assert.equal(statusFor({id:4,name:'Launch Failure',abbrev:'Failure'}).kind,'failure');
assert.equal(statusFor({id:99,name:'Under Review',abbrev:'REV'}).kind,'unknown','an unknown status is not treated as scheduled');
assert.equal(statusFor(null).kind,'unknown');
assert.equal(normalizeLaunch(fixture.records.find(record=>record.id==='fixture-unknown-0001')).status.kind,'unknown');
assert.equal(normalizeLaunch(fixture.records.find(record=>record.id==='fixture-held-0001')).status.kind,'hold');

// 5. Duplicate schedule records collapse to one flight, keeping the most recently updated record.
const {records:unique,removed}=dedupeLaunches(fixture.records.map(normalizeLaunch));
assert.equal(removed.length,1,'exactly one duplicate flight is dropped');
assert.equal(unique.some(record=>record.id==='fixture-completed-0002'),true,'the newer duplicate is kept');
assert.equal(unique.some(record=>record.id==='fixture-completed-0001'),false,'the older duplicate is dropped');
assert.equal(new Set(unique.map(record=>record.id)).size,unique.length,'dedupe leaves no repeated ids');
const duplicated=dedupeLaunches([{...normalizeLaunch(fixture.records[0]),last_updated:'2026-10-15T10:00:00Z'},{...normalizeLaunch(fixture.records[0]),last_updated:'2026-10-15T14:00:00Z'}]);
assert.equal(duplicated.records.length,1,'a repeated id collapses to one record');
assert.equal(Date.parse(duplicated.records[0].last_updated),Date.parse('2026-10-15T14:00:00Z'),'the newest copy of a repeated id wins');

// 6. Postponements, cancellations and holds are described, never predicted.
const held=normalizeLaunch(fixture.records.find(record=>record.id==='fixture-held-0001'));
const heldAfterHold=scheduleChange(held,{...held,status:{...held.status,name:'Go for Launch',kind:'scheduled'}},NOW);
assert.equal(heldAfterHold.kind,'status','a status change is reported as a status change');
assert.equal(heldAfterHold.previous_status,'Go for Launch');
const delayed=scheduleChange({...second,net:'2026-10-16T02:00:00.000Z'},second,NOW);
assert.equal(delayed.kind,'postponed');
assert.equal(delayed.previous_net,second.net);
assert.equal(delayed.delta_minutes,Math.round((Date.parse('2026-10-16T02:00:00.000Z')-Date.parse(second.net))/60000));
const advanced=scheduleChange({...second,net:'2026-10-15T20:00:00.000Z'},second,NOW);
assert.equal(advanced.kind,'advanced');
assert.equal(scheduleChange(second,second,NOW),null,'an unchanged record has no change');
assert.equal(scheduleChange(second,null,NOW),null,'a new record has no change');
// A feed built against a previous feed carries the change, and a cancelled flight simply disappears.
const previousFeed=buildFeed({records:[second,{...held,id:'gone-1'}],now:NOW,upstream:{records:2},strict:false});
const moved=buildFeed({records:[{...second,net:'2026-10-16T02:00:00.000Z'}],previous:previousFeed,now:NOW,upstream:{records:1},strict:false});
assert.equal(moved.launches.length,1);
assert.equal(moved.launches[0].change.kind,'postponed');
assert.equal(moved.launches.find(record=>record.id==='gone-1'),undefined,'a flight the provider no longer lists is not carried forward');

// 7. Feed-level rules: validation refuses fabricated precision, empty feeds and oversized feeds.
const goodFeed=buildFeed({records:fixture.records,now:NOW,upstream:{endpoint:'x',retrieved_at:'2026-10-15T16:30:00Z',pages:1,count:fixture.records.length,records:fixture.records.length,announced_total:473}});
assert.equal(validateFeed(goodFeed).ok,true,JSON.stringify(validateFeed(goodFeed).errors.slice(0,3)));
assert.equal(goodFeed.launches.length,fixture.records.length-1,'the duplicate flight is gone from the built feed');
assert.equal(goodFeed.stats.count,goodFeed.launches.length);
assert.equal(goodFeed.stats.announced_total,473,'the announced total is carried for honest context');
assert.equal(goodFeed.stats.window_days,180,'the feed states its own window');
assert.ok(goodFeed.stats.with_published_time>=2&&goodFeed.stats.period_only>=4,'the feed counts published times and periods separately');
assert.ok(goodFeed.stats.by_precision.year>=1,'period-only launches are counted by precision');
assert.ok(goodFeed.launches.find(record=>record.pad.latitude===null),'a launch with no pad coordinates is still published');
assert.equal(validateFeed(goodFeed).warnings.length>0,true,'missing coordinates and date-only precision are reported as warnings');
// A record that claims a published time without a timestamp is rejected, not repaired.
const fabricated={...goodFeed,launches:[{...goodFeed.launches[0],net:null}]};
assert.equal(validateFeed(fabricated).ok,false,'a claimed time without a timestamp must fail validation');
assert.throws(()=>assertValidFeed(fabricated),/failed validation/);
assert.equal(validateFeed({...goodFeed,schema:'other/1'}).ok,false,'a foreign schema must fail validation');
assert.equal(validateFeed({...goodFeed,launches:[{...goodFeed.launches[0],precision:{kind:'second',exact:true}}]}).ok,true,'precision without a timestamp is allowed only when no time is claimed');
assert.equal(validateFeed({...goodFeed,launches:[{...goodFeed.launches[0],id:'same'},{...goodFeed.launches[1],id:'same'}]}).ok,false,'a repeated id must fail validation');
assert.equal(validateFeed({...goodFeed,launches:[{...goodFeed.launches[0],links:{info:[{url:'http://insecure.example'}],webcast:[]}}]}).ok,false,'a non-HTTPS link must fail validation');
assert.equal(validateFeed({...goodFeed,launches:Array.from({length:MAX_LAUNCHES+1},(_,index)=>({...goodFeed.launches[0],id:'bulk-'+index}))}).ok,false,'an oversized feed must fail validation');
assert.equal(validateFeed({...goodFeed,source:null}).ok,false,'a feed without source credit must fail validation');

// 8. An empty schedule is a real answer, but an unavailable feed is never presented as one.
const empty=buildFeed({records:[],now:NOW,upstream:{},strict:false});
assert.equal(empty.launches.length,0,'an empty schedule has no launches');
assert.equal(empty.stats.count,0);
assert.equal(validateFeed(empty).ok,true,'an empty but well-formed feed validates');
assert.equal(validateFeed(empty).warnings.some(warning=>/stats/.test(warning)),false,'an empty feed reports no stats mismatch');
const missing=unavailableFeed({now:NOW,reason:'the provider could not be reached'});
assert.equal(missing.available,false);
assert.equal(missing.launches.length,0);
assert.match(missing.notice,/not an empty schedule/,'an unavailable feed must say it is missing, not empty');
assert.equal(validateFeed(missing).ok,true,'an unavailable feed is a valid response');
assert.match(staleReason({code:'rate-limited'}),/rate limit/);
assert.match(staleReason({code:'upstream-error'}),/server error/);
assert.match(staleReason({code:'upstream-unreachable'}),/could not be reached/);
assert.match(staleReason({code:'upstream-malformed'}),/unusable response/);
assert.match(staleReason(new Error('anything')),/could not be refreshed/);

// 9. Staleness is computed from the published generation time.
assert.equal(Math.round(feedAgeMinutes(goodFeed,Date.parse(goodFeed.generated_at)+45*60000)),45);
assert.equal(isStale(goodFeed,Date.parse(goodFeed.generated_at)+60*60000),false,'an hour-old feed is not stale');
assert.equal(isStale(goodFeed,Date.parse(goodFeed.generated_at)+181*60000),true,'past the declared stale window the feed is stale');
assert.equal(isStale(goodFeed,Date.parse(goodFeed.generated_at)+179*60000),false,'just inside the declared stale window');
assert.equal(isStale({generated_at:null},NOW),true,'a feed with no generation time counts as stale');
assert.equal(isStale(missing,NOW),true,'an unavailable feed counts as stale');
assert.equal(feedAgeMinutes({generated_at:null},NOW),null);
assert.equal(feedStats([]).nearest_net,null);


// 10. The upstream read is bounded, windowed and ordered, and its failures are coded.
function pageOf(records,next=null,count=records.length){return {count,next,results:records};}
function stubFetch(handler){const calls=[];const impl=async url=>{calls.push(String(url));return handler(String(url),calls.length);};impl.calls=calls;return impl;}
const stub=stubFetch(url=>String(url).includes("/upcoming/")?response({count:473,results:[]}):response(pageOf(fixture.records.slice(0,3),null,3)));
const read=await fetchUpstreamLaunches({fetchImpl:stub,now:NOW,maxPages:3});
assert.equal(read.records.length,3,"the upstream records are returned as-is");
assert.equal(read.source.pages,1);
assert.equal(read.source.count,3,"the upstream window count is recorded");
assert.equal(read.source.announced_total,473,"the announced total is read from one tiny request");
assert.ok(/^[0-9a-f]{64}$/.test(read.source.sha256),"the upstream payload is hashed");
const firstUrl=decodeURIComponent(stub.calls[0]);
assert.match(firstUrl,/ordering=net/,"the upstream window is ordered by NET so the near term is never missed");
assert.match(firstUrl,/mode=normal/);
assert.match(firstUrl,/limit=100/);
assert.match(firstUrl,new RegExp("net__gte="+new Date(NOW-36*3600000).toISOString().replace(/[:.]/g,"\$&").slice(0,19)));
assert.match(firstUrl,/net__lte=2027-04-13/,"a 180-day window ends in April 2027");
assert.match(firstUrl,/ll\.thespacedevs\.com\/2\.3\.0\//,"the current API version is used");

// Pagination follows `next`, and the page cap is respected even when the provider keeps offering more.
const many=stubFetch(url=>String(url).includes("/upcoming/")?response({count:473,results:[]}):response(pageOf([fixture.records[0]],"https://ll.thespacedevs.com/2.3.0/launches/?offset=100",500)));
const capped=await fetchUpstreamLaunches({fetchImpl:many,now:NOW,maxPages:2});
assert.equal(capped.source.pages,2,"pagination stops at the page cap");
assert.equal(many.calls.length,3,"two launch pages plus the announced-total request");
assert.ok(many.calls.filter(url=>!url.includes("/upcoming/")).length===2,"only two launch pages were requested");

// Every upstream failure is coded so the caller can describe it honestly.
async function failureOf(handler){try{await fetchUpstreamLaunches({fetchImpl:stubFetch(handler),now:NOW,maxPages:1});return null;}catch(error){return error.code;}}
assert.equal(await failureOf(()=>response({}, {status:429,ok:false})),"rate-limited");
assert.equal(await failureOf(()=>response({}, {status:503,ok:false})),"upstream-error");
assert.equal(await failureOf(()=>response({}, {status:404,ok:false})),"upstream-rejected");
assert.equal(await failureOf(()=>response({results:null})),"upstream-malformed");
assert.equal(await failureOf(()=>{throw new Error("socket hang up");}),"upstream-unreachable");
const noTotal=await fetchUpstreamLaunches({fetchImpl:stubFetch(url=>String(url).includes("/upcoming/")?response({}, {status:500,ok:false}):response(pageOf(fixture.records.slice(0,2)))),now:NOW,maxPages:1});
assert.equal(noTotal.source.announced_total,null,"a failed announced-total request is reported as unknown, not guessed");
assert.equal(noTotal.records.length,2,"a failed announced-total request does not lose the schedule");

// 11. A bounded refresh merges into the previous feed without deleting the far-future calendar.
const previousFeedForMerge=buildFeed({records:fixture.records,now:NOW,upstream:{records:fixture.records.length},strict:false});
const merged=mergeFeeds([normalizeLaunch(fixture.records[0])],previousFeedForMerge,{now:NOW});
assert.equal(merged.fresh,1,"the refreshed record is counted as fresh");
assert.ok(merged.records.length>1,"records the bounded refresh did not return are kept");
assert.equal(merged.records.some(record=>record.id==="fixture-completed-0002"),false,"a completed flight is not resurrected");
assert.equal(merged.records.some(record=>record.id==="fixture-held-0001"),true,"an active held flight survives a bounded refresh");
const stalePast={launches:[{...normalizeLaunch(fixture.records[0]),id:"long-gone",net:"2020-01-01T00:00:00.000Z",status:{...second.status,kind:"unconfirmed"}}]};
assert.equal(mergeFeeds([],stalePast,{now:NOW}).records.length,0,"a long-past schedule is not resurrected from a previous feed");
assert.equal(mergeFeeds([],{launches:[]},{now:NOW}).records.length,0,"merging an empty previous feed yields nothing");
assert.equal(mergeFeeds([],null,{now:NOW}).records.length,0,"merging without a previous feed yields nothing");

// 12. Freshness compared against effective schedule content.
//     The freshness timestamp is volatile by design, so a naive comparison would republish every hour
//     even when the schedule did not move. These checks pin both halves of that rule: an otherwise
//     identical feed is recognised as unchanged, and any reader-visible difference is not.
const digestBase=buildFeed({records:fixture.records,now:NOW,upstream:{records:fixture.records.length},strict:false});
const laterFreshness={...digestBase,generated_at:new Date(NOW+3600000).toISOString(),
  source:{...digestBase.source,retrieved_at:new Date(NOW+3600000).toISOString(),sha256:'f'.repeat(64),pages:3}};
assert.equal(effectiveScheduleDigest(laterFreshness),effectiveScheduleDigest(digestBase),'freshness, provenance and page counts are not schedule content');
assert.equal(effectiveScheduleDigest({...digestBase,launches:digestBase.launches.slice().reverse()}),effectiveScheduleDigest(digestBase),'record order is not schedule content');
const statusMoved={...digestBase,launches:digestBase.launches.map(record=>record.id===digestBase.launches[0].id?{...record,status:{...record.status,kind:'success',name:'Launch Successful'}}:record)};
assert.notEqual(effectiveScheduleDigest(statusMoved),effectiveScheduleDigest(digestBase),'a status change is schedule content');
const netMoved={...digestBase,launches:digestBase.launches.map(record=>record.id===digestBase.launches[0].id?{...record,net:'2026-11-01T00:00:00.000Z'}:record)};
assert.notEqual(effectiveScheduleDigest(netMoved),effectiveScheduleDigest(digestBase),'a moved schedule is schedule content');
assert.equal(effectiveScheduleDigest(null),null);assert.equal(effectiveScheduleDigest({}),null,'a feed without a launch list has no digest');
// The publish decision: changed content always publishes; unchanged content defers only while the
// published copy is comfortably inside the staleness horizon, and publishes once it is not.
const changedDecision=publishDecision({previous:digestBase,candidate:netMoved,now:NOW,freshnessDeadlineMinutes:120});
assert.equal(changedDecision.publish,true);assert.equal(changedDecision.contentChanged,true);
const freshUnchanged=publishDecision({previous:digestBase,candidate:laterFreshness,now:NOW+3600000,freshnessDeadlineMinutes:120});
assert.equal(freshUnchanged.publish,false,'an unchanged schedule inside the deadline is not republished');
assert.equal(freshUnchanged.contentChanged,false);
const dueUnchanged=publishDecision({previous:digestBase,candidate:laterFreshness,now:NOW+120*60000,freshnessDeadlineMinutes:120});
assert.equal(dueUnchanged.publish,true,'an unchanged schedule at the deadline is republished for freshness');
assert.equal(dueUnchanged.contentChanged,false);
const overdueUnchanged=publishDecision({previous:digestBase,candidate:laterFreshness,now:NOW+240*60000,freshnessDeadlineMinutes:120});
assert.equal(overdueUnchanged.publish,true,'an unchanged schedule past the deadline is republished');
assert.equal(publishDecision({previous:null,candidate:digestBase,now:NOW}).publish,true,'the first publication always writes');
assert.equal(publishDecision({previous:digestBase,candidate:null,now:NOW}).publish,true,'no candidate always writes');
assert.equal(publishDecision({previous:{schema:FEED_SCHEMA,generated_at:'not a date',launches:[]},candidate:digestBase,now:NOW}).publish,true,'an unreadable previous generation time always publishes');
assert.equal(publishDecision({previous:digestBase,candidate:laterFreshness,now:NOW+30*60000}).publish,false,'the default deadline is 120 minutes');
assert.equal(publishDecision({previous:digestBase,candidate:laterFreshness,now:NOW+30*60000,freshnessDeadlineMinutes:180}).publish,false,'a longer deadline is still bounded by the staleness horizon in the caller');

console.log('PASS: launch feed artifact, normalization, precision, statuses, duplicates, schedule changes, validation, empty/stale/unavailable feeds, provider failure codes and the effective-content publication rule ('+feed.launches.length+' committed launches).');
})().catch(error=>{console.error(error);process.exit(1);});
