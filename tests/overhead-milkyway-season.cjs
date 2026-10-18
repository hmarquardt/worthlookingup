/* The next Galactic-core season: the year-long search beyond the ninety-day plan. It must find the same
   first qualifying night as a brute-force walk of every night, distinguish a marginal season opening from a
   genuinely favourable night, classify every kind of negative answer for the reason the geometry gives, and
   never invent a forecast, a brightness or a second date it cannot support. */
const assert=require('assert');
const path=require('path');
globalThis.Astronomy=require(path.join(__dirname,'..','vendor','overhead','astronomy-2.1.19.min.js'));
// The engine's night builder needs SunCalc, exactly as the page does.
globalThis.SunCalc=require(path.join(__dirname,'..','vendor','overhead','suncalc-1.9.0.js'));
const A=require(path.join(__dirname,'..','overhead-astro.js'));
require(path.join(__dirname,'..','overhead-engine.js'));
const E=globalThis.OverheadEngine;   // the engine publishes itself on the global, as the page expects
const MW=require(path.join(__dirname,'..','overhead-milkyway.js'));
const O=require(path.join(__dirname,'..','overhead-opportunities.js'));
const D=require(path.join(__dirname,'..','overhead-discovery.js'));
const Cal=require(path.join(__dirname,'..','overhead-calendar.js'));
const P=require(path.join(__dirname,'..','overhead-celestial-plan.js'));

let failures=0;
function test(name,fn){
 try{fn();console.log('ok   '+name);}
 catch(error){failures++;console.log('FAIL '+name+'\n     '+String(error&&error.message||error));}
}
const SITES={
 indiana:{lat:38.3553,lon:-87.5675,tz:'America/Chicago',name:'Princeton, Indiana'},
 florida:{lat:25.7617,lon:-80.1918,tz:'America/New_York',name:'Miami, Florida'},
 socal:{lat:34.0522,lon:-118.2437,tz:'America/Los_Angeles',name:'Los Angeles, California'},
 quito:{lat:-0.1807,lon:-78.4678,tz:'America/Guayaquil',name:'Quito, Ecuador'},
 capetown:{lat:-33.9249,lon:18.4241,tz:'Africa/Johannesburg',name:'Cape Town, South Africa'},
 sydney:{lat:-33.8688,lon:151.2093,tz:'Australia/Sydney',name:'Sydney, Australia'},
 tromso:{lat:69.6492,lon:18.9553,tz:'Europe/Oslo',name:'Tromso, Norway'},
 ushuaia:{lat:-54.8019,lon:-68.303,tz:'America/Argentina/Ushuaia',name:'Ushuaia, Argentina'},
 helsinki:{lat:60.1699,lon:24.9384,tz:'Europe/Helsinki',name:'Helsinki, Finland'},
};
// The same observing-night builder the interface uses (celestialWindows): the engine's own nights for the
// first week, then sunset-to-sunrise per local noon, so the seasonal search never invents its own night.
function nightsFor(site,fromIso,days){
 const out=E.nights(site,Date.parse(fromIso)).slice(0,Math.min(days,7));
 if(days>out.length&&A){
  const base=out.length,last=Date.parse(out[out.length-1].day+'T12:00:00Z');
  for(let i=base;i<days;i++){
   const day=new Date(last+(i-base+1)*86400000).toISOString().slice(0,10);
   const noon=E.zonedTime(day,12,site.tz),windows=A.sunsetSunrise(site,noon);
   out.push({day:E.localDate(noon,site.tz),start:Number.isFinite(windows.sunset)?windows.sunset:E.zonedTime(day,18,site.tz),
    end:Number.isFinite(windows.sunrise)?windows.sunrise:E.zonedTime(day,6,site.tz)});
  }
 }
 return out.filter(night=>Number.isFinite(night.start)&&Number.isFinite(night.end)&&night.end>night.start);
}
const COARSE={stepMinutes:20,solarStepMinutes:15,moonStepMinutes:20};
// One walk per site and option set: the suite asks the same questions from several tests, and the engine's own
// night cache makes repeats cheap but not free. The cache-behaviour tests below call the engine directly.
const seasonMemo=new Map();
function season(site,fromIso,options){
 const key=[site.lat,site.lon,fromIso,JSON.stringify(options||{})].join('|');
 if(!seasonMemo.has(key))seasonMemo.set(key,MW.analyseSeason(nightsFor(site,fromIso,366),site,{...COARSE,...options}));
 return seasonMemo.get(key);
}
// The brute-force reference: every night, fine sampling, no early exit, the same nightly engine.
// The walk is exhaustive over nights but uses the same sampling as the search: the property under test is the
// control flow (every night, no early exit, first hit wins), not the sampler. A finer second pass below checks
// that the sampler itself does not move the answer.
function bruteForce(site,fromIso,{favorableQuality=MW.SEASON.favorableQuality,options=COARSE}={}){
 const nights=nightsFor(site,fromIso,366);
 let opening=null,favorable=null,withWindow=0;
 for(const night of nights){
  const result=MW.analyseNight(night,site,options);
  if(!result.observable)continue;
  withWindow++;
  if(!opening)opening=result;
  if(!favorable&&result.quality.value>=favorableQuality)favorable=result;
 }
 return {opening,favorable,withWindow,nights:nights.length};
}

