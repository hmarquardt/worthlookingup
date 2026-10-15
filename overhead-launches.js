/* Worth Looking Up launch calendar interpretation (browser module, classic script).
 *
 * Consumes the normalized feed published by the launch engine (src/launches/launch-feed.mjs). It owns
 * presentation-side reasoning only: which launches belong to the selected planning window, how a
 * schedule is described without inventing precision, how close a launch site is, and what may be said
 * about local visibility. It never propagates anything, never touches satellite scoring and never
 * produces a visibility claim.
 *
 * Visibility rule enforced here: `relevanceFor` always returns visibility 'unknown'. Proximity to a
 * launch site is not evidence of a visible rocket, and no bearing, elevation, duration or probability
 * is ever manufactured. See src/launches/launch-visibility.md.
 */
(function(root){
'use strict';
const SCHEMA='worthlookingup.launches/1';
const RULES=Object.freeze({
  staleAfterMinutes:180,
  proximityKm:Object.freeze({veryClose:150,nearby:600,regional:2000}),
  countdownWindowHours:24,
  // A launch whose published time has just passed stays in the window for this long, so a pending
  // confirmation is visible instead of silently vanishing.
  passedGraceHours:2,
  soonWindowDays:7,
  maxCards:60,
  maxPeriods:12,
  // Beyond this many kilometres a launch is very unlikely to matter to a local observing plan, but the
  // schedule itself is still worth knowing. A presentation hint, never a visibility claim.
  relevantKm:2000
});
const PERIOD_KINDS=Object.freeze(['month','quarter','half','year','unknown']);

function validateFeed(data){
  if(!data||typeof data!=='object')return {ok:false,available:false,reason:'no launch feed could be loaded'};
  if(data.schema!==SCHEMA)return {ok:false,available:false,reason:'unexpected launch feed schema '+String(data.schema)};
  if(data.available===false)return {ok:true,available:false,notice:data.notice||data.stale_reason||'the launch schedule is unavailable',reason:data.stale_reason||null};
  if(!Array.isArray(data.launches))return {ok:false,available:false,reason:'the launch feed has no launch list'};
  if(!Number.isFinite(Date.parse(data.generated_at)))return {ok:false,available:false,reason:'the launch feed has no usable generation time'};
  return {ok:true,available:true,notice:null,reason:null};
}

function precisionOf(record){
  const precision=record&&record.precision?record.precision:{kind:'unknown',exact:false,dated:false,countdown:false};
  return {kind:precision.kind,exact:!!precision.exact,dated:!!precision.dated,countdown:!!precision.countdown,name:precision.name||null};
}

function periodRange(record){
  const precision=precisionOf(record);
  const net=Date.parse(record&&record.net);
  if(PERIOD_KINDS.includes(precision.kind)&&precision.kind!=='unknown'){
    if(!Number.isFinite(net))return null;
    const date=new Date(net),year=date.getUTCFullYear(),month=date.getUTCMonth();
    if(precision.kind==='month')return {start:Date.UTC(year,month,1),end:Date.UTC(year,month+1,1)-1};
    if(precision.kind==='quarter'){const first=Math.floor(month/3)*3;return {start:Date.UTC(year,first,1),end:Date.UTC(year,first+3,1)-1};}
    if(precision.kind==='half'){const first=month<6?0:6;return {start:Date.UTC(year,first,1),end:Date.UTC(year,first+6,1)-1};}
    return {start:Date.UTC(year,0,1),end:Date.UTC(year+1,0,1)-1};
  }
  if(precision.kind==='day'&&Number.isFinite(net)){
    const date=new Date(net);
    return {start:Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()),end:Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)-1};
  }
  if(precision.exact&&Number.isFinite(net))return {start:net,end:net};
  return null;
}

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
/* A period-only schedule is described as the provider published it: a month, a quarter, a half-year
   or a year. It is never converted into a date. */
function periodLabel(record){
  const precision=precisionOf(record);
  const net=Date.parse(record&&record.net);
  if(precision.kind==='day'){
    if(!Number.isFinite(net))return 'date published but unreadable';
    const date=new Date(net);
    return date.getUTCDate()+' '+MONTHS[date.getUTCMonth()]+' '+date.getUTCFullYear()+' (UTC date; no time published)';
  }
  if(!PERIOD_KINDS.includes(precision.kind)||precision.kind==='unknown'||!Number.isFinite(net))return 'no date published yet';
  const date=new Date(net),year=date.getUTCFullYear(),month=date.getUTCMonth();
  if(precision.kind==='month')return MONTHS[month]+' '+year+' (month announced, no day published)';
  if(precision.kind==='quarter')return 'Q'+String(Math.floor(month/3)+1)+' '+year+' (quarter announced, no day published)';
  if(precision.kind==='half')return (month<6?'first':'second')+' half of '+year+' (period announced, no day published)';
  return String(year)+' (year announced, no day published)';
}

