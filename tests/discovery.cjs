const assert=require('node:assert/strict');
const D=require('../overhead-discovery.js'),L=require('../overhead-launches.js'),{eventLifecycle}=require('../overhead-lifecycle.js');
const {fixture,now}=require('./overhead-lifecycle.cjs');
const options={now,lifecycle:eventLifecycle,weatherText:'Cloud forecast unavailable',stale:true,night:0};
const sat=D.satellite({...fixture,likely:true,provisional:true},options);
assert.equal(sat.classification,'local-opportunity');assert.equal(sat.categoryPriority,fixture.score);
assert(sat.warnings.some(x=>x.includes('stale')));assert(sat.warnings.some(x=>x.includes('provisional')));
assert.equal(D.satellite({...fixture,likely:false},options),null);
assert.equal(D.satellite(fixture,{...options,now:fixture.end+3600000}),null);
const base={id:'p',start:now+1000,end:now+100000,best:now+3000,title:'Planet pairing',eligibility:{observable:true},observing:{value:85},optical:'telescope',summary:'Calculated close approach',objects:['Saturn'],type:'conjunction',caveats:['Low altitude'],confidence:{observing:{grade:'astronomy-only'},phenomenon:{detail:'geometry only'}},provenance:{library:'Astronomy Engine'}};
const planet=D.celestial(base,{category:'planets',errors:['Dataset warning']});
assert.equal(planet.precision,'window');assert(planet.warnings.includes('Equipment: telescope'));assert(planet.warnings.includes('Dataset warning'));
assert.equal(D.celestial({...base,end:NaN},{category:'planets'}),null);
const announcement=D.celestial({...base,eligibility:{observable:false}},{category:'planets'});
assert.equal(announcement.classification,'announcement');
const sample=(category,id,start,priority=50)=>({...planet,id,category,start,end:start+1000,categoryPriority:priority,circumstance:id});
const a=sample('satellites','s',now+2000,99),b=sample('planets','p',now+1000,1),c=sample('meteors','m',now+3000,3);
assert.deepEqual(D.tonight([a,b,c],{now,start:now,end:now+10000}).map(x=>x.id),['p','s','m'],'cross-category order is time even when scores differ');
const duplicates=D.dedupe([a,{...a,warnings:['Additional warning']}]);assert.equal(duplicates.length,1);assert(duplicates[0].warnings.includes('Additional warning'));
const many=[...Array.from({length:30},(_,i)=>sample('satellites','s'+i,now+100+i)),b,c,sample('comets','c',now+9000),announcement];
const upcoming=D.comingUp(many,{now,end:now+10000});
assert.equal(upcoming.length,5);assert.equal(upcoming.filter(x=>x.category==='satellites').length,2);assert.equal(new Set(upcoming.map(x=>x.category)).size,4);
assert.deepEqual(upcoming.map(x=>x.start),upcoming.map(x=>x.start).sort((a,b)=>a-b));
assert.equal(D.comingUp([a,{...a,id:'repeat'}],{now,end:now+10000}).length,1,'same object/circumstance appears once');
assert.equal(D.comingUp([a],{now,end:now+10000,exclude:['s']}).length,0);
assert.deepEqual(D.tonight([announcement],{now,start:now,end:now+10000}),[]);
// A broad window is a range, and a DST fold explicitly names both offsets.
const text=D.timeLabel({...planet,start:Date.parse('2026-11-01T05:30Z'),end:Date.parse('2026-11-01T06:30Z')},{timezone:'America/New_York'});
assert.match(text,/EDT/);assert.match(text,/EST/);assert.match(text,/observing window/);
const midnight=D.timeLabel({...planet,start:Date.parse('2026-10-15T23:00Z'),end:Date.parse('2026-10-16T02:00Z')},{timezone:'UTC'});assert.match(midnight,/Oct 15/);assert.match(midnight,/Oct 16/);
const feed={schema:L.SCHEMA,available:true,generated_at:new Date(now-86400000).toISOString(),source:{attribution:'Launch data: The Space Devs Launch Library 2'},launches:[]};
for(const [id,kind,net]of [['exact','second',new Date(now+3600000).toISOString()],['day','day',new Date(now+86400000).toISOString()],['month','month',new Date(now+86400000).toISOString()],['quarter','quarter',new Date(now+86400000).toISOString()],['year','year',new Date(now+86400000).toISOString()]]){
 const record={id,name:id,net,precision:{kind,exact:kind==='second',dated:['second','day'].includes(kind)},status:{kind:'hold',name:'On Hold'},vehicle:'Falcon 9',change:{kind:'postponed',delta_minutes:60}};
 const out=D.launches({...feed,launches:[record]},{module:L,now,end:now+7*86400000});
 assert.equal(out.events.length,1);assert(out.freshness.stale);assert.equal(out.events[0].visibility,'unknown');assert.equal(out.events[0].classification,'global-schedule');assert.equal(out.events[0].status,'On Hold');assert(out.events[0].warnings.some(x=>x.includes('Rescheduled later')));
 if(kind!=='second'){assert.equal(out.events[0].start,null);assert.match(out.events[0].timeLabel,/published|announced/);}
}
assert.equal(D.launches({...feed,launches:[{id:'cancelled',net:new Date(now).toISOString(),status:{kind:'failure'},precision:{exact:true}}]},{module:L,now,end:now+86400000}).events.length,0);
assert.equal(D.launches(null,{module:L,now,end:now+86400000}).events.length,0);
assert.equal(D.launches({available:false,schema:L.SCHEMA},{module:L,now,end:now+86400000}).freshness.stale,true);
console.log('PASS: discovery mappings, no cross-score ranking, dedupe, diversity, honest windows/DST, optical/source warnings, launch precision/status/freshness and missing data.');
