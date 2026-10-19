/* Discovery presentation only. UTC milliseconds; source scores remain within their own categories.
   No fetching, propagation, scoring, storage or DOM. */
(function(root){
'use strict';
const DAY=86400000;
const LABELS=Object.freeze({satellites:'Satellites',planets:'Planets & alignments',meteors:'Meteor showers',comets:'Comets & special events',milkyway:'Milky Way',launches:'Rocket launches'});
const unique=list=>[...new Set(list.filter(Boolean))];
const chronological=(a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id);
function satellite(pass,{now,lifecycle,weatherText,stale=false,night=0}={}){
 const timing=lifecycle(pass,now);
 if(!pass.likely||!timing.timingInvariantValid||!timing.recommendationEligible||!Number.isFinite(pass.start)||!Number.isFinite(pass.end))return null;
 const warnings=unique([pass.provisional?'Weather incomplete; sighting score provisional.':null,weatherText,
  stale||pass.train?.stale?'Orbital elements may be stale; future predictions are uncertain.':null,
  !timing.timingInvariantValid?'Timing warning: open the original event for details.':null]);
 return {id:'satellites:'+pass.id,sourceId:pass.id,category:'satellites',title:pass.name,
  start:pass.start,end:pass.end,best:pass.peak?.t,precision:'interval',classification:'local-opportunity',
  categoryPriority:pass.score,withinCategory:true,optical:null,warnings,
  explanation:Math.round(pass.peak?.el)+'° peak · '+Math.round(pass.duration/60)+' min useful visibility',
  source:'CelesTrak orbital elements · local SGP4 calculation',
  circumstance:pass.train?'train:'+pass.train.cohortId:'object:'+pass.norad,
  target:{category:'satellites',id:pass.id,night,horizon:'week'}};
}
function celestial(opportunity,{category,errors=[]}={}){
 const local=opportunity.eligibility?.observable===true;
 const confidence=opportunity.confidence||{};
 const warnings=unique([...(opportunity.caveats||[]),...errors,
  confidence.observing?.grade&&confidence.observing.grade!=='forecast-included'?'Weather: '+confidence.observing.grade:null,
  confidence.phenomenon?.detail,confidence.astrometric?.detail,
  opportunity.optical?'Equipment: '+opportunity.optical:null]);
 const start=opportunity.start,end=opportunity.end;
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
 return {id:category+':'+opportunity.id,sourceId:opportunity.id,category,title:opportunity.title,
  start,end,best:opportunity.best,precision:start===end?'calculated-instant':'window',
  classification:local?'local-opportunity':'announcement',categoryPriority:opportunity.observing?.value,
  withinCategory:true,optical:opportunity.optical,difficulty:opportunity.difficulty||null,warnings,weatherSummary:opportunity.observing?.weatherUsed&&opportunity.observing.weather?'Forecast: '+opportunity.observing.weather.cloud_cover+'% cloud · '+opportunity.observing.weather.visibility+' m visibility · '+opportunity.observing.weather.precipitation+' mm precipitation':'Weather: '+(confidence.observing?.grade||'not included'),
  explanation:opportunity.summary||(opportunity.why||[]).join(' · '),
  source:opportunity.provenance?.library||opportunity.calculation?.library||'Celestial calculation',
  circumstance:[opportunity.type,...(opportunity.objects||[]).slice().sort(),opportunity.occurrence||''].join('|'),
  target:{category,id:opportunity.id,horizon:'week'}};
}
function dedupe(events){
 const entries=new Map();
 for(const event of events){if(!event)continue;const old=entries.get(event.id);
  entries.set(event.id,old?{...old,warnings:unique([...old.warnings,...event.warnings])}:event);
 }
 return [...entries.values()];
}
// Diversity is selection only: reserve each category's earliest occurrence, fill up to its cap,
// then sort by time. Never compare scores across categories.
function comingUp(events,{now,end,limit=6,perCategory=2,exclude=[]}={}){
 const excluded=new Set(exclude),seen=new Set(),ordered=dedupe(events).filter(e=>e.classification==='local-opportunity'&&e.end>now&&e.start<=end&&!excluded.has(e.id)).sort(chronological);
 const different=ordered.filter(e=>{const key=e.category+':'+e.circumstance;if(seen.has(key))return false;seen.add(key);return true;});
 const selected=[],counts=new Map();
 const take=e=>{selected.push(e);counts.set(e.category,(counts.get(e.category)||0)+1);};
 for(const e of different)if(!counts.has(e.category)&&selected.length<limit)take(e);
 for(const e of different)if(!selected.includes(e)&&(counts.get(e.category)||0)<perCategory&&selected.length<limit)take(e);
 return selected.sort(chronological);
}
function tonight(events,{now,start,end}={}){
 const leaders=new Map();
 for(const event of dedupe(events)){
  if(event.classification!=='local-opportunity'||event.end<=now||event.start>end||event.end<start)continue;
  const prior=leaders.get(event.category);
  if(!prior||event.categoryPriority>prior.categoryPriority||event.categoryPriority===prior.categoryPriority&&chronological(event,prior)<0)leaders.set(event.category,event);
 }
 return [...leaders.values()].sort(chronological);
}
// One published schedule as a discovery event. Exact schedules carry their published instant; every
// other precision carries no timestamp at all, so nothing downstream can invent one.
function launchRecord(record,{module:L,feed}={}){
 const p=L.precisionOf(record),status=L.statusChip(record);
 return {id:'launches:'+record.id,sourceId:record.id,category:'launches',title:record.mission||record.name,vehicle:record.vehicle,
  precision:p.kind,start:p.exact?Date.parse(record.net):null,end:null,classification:'global-schedule',visibility:'unknown',
  timeLabel:p.exact?null:L.periodLabel(record),status:status.label,
  warnings:unique([status.detail,L.changeText(record),'Local visibility unknown; no ascent trajectory is available.']),
  source:feed?.source?.attribution||'Launch data: The Space Devs Launch Library 2',
  target:{category:'launches',id:record.id,horizon:p.exact||p.kind==='day'?'week':'extended'}};
}
// Broad schedules never acquire a timestamp by substituting their provider's placeholder NET.
function launches(feed,{module:L,now,end}={}){
 if(!L||!L.validateFeed(feed).ok||!L.validateFeed(feed).available)return {events:[],freshness:{stale:true,level:'missing',text:'Launch schedule unavailable or not loaded; no schedule is inferred.'}};
 const selection=L.selectForWindow(feed,{start:now,end,horizon:'week',now});
 const records=[...selection.dated.slice(0,2).map(x=>x.record),...selection.periods.slice(0,1).map(x=>x.record)];
 return {freshness:L.freshness(feed,now),events:records.map(record=>launchRecord(record,{module:L,feed}))};
}
// Both ends carry a local date and timezone. Midnight/DST folds cannot collapse into one time.
function timeLabel(event,{timezone,clock='12'}={}){
 if(event.timeLabel)return event.timeLabel;
 const format=t=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:clock==='12',timeZoneName:'short'}).format(new Date(t));
 if(!Number.isFinite(event.start))return 'No precise observing time published';
 if(event.precision==='calculated-instant')return format(event.start)+' · calculated instant';
 if(event.precision==='window'||event.precision==='interval')return format(event.start)+' – '+format(event.end)+' · '+(event.precision==='window'?'observing window':'viewing interval');
 return format(event.start)+' · published '+event.precision+' precision';
}
root.OverheadDiscovery={LABELS,satellite,celestial,dedupe,tonight,comingUp,launches,launchRecord,timeLabel,chronological};
if(typeof module!=='undefined')module.exports=root.OverheadDiscovery;
})(typeof self!=='undefined'?self:globalThis);