/* ---- the search itself ------------------------------------------------------------- */

const FROM='2026-10-16T23:30:00Z';

test('the first qualifying night is the season opening, and it is dated where the observer is',()=>{
 const result=season(SITES.indiana,FROM);
 assert.strictEqual(result.kind,'season');
 assert.strictEqual(result.classification,'season-favorable');
 assert.ok(result.opening,'a season opening exists');
 // The window opens at 04:49 local on 29 March 2027: the night begins on the 28th, the morning falls on the
 // 29th, and both facts are carried rather than one standing in for the other.
 assert.strictEqual(result.opening.day,'2027-03-28');
 assert.strictEqual(result.opening.date,'2027-03-29');
 assert.ok(result.opening.minutes>=15&&result.opening.minutes<=40,'a short opening window: '+result.opening.minutes);
 assert.ok(result.opening.coreAltitude>=20&&result.opening.coreAltitude<26,'core at the threshold: '+result.opening.coreAltitude);
 assert.strictEqual(result.opening.coreCompass,'S');
 assert.ok(result.opening.favorable===false,'quality '+result.opening.quality+' is below the favourable bar');
 assert.ok(result.opening.limitations.length>=2,'the marginal night names its limitations');
 // Every window edge is inside the dark part of the night it claims.
 assert.ok(result.opening.start<result.opening.end);
 assert.ok(result.opening.end-result.opening.start>=result.opening.minutes*60000-1000);
 assert.ok(result.opening.end-result.opening.start<=result.opening.minutes*60000+1000);
});

test('no qualifying night in ninety days, and one later in the year',()=>{
 MW.clearCache();
 const ninety=nightsFor(SITES.indiana,FROM,90);
 let windows=0;
 for(const night of ninety)if(MW.analyseNight(night,SITES.indiana,COARSE).observable)windows++;
 assert.strictEqual(windows,0,'the ninety-day plan really is empty at this site and date');
 const result=season(SITES.indiana,FROM);
 assert.ok(result.opening,'the year still has an opening');
 assert.ok(result.opening.start-Date.parse(FROM)>90*86400000,'the opening is beyond the ninety-day horizon');
 assert.ok(result.opening.start-Date.parse(FROM)<366*86400000,'and inside the year that was searched');
});

test('a marginal opening is never sold as the best night, and the favourable night is separate',()=>{
 const result=season(SITES.indiana,FROM);
 assert.strictEqual(result.opening.favorable,false);
 assert.ok(result.favorable,'a favourable night exists later in the season');
 assert.notStrictEqual(result.favorable.date,result.opening.date);
 assert.ok(result.favorable.start>result.opening.start);
 assert.ok(result.favorable.quality>=MW.SEASON.favorableQuality);
 assert.ok(result.favorable.minutes>result.opening.minutes,'the favourable window is longer');
 assert.ok(result.explanation.some(line=>/marginal/.test(line)),'the prose calls the opening marginal');
 assert.ok(result.explanation.some(line=>/first genuinely favourable night is 2027-04-13/.test(line)),
  'the prose names the favourable night: '+result.explanation.join(' | '));
});