function windowLabel(horizon){return horizon==='extended'?'the next 90 days':horizon==='week'?'the next 7 days':'tonight';}

function overlaps(range,start,end){return !!range&&range.start<=end&&range.end>=start;}
function utcDayKey(t){return new Date(t).toISOString().slice(0,10);}

/* Which launches belong to the selected planning window.
 *  - a launch with a published time belongs to the window its time falls in;
 *  - a launch with only a published day belongs to the window its UTC date falls in, and is marked
 *    dateOnly so no time can ever be displayed for it;
 *  - a launch with only a period announced is never placed in a window. It is reported separately and
 *    only when the announced period actually contains the window, so "October 2026" can be visible
 *    tonight without pretending that it happens tonight. */
function selectForWindow(feed,{start,end,horizon='tonight',now=Date.now()}={}){
  const launches=feed&&Array.isArray(feed.launches)?feed.launches:[];
  const dated=[],periods=[];
  let completed=0;
  const windowStart=Number.isFinite(start)?start:now;
  const windowEnd=Number.isFinite(end)?end:Math.max(windowStart,now);
  for(const record of launches){
    if(!record)continue;
    const status=record.status&&record.status.kind;
    if(status==='success'||status==='failure'){completed+=1;continue;}
    const precision=precisionOf(record);
    const net=Date.parse(record.net);
    if(precision.exact){
      if(Number.isFinite(net)&&net>=windowStart&&net<=windowEnd)dated.push({record,when:net,dateOnly:false});
      continue;
    }
    if(precision.kind==='day'){
      if(!Number.isFinite(net))continue;
      const day=utcDayKey(net);
      if(day>=utcDayKey(windowStart)&&day<=utcDayKey(windowEnd))dated.push({record,when:net,dateOnly:true});
      continue;
    }
    const range=periodRange(record);
    // A period is only reported when it reaches into the window. A launch whose precision this page
    // does not recognise has no period at all, so it is always listed as undated rather than dropped.
    if(overlaps(range,windowStart,windowEnd)||(precision.kind==='unknown'&&!range))periods.push({record,range});
  }
  dated.sort((a,b)=>a.when-b.when||String(a.record.id).localeCompare(String(b.record.id)));
  periods.sort((a,b)=>(a.range?a.range.start:0)-(b.range?b.range.start:0)||String(a.record.id).localeCompare(String(b.record.id)));
  return {dated,periods:periods.slice(0,RULES.maxPeriods),periodsTotal:periods.length,completed,horizon,windowStart,windowEnd};
}

/* The local calendar day a launch is filed under: a published time uses the reader's own timezone, a
   published-only day uses its UTC date because that is the date the provider published. */
function localDayKey(t,tz){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));}
  catch{return utcDayKey(t);}
}
function dateKeyFor(record,tz){
  const net=Date.parse(record&&record.net);
  if(!Number.isFinite(net))return null;
  return precisionOf(record).exact?localDayKey(net,tz):utcDayKey(net);
}
function groupByDate(records,tz,{limit=RULES.maxCards}={}){
  const groups=new Map();
  for(const record of records.slice(0,limit)){
    const key=dateKeyFor(record,tz)||'unknown';
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(record);
  }
  return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([key,items])=>({key,items}));
}

function distanceKm(site,pad){
  if(!site||!pad)return null;
  if(![site.lat,site.lon,pad.latitude,pad.longitude].every(value=>Number.isFinite(value)))return null;
  const rad=Math.PI/180,R=6371.0088;
  const dLat=(pad.latitude-site.lat)*rad,dLon=(pad.longitude-site.lon)*rad;
  const lat1=site.lat*rad,lat2=pad.latitude*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return Math.round(2*R*Math.asin(Math.min(1,Math.sqrt(h))));
}
function proximityBand(km){
  if(!Number.isFinite(km))return {band:'unknown',label:'distance from the launch site unknown'};
  if(km<=RULES.proximityKm.veryClose)return {band:'very-close',label:'very close to the launch site'};
  if(km<=RULES.proximityKm.nearby)return {band:'nearby',label:'a few hundred kilometres from the launch site'};
  if(km<=RULES.proximityKm.regional)return {band:'regional',label:'in the same broad region as the launch site'};
  return {band:'distant',label:'far from the launch site'};
}
/* Real solar geometry at the observer: measurable, and useful context. It is not a prediction of a
   visible plume. */
