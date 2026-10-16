/* Launch calendar interpretation regression: planning windows, local time and DST, approximate
   versus exact schedules, countdown eligibility, proximity and twilight context, feed freshness, and
   the rule that no visibility, bearing, elevation, duration or probability is ever produced.
   Run: node tests/launches-relevance.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const L=require('../overhead-launches.js');
const feed=require('../data/launches/upcoming.json');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/launches/ll2-records.json'),'utf8'));
const site={name:'Princeton, Indiana',lat:38.3553,lon:-87.5675,tz:'America/Chicago'};
const NOW=Date.parse('2026-10-15T16:30:00Z');
function record({id='r',net='2026-10-15T23:57:05.000Z',precision={kind:'second',exact:true,dated:true,countdown:true,name:'Second'},status={id:1,name:'Go for Launch',kind:'scheduled'},pad={name:'Space Launch Complex 40',latitude:28.56194122,longitude:-80.57735736},sitetimezone='America/New_York',site='Cape Canaveral SFS, FL, USA'}={}){
  return {id,name:'Test | '+id,mission:id,vehicle:'Falcon 9 Block 5',provider:'SpaceX',site:{name:site,timezone:sitetimezone,country:'United States of America'},pad,status,net,precision,window:{start:null,end:null},last_updated:'2026-10-15T12:00:00.000Z',links:{ll2:null,info:[],webcast:[]},change:null};
}
const EXACT=record({id:'exact-tonight'});
const DATE_ONLY=record({id:'date-only',net:'2026-10-19T00:00:00.000Z',precision:{kind:'day',exact:false,dated:true,countdown:false,name:'Day'}});
const MONTH_ONLY=record({id:'month-only',net:'2026-10-31T00:00:00.000Z',precision:{kind:'month',exact:false,dated:false,countdown:false,name:'Month'}});
const QUARTER_ONLY=record({id:'quarter-only',net:'2026-12-31T00:00:00.000Z',precision:{kind:'quarter',exact:false,dated:false,countdown:false,name:'Quarter 4',quarter:4}});
const YEAR_ONLY=record({id:'year-only',net:'2027-12-31T00:00:00.000Z',precision:{kind:'year',exact:false,dated:false,countdown:false,name:'Year'}});
const FAR_YEAR=record({id:'far-year',net:'2028-12-31T00:00:00.000Z',precision:{kind:'year',exact:false,dated:false,countdown:false,name:'Year'}});
const NO_PRECISION=record({id:'no-precision',net:'2026-10-20T00:00:00.000Z',precision:{kind:'unknown',exact:false,dated:false,countdown:false,name:'Fuzzy'}});
const DONE=record({id:'done',status:{id:3,name:'Launch Successful',kind:'success'}});
const synthetic={schema:'worthlookingup.launches/1',available:true,generated_at:new Date(NOW).toISOString(),stale_after_minutes:180,stale:false,stale_reason:null,source:{name:'Launch Library 2',publisher:'The Space Devs',api_version:'2.3.0',retrieved_at:new Date(NOW).toISOString(),sha256:'ab'.repeat(32),attribution:'Launch data: The Space Devs Launch Library 2',rights:'Free unauthenticated access is limited to 15 requests per hour.'},stats:{count:6},launches:[EXACT,DATE_ONLY,MONTH_ONLY,QUARTER_ONLY,YEAR_ONLY,FAR_YEAR,NO_PRECISION,DONE]};

// 1. Feed shape validation: a foreign, empty or unavailable payload is never treated as a schedule.
assert.equal(L.validateFeed(feed).ok,true,'the committed feed must validate in the browser module');
assert.equal(L.validateFeed(feed).available,true);
assert.equal(L.validateFeed(synthetic).ok,true);
assert.equal(L.validateFeed(null).ok,false,'a missing feed is rejected');
assert.equal(L.validateFeed({schema:'worthlookingup.launches/2',available:true,generated_at:new Date(NOW).toISOString(),launches:[]}).ok,false,'a foreign schema is rejected');
assert.equal(L.validateFeed({schema:L.SCHEMA,available:true,generated_at:'not a time',launches:[]}).ok,false,'a feed with no usable generation time is rejected');
assert.equal(L.validateFeed({schema:L.SCHEMA,available:true,generated_at:new Date(NOW).toISOString()}).ok,false,'a feed with no launch list is rejected');
const missing=L.validateFeed({schema:L.SCHEMA,available:false,notice:'the provider could not be reached',stale_reason:'the provider could not be reached'});
assert.equal(missing.ok,true,'an unavailable feed is a valid response');
assert.equal(missing.available,false);
assert.match(missing.notice,/could not be reached/);
assert.equal(L.SCHEMA,'worthlookingup.launches/1','the module must agree with the engine schema');

// 2. Planning windows: tonight, seven days and ninety days, all in local time.
const tonight={start:Date.parse('2026-10-15T23:00:00Z'),end:Date.parse('2026-10-16T11:00:00Z')};
const week={start:NOW,end:NOW+7*86400000};
const ninety={start:NOW,end:NOW+90*86400000};
const tonightSel=L.selectForWindow(synthetic,{...tonight,horizon:'tonight',now:NOW});
assert.deepEqual(tonightSel.dated.map(entry=>entry.record.id),['exact-tonight'],'only a launch with a published time inside the night window belongs to tonight');
assert.equal(tonightSel.dated[0].dateOnly,false);
assert.equal(tonightSel.completed,1,'a completed launch is counted, not shown');
assert.equal(tonightSel.periods.some(entry=>entry.record.id==='month-only'),true,'a month-only launch that contains tonight is reported separately');
assert.equal(tonightSel.dated.some(entry=>entry.record.id==='date-only'),false,'a date without a time is never placed in a night window');
const weekSel=L.selectForWindow(synthetic,{...week,horizon:'week',now:NOW});
assert.deepEqual(weekSel.dated.map(entry=>entry.record.id),['exact-tonight','date-only'],'the seven-day window adds the published-only date');
assert.equal(weekSel.dated[1].dateOnly,true,'a published-only date is flagged so no time can be shown for it');
const ninetySel=L.selectForWindow(synthetic,{...ninety,horizon:'extended',now:NOW});
assert.equal(ninetySel.dated.some(entry=>entry.record.id==='quarter-only'),false,'a quarter is never treated as a date');
assert.equal(ninetySel.periods.some(entry=>entry.record.id==='quarter-only'),true,'a quarter that overlaps the window is reported as a period');
assert.equal(ninetySel.periods.some(entry=>entry.record.id==='year-only'),true,'a year whose period reaches into the window is reported as a period');
assert.equal(ninetySel.periods.some(entry=>entry.record.id==='far-year'),false,'a period entirely beyond the window is not reported');
assert.equal(ninetySel.periods.some(entry=>entry.record.id==='no-precision'),true,'a launch whose precision this page does not recognise is listed as undated instead of disappearing');
assert.equal(ninetySel.dated.some(entry=>entry.record.id==='no-precision'),false,'an unrecognised precision is never treated as a date');
assert.equal(L.selectForWindow({launches:[]},{...week,now:NOW}).dated.length,0,'an empty schedule produces an empty selection');
assert.equal(L.selectForWindow(null,{...week,now:NOW}).dated.length,0,'a missing feed produces an empty selection');
assert.equal(L.windowLabel('tonight'),'tonight');
assert.equal(L.windowLabel('week'),'the next 7 days');
assert.equal(L.windowLabel('extended'),'the next 90 days');

// 3. A period is described as a period. It is never converted into a date.
assert.equal(L.precisionOf(EXACT).exact,true);
assert.equal(L.precisionOf(EXACT).countdown,true);
assert.equal(L.precisionOf(DATE_ONLY).exact,false);
assert.equal(L.precisionOf(DATE_ONLY).dated,true);
assert.equal(L.precisionOf(MONTH_ONLY).dated,false);
assert.match(L.periodLabel(MONTH_ONLY),/^October 2026 \(month announced, no day published\)$/);
assert.match(L.periodLabel(QUARTER_ONLY),/^Q4 2026 \(quarter announced, no day published\)$/);
assert.match(L.periodLabel(YEAR_ONLY),/^2027 \(year announced, no day published\)$/);
assert.match(L.periodLabel(DATE_ONLY),/^19 October 2026 \(UTC date; no time published\)$/);
assert.equal(L.periodLabel(record({precision:{kind:'unknown',exact:false,dated:false,countdown:false}})),'no date published yet');
// A year-only record carries 31 December in the provider payload; the label must not repeat it.
assert.equal(/31/.test(L.periodLabel(YEAR_ONLY)),false,'a placeholder day must never appear in a period label');
assert.equal(/December/.test(L.periodLabel(YEAR_ONLY)),false);
const yearRange=L.periodRange(YEAR_ONLY);
assert.equal(new Date(yearRange.start).toISOString().slice(0,10),'2027-01-01');
assert.equal(new Date(yearRange.end).toISOString().slice(0,10),'2027-12-31');
assert.equal(L.periodRange(EXACT).start,Date.parse(EXACT.net),'an exact schedule has a point period');
assert.equal(L.periodRange(record({precision:{kind:'unknown',exact:false,dated:false,countdown:false},net:'2027-01-01T00:00:00.000Z'})),null,'an unknown precision has no period');

// 4. Local time and daylight saving, for the reader and for the launch site.
assert.equal(L.formatTime(Date.parse('2026-10-15T23:57:05Z'),'America/Chicago','24'),'18:57');
assert.equal(L.formatTime(Date.parse('2026-10-15T23:57:05Z'),'America/New_York','24'),'19:57');
assert.equal(L.formatTime(Date.parse('2026-10-15T23:57:05Z'),'Asia/Kolkata','24'),'05:27');
assert.equal(L.formatTime(Date.parse('2026-10-15T23:57:05Z'),'Pacific/Auckland','24'),'12:57');
// Daylight saving ends in New York on 1 November 2026: the same UTC time shifts by an hour.
assert.equal(L.formatTime(Date.parse('2026-10-30T05:30:00Z'),'America/New_York','24'),'01:30');
assert.equal(L.formatTime(Date.parse('2026-11-03T05:30:00Z'),'America/New_York','24'),'00:30');
assert.equal(L.formatLocal(Date.parse('2026-11-01T05:30:00Z'),'America/New_York','12'),'Sun, Nov 1, 1:30 AM');
assert.equal(L.formatLocal(Date.parse('2026-11-01T06:30:00Z'),'America/New_York','12'),'Sun, Nov 1, 1:30 AM');
assert.equal(L.formatLocal(Date.parse('2026-11-01T06:30:00Z'),'America/New_York','24'),'Sun, Nov 1, 01:30');
assert.equal(L.formatTime(Date.parse('2026-10-15T23:57:05Z'),'America/Chicago','12'),'6:57 PM');
assert.equal(L.dateKeyFor(record({net:'2026-11-01T05:30:00.000Z'}),'America/New_York'),'2026-11-01','a pre-change time files under the local day');
assert.equal(L.dateKeyFor(record({net:'2026-11-01T06:30:00.000Z'}),'America/New_York'),'2026-11-01','a post-change time files under the same local day');
assert.equal(L.dateKeyFor(record({net:'2026-11-02T04:30:00.000Z'}),'America/New_York'),'2026-11-01','late evening stays on the previous local day');
assert.equal(L.dateKeyFor(record({id:'d',net:'2026-10-21T00:00:00.000Z',precision:{kind:'day',exact:false,dated:true,countdown:false}}),'America/Chicago'),'2026-10-21','a published-only date files under its UTC date, because that is the date the provider published');
assert.equal(L.formatLocal(NaN,'America/Chicago','24'),'\u2014','an unusable timestamp is shown as a dash');
assert.equal(L.formatTime(Date.parse('2026-10-15T23:57:05Z'),'not/a-zone','24').endsWith('UTC'),true,'an unknown timezone degrades to UTC instead of guessing');


// 5. Distance to the launch site is real geometry, and it is never treated as visibility.
assert.equal(L.distanceKm({lat:38.3553,lon:-87.5675},{latitude:38.3553,longitude:-87.5675}),0);
assert.equal(Math.abs(L.distanceKm({lat:38.3553,lon:-87.5675},{latitude:28.56194122,longitude:-80.57735736})-1266)<=2,true,'Princeton to SLC-40 is about 1266 km');
assert.ok(L.distanceKm({lat:38.3553,lon:-87.5675},{latitude:-38.3553,longitude:92.4325})>20000,'the true antipode is about 20000 km away');
assert.equal(L.distanceKm({lat:0,lon:0},{latitude:0,longitude:180}),20015,'half the equator is about 20015 km');
assert.equal(L.distanceKm(null,{latitude:0,longitude:0}),null,'a missing observer has no distance');
assert.equal(L.distanceKm({lat:0,lon:0},{latitude:null,longitude:0}),null,'a launch without pad coordinates has no distance');
assert.equal(L.proximityBand(10).band,'very-close');
assert.equal(L.proximityBand(150).band,'very-close');
assert.equal(L.proximityBand(151).band,'nearby');
assert.equal(L.proximityBand(600).band,'nearby');
assert.equal(L.proximityBand(601).band,'regional');
assert.equal(L.proximityBand(2000).band,'regional');
assert.equal(L.proximityBand(2001).band,'distant');
assert.equal(L.proximityBand(null).band,'unknown');
assert.equal(L.proximityBand(NaN).band,'unknown');
assert.equal(L.twilightBand(5).band,'daylight');
assert.equal(L.twilightBand(-3).band,'civil');
assert.equal(L.twilightBand(-9).band,'nautical');
assert.equal(L.twilightBand(-15).band,'astronomical');
assert.equal(L.twilightBand(-25).band,'night');
assert.equal(L.twilightBand(null).band,'unknown');

// 6. Local relevance never claims visibility, and produces no bearing, elevation, duration or
//    probability. Proximity and twilight are the only two facts it is allowed to state.
const closeBy=L.relevanceFor(EXACT,{lat:28.6,lon:-80.6,tz:'America/New_York'},{sunAltitude:()=>-14});
assert.equal(closeBy.visibility,'unknown','visibility is always unknown');
assert.equal(closeBy.proximity,'very-close');
assert.ok(closeBy.distanceKm<=50,'a nearby observer is measured as nearby');
assert.equal(closeBy.twilight,'astronomical');
assert.equal(closeBy.sunAltitudeDeg,-14);
const statements=closeBy.statements.join(' ');
assert.match(statements,/does not mean the rocket will be visible/,'proximity must be explicitly disclaimed');
assert.match(statements,/Local visibility: unknown/,'the card must say visibility is unknown');
assert.match(statements,/ascent trajectory/,'the reason visibility is unknown must be stated');
for(const forbidden of [/probab/i,/bearing/i,/azimuth/i,/elevation of/i,/you will see/i,/guarantee/i]){
  assert.equal(forbidden.test(statements),false,'a relevance statement must not contain '+forbidden);
}
// Any mention of visibility must be a denial or an admission of ignorance.
for(const statement of closeBy.statements){
  if(/visible/i.test(statement))assert.match(statement,/not|cannot|unknown|never/i,'a statement about visibility must be a denial: '+statement);
}
assert.deepEqual(Object.keys(closeBy).sort(),['distanceKm','proximity','proximityLabel','statements','sunAltitudeDeg','twilight','twilightLabel','visibility'],'the relevance result exposes no invented quantity');
const farAway=L.relevanceFor(EXACT,{lat:-33.9,lon:151.2,tz:'Australia/Sydney'},{sunAltitude:()=>-30});
assert.equal(farAway.proximity,'distant');
assert.match(farAway.statements.join(' '),/far from the launch site/);
const noCoordinates=L.relevanceFor(record({id:'nopad',pad:null}),site,{sunAltitude:()=>-20});
assert.equal(noCoordinates.distanceKm,null);
assert.equal(noCoordinates.proximity,'unknown');
assert.match(noCoordinates.statements.join(' '),/no published pad coordinates/);
// Twilight is only meaningful when a time was published.
const coarseRelevance=L.relevanceFor(MONTH_ONLY,site,{sunAltitude:()=>{throw new Error('sun must not be evaluated without a published time');}});
assert.equal(coarseRelevance.sunAltitudeDeg,null,'a period-only schedule has no twilight timing');
assert.match(coarseRelevance.statements.join(' '),/No time is published/);
const noSun=L.relevanceFor(EXACT,site,{sunAltitude:null});
assert.equal(noSun.sunAltitudeDeg,null);
assert.match(noSun.statements.join(' '),/could not be calculated/);
// One real committed record is still exercised, but only through assertions that hold for any record
// the artifact could contain: local visibility stays unknown and the statements deny a sighting. The
// assertion deliberately does not depend on that record's status, precision or site, so an hourly
// refresh cannot turn it into a failure.
const realRecord=L.relevanceFor(feed.launches.find(item=>item.precision.exact)||EXACT,site,{sunAltitude:()=>-22});
assert.equal(realRecord.visibility,'unknown','a real published launch is still unknown locally');
assert.match(realRecord.statements.join(' '),/Local visibility: unknown/);


// 7. Countdowns: only for a published time, only before an outcome, and never a claimed liftoff.
assert.equal(L.countdownFor(EXACT,NOW).mode,'ticking','a launch under 24 hours away ticks');
assert.equal(L.countdownFor(EXACT,NOW).text,'T\u221207:27:05');
assert.equal(L.countdownFor(EXACT,Date.parse(EXACT.net)-3600000).text,'T\u221201:00:00');
assert.equal(L.countdownFor(EXACT,Date.parse(EXACT.net)-2*86400000).mode,'soon','two days out is described, not ticked');
assert.equal(L.countdownFor(EXACT,Date.parse(EXACT.net)-2*86400000).text,'in 2 days');
assert.equal(L.countdownFor(EXACT,Date.parse(EXACT.net)-10*86400000).mode,'days');
assert.equal(L.countdownFor(EXACT,Date.parse(EXACT.net)-10*86400000).text,'in 10 days');
const passed=L.countdownFor(EXACT,Date.parse(EXACT.net)+60000);
assert.equal(passed.mode,'passed');
assert.match(passed.text,/Published time has passed/);
assert.equal(/liftoff|launched successfully|has launched/i.test(passed.text),false,'a passed time is never described as a liftoff');
assert.equal(L.countdownFor(DATE_ONLY,NOW).mode,'none','a date without a time has no countdown');
assert.equal(L.countdownFor(DATE_ONLY,NOW).reason,'precision');
assert.match(L.countdownFor(DATE_ONLY,NOW).text,/UTC date; no time published/);
assert.equal(L.countdownFor(MONTH_ONLY,NOW).reason,'precision');
assert.equal(L.countdownFor(DONE,NOW).reason,'completed','a completed flight has no countdown');
assert.equal(L.countdownFor(record({id:'held',status:{id:6,name:'On Hold',kind:'hold'}}),NOW).mode,'ticking','an on-hold flight still shows its published time, with the hold stated separately');
assert.equal(L.countdownFor(record({id:'inflight',status:{id:7,name:'In Flight',kind:'in-flight'}}),NOW).reason,'in-flight');
assert.equal(L.countdownFor(record({id:'unknown-status',status:{id:99,name:'Under Review',kind:'unknown'}}),NOW).reason,'status','an unrecognised status gets no countdown');
assert.equal(L.countdownFor(record({id:'no-time',net:null}),NOW).reason,'time');
assert.equal(L.countdownFor(null,NOW).mode,'none');
assert.equal(L.formatCountdown(0),'T\u221200:00:00');
assert.equal(L.formatCountdown(3661000),'T\u221201:01:01');
assert.equal(L.formatCountdown(90061000),'T\u22121d 01:01:01');
assert.equal(L.formatDuration(90000),'2 min');
assert.equal(L.formatDuration(5400000),'1 h 30 min');
assert.equal(L.formatDuration(3*86400000),'3 days');

// 8. Provider status is reported in the provider's own words.
assert.equal(L.statusChip(EXACT).tone,'go');
assert.match(L.statusChip(EXACT).label,/Go for Launch/);
assert.equal(L.statusChip(DONE).tone,'done');
assert.equal(L.statusChip(record({id:'held',status:{id:6,name:'On Hold',kind:'hold'}})).tone,'warn');
assert.match(L.statusChip(record({id:'held',status:{id:6,name:'On Hold',kind:'hold'}})).detail,/on hold/);
assert.match(L.statusChip(record({id:'unknown-status',status:{id:99,name:'Under Review',kind:'unknown'}})).detail,/not one this page recognises/);
assert.match(L.statusChip(record({id:'none',status:null})).label,/not published/);

// 9. Schedule changes are described with the previous time, and never with a new one.
const changed={...EXACT,change:{kind:'postponed',previous_net:'2026-10-15T22:00:00.000Z',previous_status:'Go for Launch',delta_minutes:117,detected_at:new Date(NOW).toISOString()}};
assert.match(L.changeText(changed),/Rescheduled later/);
assert.match(L.changeText(changed),/1 h 57 min/);
assert.match(L.changeText(changed),/2026-10-15T22:00:00\.000Z/);
assert.match(L.changeText({...EXACT,change:{kind:'advanced',previous_net:'2026-10-16T01:00:00.000Z',delta_minutes:-61}}),/Moved earlier/);
assert.match(L.changeText({...EXACT,change:{kind:'status',previous_status:'Go for Launch'}}),/Provider status changed from Go for Launch/);
assert.equal(L.changeText(EXACT),null,'an unchanged schedule has no change text');
assert.equal(L.changeText({...EXACT,change:{kind:'something-new'}}),null,'an unrecognised change kind says nothing');


// 10. Freshness, staleness and provenance travel with the feed.
const fresh=L.freshness(feed,Date.parse(feed.generated_at)+30*60000);
assert.equal(fresh.level,'fresh');
assert.equal(fresh.ageMinutes,30);
assert.match(fresh.text,/updated 30 min ago from Launch Library 2/);
const old=L.freshness(feed,Date.parse(feed.generated_at)+200*60000);
assert.equal(old.level,'stale');
assert.equal(old.stale,true);
assert.match(old.text,/3 h 20 min old/);
assert.match(old.text,/may not reflect postponements or cancellations/);
const staleFlagged=L.freshness({...feed,stale:true,stale_reason:'the provider rate limit was reached, so the last good schedule is being served'},Date.parse(feed.generated_at)+60000);
assert.equal(staleFlagged.level,'stale');
assert.match(staleFlagged.text,/rate limit/);
assert.equal(L.freshness(null,NOW).level,'missing');
assert.match(L.freshness(null,NOW).text,/No launch schedule is available/);
assert.equal(L.freshness({available:false},NOW).level,'missing');
assert.equal(L.freshness({available:true,generated_at:'nonsense'},NOW).level,'missing');
assert.equal(L.freshness({available:true,generated_at:new Date(NOW).toISOString(),stale_after_minutes:180},NOW+179*60000).level,'fresh');
assert.equal(L.freshness({available:true,generated_at:new Date(NOW).toISOString(),stale_after_minutes:180},NOW+181*60000).level,'stale');
const source=L.sourceLine(feed).join(' · ');
assert.match(source,/Source: Launch Library 2/);
assert.match(source,/API 2\.3\.0/);
assert.match(source,/Launch data: The Space Devs Launch Library 2/);
assert.match(source,/15 requests per hour/);
assert.match(source,/commercial redistribution/,'the commercial restriction must travel with the feed');
assert.deepEqual(L.sourceLine({}),[]);

// 11. Calendar grouping: a published time files under the reader's local day, a published-only date
//     under its own UTC date, and the groups come back in date order.
const groups=L.groupByDate([EXACT,DATE_ONLY,MONTH_ONLY],'America/Chicago');
assert.deepEqual(groups.map(group=>group.key),['2026-10-15','2026-10-19','2026-10-31'],'period-only launches still group by their announced period end for sorting only');
assert.deepEqual(groups[0].items.map(item=>item.id),['exact-tonight']);
assert.equal(L.dateKeyFor(record({id:'x',net:null}),'America/Chicago'),null);
assert.equal(L.groupByDate([],'America/Chicago').length,0);
assert.equal(L.groupByDate([EXACT,DATE_ONLY],'America/Chicago',{limit:1}).length,1,'the calendar respects its display limit');
assert.equal(L.RULES.maxCards>0&&L.RULES.relevantKm>=L.RULES.proximityKm.regional,true,'presentation rules stay coherent');
console.log('PASS: launch windows, precision-aware labels, timezone/DST, countdowns, proximity and twilight context, no fabricated visibility, freshness, schedule changes and calendar grouping ('+feed.launches.length+' committed launches, '+fixture.records.length+' fixture records).');