test('moonlight inside the window is reported, and a moonless window is not penalised',()=>{
 const result=season(SITES.indiana,FROM);
 assert.ok(result.opening.moon,'the opening night has a moon classification');
 assert.ok(['some-moonlight','significant-moonlight','moon-below-horizon','bright-moon-window']
  .includes(result.opening.moon.classification),result.opening.moon.classification);
 // The favourable night in this fixture has the Moon below the horizon, and its factors say so.
 assert.strictEqual(result.favorable.moon.classification,'moon-below-horizon');
 assert.ok(result.favorable.factors.moon>result.opening.factors.moon,
  'a moon below the horizon costs less than a Moon in the window');
});

test('the favourable bar is the category scale, and lowering it moves the date, not the geometry',()=>{
 MW.clearCache();
 const strict=season(SITES.indiana,FROM);
 MW.clearCache();
 const relaxed=season(SITES.indiana,FROM,{favorableQuality:0});
 assert.strictEqual(relaxed.opening.date,strict.opening.date,'the opening is a geometry question');
 assert.strictEqual(relaxed.favorable.date,relaxed.opening.date,'with no bar, the opening is the first favourable night');
 assert.strictEqual(relaxed.classification,'season-favorable');
 assert.strictEqual(strict.favorableQuality,60);
});

/* ---- equivalence with a brute-force walk ------------------------------------------- */

test('the optimized search returns the brute-force first qualifying night, at every reference site',()=>{
 MW.clearCache();
 const differences=[];
 for(const [name,site] of Object.entries(SITES)){
  const fast=season(site,FROM);
  const brute=bruteForce(site,FROM);
  const fastOpen=fast.opening?fast.opening.day:null,bruteOpen=brute.opening?brute.opening.day:null;
  const fastFav=fast.favorable?fast.favorable.day:null,bruteFav=brute.favorable?brute.favorable.day:null;
  if(fastOpen!==bruteOpen||fastFav!==bruteFav){
   differences.push(name+': fast '+fastOpen+'/'+fastFav+' vs brute '+bruteOpen+'/'+bruteFav);
  }
  // Where both agree the night exists, the interval must too: no off-by-one-night error and no invented
  // window. The minutes are rounded by the engine to the nearest minute, so equality is exact, not tolerant.
  if(fast.opening&&brute.opening){
   assert.strictEqual(fast.opening.minutes,brute.opening.window.minutes,name+' window minutes');
   assert.ok(Math.abs(fast.opening.coreAltitude-brute.opening.core.maxAltitude)<0.05,name+' core altitude');
  }
 }
 assert.deepStrictEqual(differences,[],'the coarse walk and the exhaustive walk must agree exactly');
});

test('coarse and fine sampling agree on the night and on the interval',()=>{
 MW.clearCache();
 const coarse=season(SITES.indiana,FROM,{stepMinutes:20,solarStepMinutes:15,moonStepMinutes:20});
 MW.clearCache();
 const fine=season(SITES.indiana,FROM,{stepMinutes:5,solarStepMinutes:5,moonStepMinutes:5});
 assert.strictEqual(fine.opening.day,coarse.opening.day);
 assert.strictEqual(fine.favorable.day,coarse.favorable.day);
 assert.ok(Math.abs(fine.opening.minutes-coarse.opening.minutes)<=1,'edges are bisected, so sampling only moves them by a minute');
 assert.ok(Math.abs(fine.favorable.minutes-coarse.favorable.minutes)<=1);
});

test('the walk stops as soon as both answers are known, and says so',()=>{
 const result=season(SITES.indiana,FROM);
 assert.strictEqual(result.search.nights,366);
 assert.ok(result.search.scanned<result.search.nights,'the opening and the favourable night were found early');
 assert.strictEqual(result.search.stoppedEarly,true);
 assert.ok(result.search.withWindow<result.search.scanned);
 // A site with no season has nothing to stop for, so the whole year is examined.
 MW.clearCache();
 const none=season(SITES.tromso,FROM);
 assert.strictEqual(none.search.scanned,none.search.nights);
 assert.strictEqual(none.search.stoppedEarly,false);
});

/* ---- geography and the honesty of a negative answer --------------------------------- */