function twilightBand(sunAltitudeDeg){
  if(!Number.isFinite(sunAltitudeDeg))return {band:'unknown',label:'sun position unknown'};
  if(sunAltitudeDeg>0)return {band:'daylight',label:'daylight'};
  if(sunAltitudeDeg>-6)return {band:'civil',label:'civil twilight'};
  if(sunAltitudeDeg>-12)return {band:'nautical',label:'nautical twilight'};
  if(sunAltitudeDeg>-18)return {band:'astronomical',label:'astronomical twilight'};
  return {band:'night',label:'full darkness'};
}

/* Local relevance: distance to the launch site plus the real position of the Sun at the published
   time. Local visibility is always 'unknown' and no bearing, elevation, duration or probability is
   produced, because the provider publishes no ascent trajectory. */
function relevanceFor(record,site,{sunAltitude=null}={}){
  const km=distanceKm(site&&{lat:site.lat,lon:site.lon},record&&record.pad);
  const proximity=proximityBand(km);
  const precision=precisionOf(record);
  const statements=[];
  if(record&&record.site&&record.site.name)statements.push('Launch site: '+record.site.name+(record.pad&&record.pad.name?' ('+record.pad.name+')':'')+'.');
  if(km===null){
    statements.push('This flight has no published pad coordinates, so no distance from your location can be given.');
  }else{
    statements.push('About '+(km>=1000?(km/1000).toFixed(1)+' thousand km':km+' km')+' from your observing location \u2014 '+proximity.label+'.');
  }
  let sun=null,twilight=null;
  if(typeof sunAltitude==='function'&&precision.exact){
    const value=sunAltitude(Date.parse(record.net));
    if(Number.isFinite(value)){sun=value;twilight=twilightBand(value);}
  }
  if(sun!==null){
    statements.push('At the published time the Sun is '+Math.abs(sun).toFixed(0)+'\u00b0 '+(sun<0?'below':'above')+' your horizon ('+twilight.label+').');
  }else if(precision.exact){
    statements.push('The Sun\u2019s position at the published time could not be calculated here.');
  }else{
    statements.push('No time is published for this flight, so twilight timing cannot be assessed.');
  }
  if(proximity.band==='very-close'||proximity.band==='nearby'){
    statements.push('Being near the launch site does not mean the rocket will be visible from where you stand: it climbs away from the pad, and its path is not published here.');
  }
  statements.push('Local visibility: unknown. Confirming a visible rocket or an illuminated exhaust plume needs the ascent trajectory, staging, sunlight and shadow geometry, which this source does not provide.');
  return {
    distanceKm:km,
    proximity:proximity.band,
    proximityLabel:proximity.label,
    sunAltitudeDeg:sun,
    twilight:twilight?twilight.band:null,
    twilightLabel:twilight?twilight.label:null,
    visibility:'unknown',
    statements
  };
}

/* Provider status, kept in the provider's own words where it has them. */
function statusChip(record){
  const status=(record&&record.status)||{kind:'unknown'};
  const label=status.name||'Status not published';
  if(status.kind==='scheduled')return {label,tone:'go',detail:'The provider reports a confirmed launch time.'};
  if(status.kind==='unconfirmed')return {label,tone:'warn',detail:'The provider has not confirmed this schedule.'};
  if(status.kind==='hold')return {label,tone:'warn',detail:'The provider reports this launch as on hold; the published time may not hold.'};
  if(status.kind==='in-flight')return {label,tone:'go',detail:'The provider reports this flight as under way.'};
  if(status.kind==='success')return {label,tone:'done',detail:'The provider reports this launch as successful.'};
  if(status.kind==='failure')return {label,tone:'done',detail:'The provider reports this launch as unsuccessful.'};
  return {label,tone:'warn',detail:'The provider status is not one this page recognises, so nothing is assumed about it.'};
}

const HOUR=3600000,DAY=86400000;
/* A countdown is only offered when the provider published a time and the flight has not been reported
   as launched, completed or failed. A passed time is never described as a liftoff. */