test('a latitude where the core never reaches the threshold says so, and never blames the season',()=>{
 MW.clearCache();
 const result=season(SITES.tromso,FROM);
 assert.strictEqual(result.classification,'never-reaches-threshold');
 assert.strictEqual(result.opening,null);
 assert.strictEqual(result.favorable,null);
 // 69.65 N with the core at -29 degrees 01': the core tops out below the useful horizon all year.
 assert.ok(result.maxCoreAltitude<0,'measured ceiling '+result.maxCoreAltitude);
 assert.ok(result.explanation.join(' ').includes('never rises above'));
 assert.ok(/band is not invisible|does not make the band invisible/.test(result.explanation.join(' ')),
  'the core is not the whole band: '+result.explanation.join(' | '));
});

test('a high latitude with white nights is classified as darkness, not as geometry',()=>{
 // McMurdo in December: the core is 37 degrees up, and the sun never sets. The answer must be about the
 // twilight, and the same site must still have a season later in the year.
 MW.clearCache();
 const antarctic={lat:-77.846,lon:166.676,tz:'Antarctica/McMurdo',name:'McMurdo Station'};
 const december=MW.analyseSeason(nightsFor(antarctic,'2027-12-01T00:00:00Z',30),antarctic,COARSE);
 assert.strictEqual(december.classification,'no-darkness');
 assert.ok(december.maxCoreAltitude>=20,'the core is up: '+december.maxCoreAltitude);
 assert.ok(/never reaches even civil darkness/.test(december.explanation.join(' ')));
 assert.ok(/twilight, not the geometry/.test(december.explanation.join(' ')));
 MW.clearCache();
 const year=MW.analyseSeason(nightsFor(antarctic,'2026-10-16T23:30:00Z',366),antarctic,COARSE);
 assert.ok(['season-favorable','season-marginal'].includes(year.classification),year.classification);
 assert.ok(year.opening,'the polar night gives the core a real season');
});

test('the core has an altitude ceiling, and 60 north sits under it',()=>{
 MW.clearCache();
 const result=season(SITES.helsinki,FROM);
 // 90 - |60.17 + 29.01| = 0.8 degrees: the core grazes the horizon and never becomes observable.
 assert.strictEqual(result.classification,'never-reaches-threshold');
 assert.ok(result.maxCoreAltitude<5,'ceiling '+result.maxCoreAltitude);
 assert.ok(result.maxCoreAltitude>=0,'it does at least rise: '+result.maxCoreAltitude);
});

test('the southern hemisphere opens in its own season, not on a northern calendar date',()=>{
 MW.clearCache();
 const south=season(SITES.capetown,FROM);
 const north=season(SITES.indiana,FROM);
 assert.strictEqual(south.classification,'season-favorable');
 // Cape Town is inside the core's season on 16 October 2026; Indiana is not, and waits until spring.
 assert.ok(south.opening.start-Date.parse(FROM)<2*86400000,'Cape Town opens now');
 assert.ok(north.opening.start-Date.parse(FROM)>120*86400000,'Indiana opens months later');
 assert.ok(south.opening.coreAltitude>45,'the core is high from 34 S: '+south.opening.coreAltitude);
 assert.ok(north.opening.coreAltitude<30,'and low from 38 N: '+north.opening.coreAltitude);
 // Sydney agrees with Cape Town about the month, which is the point of a location-driven answer.
 MW.clearCache();
 const sydney=season(SITES.sydney,FROM);
 assert.strictEqual(new Date(sydney.opening.start).getUTCMonth(),new Date(south.opening.start).getUTCMonth());
});

test('a tropical site has opportunities in every month, so its opening is today and its favourable night is soon',()=>{
 MW.clearCache();
 const result=season(SITES.quito,FROM);
 assert.strictEqual(result.classification,'season-favorable');
 assert.ok(result.opening.start-Date.parse(FROM)<86400000,'the first night already qualifies');
 assert.ok(result.favorable.start-result.opening.start<30*86400000,'and a favourable night follows within a month');
 assert.ok(result.opening.coreAltitude>40,'the core passes high over the equator: '+result.opening.coreAltitude);
});

test('a far-southern site opens now, and its favourable night is on or after the opening',()=>{
 MW.clearCache();
 const result=season(SITES.ushuaia,FROM);
 assert.ok(['season-favorable','season-marginal'].includes(result.classification));
 assert.ok(result.opening.start-Date.parse(FROM)<2*86400000,'Ushuaia opens now');
 assert.ok(result.favorable,'and a favourable night exists in the year');
 assert.ok(result.favorable.start>=result.opening.start,'never earlier than the opening');
 assert.ok(result.opening.coreAltitude>30,'the far south sees the core high: '+result.opening.coreAltitude);
});