function countdownFor(record,now=Date.now()){
  const precision=precisionOf(record);
  const kind=(record&&record.status&&record.status.kind)||'unknown';
  if(!precision.countdown)return {mode:'none',reason:'precision',text:periodLabel(record)};
  if(kind==='success'||kind==='failure')return {mode:'none',reason:'completed',text:'Outcome reported by the provider'};
  if(kind==='in-flight')return {mode:'none',reason:'in-flight',text:'Reported as under way'};
  if(kind==='unknown')return {mode:'none',reason:'status',text:'Status not recognised; no countdown is shown'};
  const net=Date.parse(record.net);
  if(!Number.isFinite(net))return {mode:'none',reason:'time',text:'Published time unreadable'};
  const remaining=net-now;
  if(remaining<=0)return {mode:'passed',reason:'passed',ms:remaining,text:'Published time has passed; the provider has not published an outcome or a new time yet'};
  if(remaining<=RULES.countdownWindowHours*HOUR)return {mode:'ticking',ms:remaining,text:formatCountdown(remaining)};
  if(remaining<=RULES.soonWindowDays*DAY)return {mode:'soon',ms:remaining,text:'in '+formatDuration(remaining)};
  return {mode:'days',ms:remaining,text:'in '+Math.round(remaining/DAY)+' days'};
}
function formatCountdown(ms){
  const total=Math.max(0,Math.floor(ms/1000));
  const days=Math.floor(total/86400),hours=Math.floor(total%86400/3600),minutes=Math.floor(total%3600/60),seconds=total%60;
  const pad=value=>String(value).padStart(2,'0');
  return 'T\u2212'+(days?days+'d ':'')+pad(hours)+':'+pad(minutes)+':'+pad(seconds);
}
function formatDuration(ms){
  const minutes=Math.max(0,Math.round(ms/60000));
  if(minutes<60)return minutes+' min';
  const hours=Math.floor(minutes/60);
  if(hours<48)return hours+' h '+(minutes%60)+' min';
  return Math.round(hours/24)+' days';
}
function formatLocal(t,tz,clock='24'){
  if(!Number.isFinite(t))return '\u2014';
  try{return new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:clock==='12'}).format(new Date(t));}
  catch{return new Date(t).toISOString().replace('T',' ').slice(0,16)+' UTC';}
}
function formatTime(t,tz,clock='24'){
  if(!Number.isFinite(t))return '\u2014';
  try{return new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',minute:'2-digit',hour12:clock==='12'}).format(new Date(t));}
  catch{return new Date(t).toISOString().slice(11,16)+' UTC';}
}
function changeText(record){
  const change=record&&record.change;
  if(!change)return null;
  if(change.kind==='postponed')return 'Rescheduled later'+(Number.isFinite(change.delta_minutes)?' by '+formatDuration(Math.abs(change.delta_minutes)*60000):'')+' since the previous schedule'+(change.previous_net?' (was '+change.previous_net+')':'');
  if(change.kind==='advanced')return 'Moved earlier'+(Number.isFinite(change.delta_minutes)?' by '+formatDuration(Math.abs(change.delta_minutes)*60000):'')+' since the previous schedule'+(change.previous_net?' (was '+change.previous_net+')':'');
  if(change.kind==='status')return 'Provider status changed from '+String(change.previous_status||'unknown');
  return null;
}
/* Feed freshness, in plain language, computed from the published generation time. */
function freshness(feed,now=Date.now()){
  if(!feed||feed.available===false)return {ageMinutes:null,stale:true,level:'missing',text:'No launch schedule is available right now, so no launch is listed.'};
  const generated=Date.parse(feed.generated_at);
  if(!Number.isFinite(generated))return {ageMinutes:null,stale:true,level:'missing',text:'The launch schedule has no usable generation time, so its freshness is unknown.'};
  const ageMinutes=Math.max(0,Math.round((now-generated)/60000));
  const limit=Number.isFinite(feed.stale_after_minutes)?feed.stale_after_minutes:RULES.staleAfterMinutes;
  const ageText=ageMinutes<60?ageMinutes+' min':ageMinutes<1440?Math.floor(ageMinutes/60)+' h '+ageMinutes%60+' min':Math.floor(ageMinutes/1440)+' days';
  if(feed.stale||ageMinutes>limit)return {ageMinutes,stale:true,level:'stale',text:'The launch schedule is '+ageText+' old'+(feed.stale_reason?' ('+feed.stale_reason+')':'')+'. It may not reflect postponements or cancellations.'};
  return {ageMinutes,stale:false,level:'fresh',text:'The launch schedule was updated '+ageText+' ago'+(feed.source&&feed.source.name?' from '+feed.source.name:'')+'.'};
}
function sourceLine(feed){
  const source=(feed&&feed.source)||{};
  const parts=[];
  if(source.name)parts.push('Source: '+source.name+(source.publisher?' ('+source.publisher+')':''));
  if(source.api_version)parts.push('API '+source.api_version);
  if(source.retrieved_at)parts.push('retrieved '+source.retrieved_at);
  if(source.sha256)parts.push('sha256 '+String(source.sha256).slice(0,12)+'\u2026');
  if(source.attribution)parts.push(source.attribution);
  if(source.rights)parts.push(source.rights);
  return parts;
}
root.OverheadLaunches={SCHEMA,RULES,validateFeed,precisionOf,periodRange,periodLabel,windowLabel,selectForWindow,dateKeyFor,groupByDate,distanceKm,proximityBand,twilightBand,relevanceFor,statusChip,countdownFor,formatCountdown,formatDuration,formatLocal,formatTime,changeText,freshness,sourceLine};
if(typeof module!=='undefined')module.exports=root.OverheadLaunches;
})(typeof self!=='undefined'?self:globalThis);