/* ---- time boundaries: daylight saving, midnight, leap years ------------------------- */

test('a season that crosses a daylight-saving change keeps every local time correct',()=>{
 // Indiana switches to daylight time on 14 March 2027, two weeks before the season opens. The window must
 // carry the offset in force on the night, not the one in force when the search started.
 const result=season(SITES.indiana,FROM);
 const opening=result.opening;
 const offset=instant=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:SITES.indiana.tz,timeZoneName:'longOffset'})
   .formatToParts(new Date(instant));
  return (parts.find(part=>part.type==='timeZoneName')||{}).value;
 };
 assert.strictEqual(offset(opening.start),'GMT-05:00','late March in Chicago is daylight time');
 assert.strictEqual(offset(Date.parse('2027-03-10T00:00:00Z')),'GMT-06:00','earlier in March it was standard time');
 // The local clock hour is the one the observer would read.
 const localHour=instant=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:SITES.indiana.tz,hour:'2-digit',
  minute:'2-digit',hour12:false}).format(new Date(instant)).slice(0,2));
 assert.ok(localHour(opening.start)>=3&&localHour(opening.start)<=6,'a pre-dawn window: '+localHour(opening.start));
 // Every night in the walk is a real night with a sunset before its sunrise, across the change.
 let nights=0,crossing=0;
 for(const night of nightsFor(SITES.indiana,FROM,200)){
  nights++;
  assert.ok(night.end>night.start,'night '+night.day+' runs forward');
  assert.ok((night.end-night.start)/3600000>6,'night '+night.day+' is a night, not a fragment');
  if(new Date(night.start).toISOString().slice(0,10)!==new Date(night.end).toISOString().slice(0,10))crossing++;
 }
 assert.ok(nights>=199);
 assert.ok(crossing>150,'these nights cross midnight in UTC, which the local dating must survive');
});

test('a window that opens before local midnight is dated to the evening the observer is in',()=>{
 // Cape Town in October: the core is up in the evening, so the window is on the same local date as the
 // night, and the record says so rather than assuming a post-midnight window.
 MW.clearCache();
 const result=season(SITES.capetown,FROM);
 const opening=result.opening;
 const format=instant=>new Intl.DateTimeFormat('en-CA',{timeZone:SITES.capetown.tz,year:'numeric',
  month:'2-digit',day:'2-digit'}).format(new Date(instant));
 assert.strictEqual(opening.date,format(opening.start));
 assert.ok(Number.isFinite(opening.start)&&opening.end>opening.start);
 // Evening windows and pre-dawn windows both occur across the reference sites, and both are dated by the
 // instant rather than by the night's label.
 MW.clearCache();
 const dawn=season(SITES.indiana,FROM).opening;
 assert.strictEqual(dawn.day!==dawn.date,true,'the Indiana opening falls after local midnight');
 assert.strictEqual(dawn.date,new Intl.DateTimeFormat('en-CA',{timeZone:SITES.indiana.tz,year:'numeric',
  month:'2-digit',day:'2-digit'}).format(new Date(dawn.start)));
});

test('a leap year is searched without losing or doubling a night',()=>{
 // From February 2028: 2028 is a leap year, so 29 February must appear exactly once in the walk and the
 // search must still terminate inside its horizon.
 MW.clearCache();
 const nights=nightsFor(SITES.florida,'2028-02-01T12:00:00Z',366);
 const days=nights.map(night=>night.day);
 assert.ok(days.includes('2028-02-29'),'the leap day is in the walk');
 assert.strictEqual(days.filter(day=>day==='2028-02-29').length,1,'and it appears once');
 assert.strictEqual(new Set(days).size,days.length,'no day is walked twice');
 const result=MW.analyseSeason(nights,SITES.florida,COARSE);
 assert.ok(['season-favorable','season-marginal'].includes(result.classification),result.classification);
 assert.ok(result.opening,'Florida has a season from February');
 assert.ok(result.opening.start>=Date.parse('2028-02-01T12:00:00Z'),'the opening is in the future');
 assert.ok(result.opening.start<=Date.parse('2029-02-01T12:00:00Z'),'and inside the year that was searched');
});

/* ---- no fabricated weather, brightness or confidence ------------------------------- */

test('a date months ahead carries no forecast and no brightness claim',()=>{
 const result=season(SITES.indiana,FROM);
 assert.strictEqual(result.weather.state,'not-forecastable');
 assert.ok(/No forecast exists at this range/.test(result.weather.detail));
 assert.ok(/not a prediction of cloud, haze or light pollution/.test(result.weather.detail));
 const prose=JSON.stringify(result);
 for(const forbidden of ['clear skies','guaranteed','sighting chance','bortle','sky brightness','probability',
  'will be clear','best night of the season'])
  assert.ok(!new RegExp(forbidden,'i').test(prose),'the season never claims '+forbidden);
 // The one number it offers is this category's own window quality, and it says what that is.
 assert.ok(Number.isFinite(result.opening.quality));
 assert.ok(result.opening.quality>=0&&result.opening.quality<=100);
 assert.ok(result.provenance.method.includes('walked in date order'));
})

test('the month-ahead result is an opportunity to plan, not an observing guarantee',()=>{
 const result=season(SITES.indiana,FROM);
 const candidate=MW.seasonCandidate(result.opening,SITES.indiana);
 assert.strictEqual(candidate.data.weatherState,'not-forecastable');
 assert.ok(candidate.caveats.some(text=>/not forecastable/.test(text)));
 assert.ok(candidate.caveats.some(text=>/not comparable with satellite/.test(text)));
 assert.ok(candidate.data.season===true);
 assert.strictEqual(candidate.data.windowQuality,result.opening.quality);
 // Three positions, in time order, each with an altitude and a direction.
 assert.strictEqual(candidate.positions.length,3);
 assert.ok(candidate.positions.every(position=>Number.isFinite(position.altitude)&&position.compass));
 assert.ok(candidate.positions[0].at<=candidate.positions[1].at);
 assert.ok(candidate.positions[1].at<=candidate.positions[2].at);
 assert.strictEqual(candidate.optical,'camera');
 assert.strictEqual(candidate.data.positionGrade,'reference-j2000');
})

/* ---- caching ------------------------------------------------------------------------ */

test('a warm search reuses the nights it already analysed and answers identically',()=>{
 MW.clearCache();
 const windows=nightsFor(SITES.indiana,FROM,366);
 const coldStart=Date.now();
 const cold=MW.analyseSeason(windows,SITES.indiana,COARSE);
 const coldMs=Date.now()-coldStart;
 const warmStart=Date.now();
 const warm=MW.analyseSeason(windows,SITES.indiana,COARSE);
 const warmMs=Date.now()-warmStart;
 assert.strictEqual(warm.opening.day,cold.opening.day);
 assert.strictEqual(warm.opening.minutes,cold.opening.minutes);
 assert.strictEqual(warm.favorable.day,cold.favorable.day);
 assert.strictEqual(warm.search.withWindow,cold.search.withWindow);
 assert.ok(warm.search.cacheHits>0,'the second walk hits the night cache');
 assert.ok(warm.search.cacheHits>=warm.search.scanned-1,'every night of the second walk was already known');
 console.log('     cold '+coldMs+' ms, warm '+warmMs+' ms, cold analysed '+cold.search.scanned+
  ' nights in '+cold.search.ms+' ms, warm hits '+warm.search.cacheHits);
 assert.ok(warmMs<=coldMs,'the warm search is not slower than the cold one');
})

test('the search reuses a night the plan has already analysed',()=>{
 MW.clearCache();
 const nights=nightsFor(SITES.indiana,FROM,366);
 // The plan analyses tonight first; the season must not repeat that work.
 MW.analyseNight(nights[0],SITES.indiana,{...COARSE,thresholdDeg:MW.RULES.core.goodDeg});
 const result=MW.analyseSeason(nights,SITES.indiana,COARSE);
 assert.ok(result.search.cacheHits>=1,'the first night was already known');
 assert.ok(result.search.scanned>=2);
 assert.strictEqual(result.search.cacheMisses,result.search.scanned-1,'only the unfamiliar nights were analysed');
 // A different threshold is a different question about the same night, so it is deliberately not reused.
 MW.clearCache();
 MW.analyseNight(nights[0],SITES.indiana,{...COARSE,thresholdDeg:10});
 const other=MW.analyseSeason(nights,SITES.indiana,{...COARSE,thresholdDeg:25});
 assert.strictEqual(other.search.cacheHits,0,'a threshold change re-analyses the night');
})

/* ---- the plan and the calendar reuse the ordinary machinery -------------------------- */

test('the season request travels through the plan module and the worker protocol',()=>{
 MW.clearCache();
 const windows=nightsFor(SITES.indiana,FROM,366);
 const result=P.computeSeason({kind:'season',site:SITES.indiana,windows,now:Date.parse(FROM),
  options:{minAltitude:20}});
 assert.strictEqual(result.kind,'season');
 assert.strictEqual(result.category,'milkyway');
 assert.strictEqual(result.season.kind,'season');
 assert.strictEqual(result.season.thresholdDeg,20);
 assert.strictEqual(result.season.opening.day,'2027-03-28');
 // The window chosen is the one the nightly engine gives that night, not a second construction of it.
 const night=MW.analyseNight(windows.find(entry=>entry.day==='2027-03-28'),SITES.indiana,
  {...COARSE,thresholdDeg:20});
 assert.strictEqual(result.season.opening.start,night.window.start);
 assert.strictEqual(result.season.opening.end,night.window.end);
 assert.strictEqual(result.season.opening.minutes,night.window.minutes);
})

test('a seasonal window is calendar-eligible, stable and honest about weather',()=>{
 const result=season(SITES.indiana,FROM);
 const candidate=MW.seasonCandidate(result.opening,SITES.indiana);
 const scored=O.withScores([candidate],{site:SITES.indiana,now:Date.parse(FROM),weatherAt:null});
 const opportunity=scored.opportunities[0];
 opportunity.observing={...opportunity.observing,value:candidate.data.windowQuality};
 const event=D.celestial(opportunity,{category:'milkyway',errors:[]});
 assert.ok(event,'the future window becomes an event');
 assert.strictEqual(event.precision,'window','a Milky Way window is an interval, never an instant');
 assert.strictEqual(event.start,candidate.t.start);
 assert.strictEqual(event.end,candidate.t.end);
 assert.strictEqual(event.categoryPriority,result.opening.quality);
 assert.ok(event.warnings.some(text=>/not forecastable/.test(text)),'the export carries the weather caveat');
 const settings={now:Date.parse(FROM),timezone:SITES.indiana.tz,clock:'12',site:{name:SITES.indiana.name},
  source:opportunity,scoreLabel:value=>value>=75?'strong':value>=45?'worthwhile':'marginal'};
 const first=Cal.single({event,source:opportunity},settings);
 assert.ok(first.eligible,first.reason);
 const unfolded=first.ics.replace(/\r\n[ \t]/g,'');
 assert.ok(/DTSTART:/.test(unfolded)&&/DTEND:/.test(unfolded),'an interval, with both ends');
 assert.ok(/Milky Way window quality 30\/100/.test(unfolded),'the score is named as this category\'s own');
 assert.ok(/not forecastable|no forecast exists/i.test(unfolded),'and the file says weather is unknown');
 // The same night yields the same UID on a second export, so a calendar entry can be updated rather than
 // duplicated.
 const second=Cal.single({event,source:opportunity},settings);
 assert.strictEqual(second.event.uid,first.event.uid);
 assert.ok(/\.ics$/.test(first.name));
})

/* ---- performance -------------------------------------------------------------------- */

test('a year-long search stays inside a working interaction budget',()=>{
 MW.clearCache();
 const windows=nightsFor(SITES.indiana,FROM,366);
 const started=Date.now();
 const result=MW.analyseSeason(windows,SITES.indiana,COARSE);
 const cold=Date.now()-started;
 const warmStart=Date.now();
 MW.analyseSeason(windows,SITES.indiana,COARSE);
 const warm=Date.now()-warmStart;
 console.log('     cold '+cold+' ms ('+result.search.scanned+' nights), warm '+warm+' ms');
 // Deliberately generous: CI machines vary, and the honest claim is "a fraction of a second for a typical
 // site, bounded by a full year for a site with no season". It runs in a worker, so even the bound never
 // blocks the page.
 assert.ok(cold<15000,'a cold search is bounded: '+cold+' ms');
 assert.ok(warm<cold,'the warm search is faster');
})

console.log('');
if(failures){console.log(failures+' check(s) failed');process.exit(1);}
console.log('all seasonal checks passed');
