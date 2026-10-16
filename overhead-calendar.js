/* Worth Looking Up calendar export (browser module, classic script).
 *
 * Pure iCalendar (RFC 5545) serialization plus the honesty rules for turning a Worth Looking Up
 * observing opportunity into a calendar entry. No DOM, no storage, no network and no engine calls:
 * the caller supplies the normalized discovery event, the raw source record and the helpers it
 * already has (the launch module, the compass function, the optical-aid labels).
 *
 * Rules enforced here:
 *  - an entry is only produced from a defensible start and end (or a provider-published date), never
 *    from a placeholder timestamp, an announced period or an invented duration;
 *  - precisely timed entries are serialized as UTC instants, so the reader's own calendar application
 *    renders them in the reader's timezone, across daylight-saving folds and midnight crossings;
 *  - a rocket launch entry is always TENTATIVE and says so in words; local visibility is never claimed;
 *  - a broad launch period (month, quarter, half-year, year) is refused rather than turned into a date.
 *
 * UIDs are derived only from the stable source identifier (never from a title, a displayed timezone
 * or a schedule change), so a later export of the same source event reuses the same UID.
 */
(function(root){
'use strict';
const CRLF='\r\n';
const FOLD_OCTETS=75;
const PRODID='-//Worth Looking Up//Observing calendar//EN';
const CALENDAR_NAME='Worth Looking Up';
const PLAN_NAME='Worth Looking Up observing plan';
const UID_DOMAIN='worthlookingup.com';
const SITE_URL='https://worthlookingup.com/';
/* Coarse provider precisions that never become a date. */
const BROAD_PERIODS=Object.freeze(['month','quarter','half','year','unknown']);

const encoder=typeof TextEncoder!=='undefined'?new TextEncoder():null;
function octets(text){
  const value=String(text??'');
  if(encoder)return encoder.encode(value).length;
  return encodeURIComponent(value).replace(/%[0-9A-Fa-f]{2}/g,'x').length;
}

/* RFC 5545 3.3.11: backslash, semicolon, comma and newline are escaped; nothing else. */
function escapeText(value){
  return String(value??'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r\n|\r|\n/g,'\\n');
}
/* RFC 5545 3.1: fold at 75 octets, continuation lines begin with one space, never split a character. */
function foldLine(line){
  const text=String(line??'');
  if(octets(text)<=FOLD_OCTETS)return text;
  const parts=[];let current='',size=0;
  for(const character of text){
    const width=octets(character);
    if(size+width>FOLD_OCTETS){parts.push(current);current=' '+character;size=1+width;}
    else{current+=character;size+=width;}
  }
  parts.push(current);
  return parts.join(CRLF);
}

function formatUtc(ms){
  if(!Number.isFinite(ms))return null;
  return new Date(ms).toISOString().slice(0,19).replace(/[-:]/g,'')+'Z';
}
function formatDate(ms){
  if(!Number.isFinite(ms))return null;
  return new Date(ms).toISOString().slice(0,10).replace(/-/g,'');
}
function isoDay(ms){return Number.isFinite(ms)?new Date(ms).toISOString().slice(0,10):null;}
function slug(text){
  return String(text??'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
}
/* Deterministic 32-bit hash, used only to keep a UID unique when a source identifier is not already
   filename-safe. It never changes for the same identifier. */
function shortHash(text){
  let hash=5381;
  const value=String(text??'');
  for(let i=0;i<value.length;i+=1)hash=((hash*33)^value.charCodeAt(i))>>>0;
  return hash.toString(16).padStart(8,'0');
}
/* A stable, product-owned UID. Derived from the category and the source identifier only. */
function uidFor(category, sourceId){
  const key=String(sourceId??'').trim();
  if(!key)return null;
  const safe=slug(key)||'event';
  const suffix=slug(key)===key&&/^[a-z0-9-]+$/.test(key)?'':'-'+shortHash(key);
  return ['wlu',slug(category)||'event',safe].join('-')+suffix+'@'+UID_DOMAIN;
}
/* A safe, descriptive download name: no separators, no traversal, bounded length. */
function filename(label, now, extension){
  const stem=slug(label)||'observing-opportunity';
  const stamp=formatDate(Number.isFinite(now)?now:Date.now());
  return 'worth-looking-up-'+stem+'-'+stamp+'.'+(extension||'ics');
}

const momentFormatters=new Map();
function momentFormatter(timezone, clock){
  const key=String(timezone||'UTC')+'|'+(clock==='12'?'12':'24');
  if(momentFormatters.has(key))return momentFormatters.get(key);
  let formatter=null;
  try{
    formatter=new Intl.DateTimeFormat('en-GB',{timeZone:timezone||'UTC',weekday:'short',day:'numeric',month:'short',
      hour:'2-digit',minute:'2-digit',hour12:clock==='12',timeZoneName:'short'});
  }catch{formatter=null;}
  momentFormatters.set(key,formatter);
  return formatter;
}
function localMoment(ms, timezone, clock){
  if(!Number.isFinite(ms))return null;
  const formatter=momentFormatter(timezone,clock);
  if(!formatter)return formatUtc(ms)+' UTC';
  return formatter.format(new Date(ms));
}
function localRange(start, end, timezone, clock){
  if(start===end)return localMoment(start,timezone,clock);
  return localMoment(start,timezone,clock)+' – '+localMoment(end,timezone,clock);
}
function exportedLine(now){
  return 'Exported '+new Date(now).toISOString().slice(0,10)+' from Worth Looking Up. Conditions, weather and '+
    'predictions change; open '+SITE_URL+' again for refreshed details.';
}
function joinLines(list){return list.filter(line=>line!==null&&line!==undefined&&String(line).trim()!=='').join('\n');}
/* ---- category rules -----------------------------------------------------
   Each builder returns {eligible:true, event} or {eligible:false, reason}. The reason is shown in the
   interface, so a reader learns why an opportunity cannot become a precise appointment yet. */

function siteLabel(options){
  const name=options.site&&options.site.name?String(options.site.name):null;
  const timezone=options.timezone?String(options.timezone):null;
  if(name&&timezone)return name+' ('+timezone+')';
  return name||timezone||null;
}
/* Recommended viewing direction, only when the geometry actually produced one. */
function directionFor(source, options){
  const compass=typeof options.compass==='function'?options.compass:null;
  const positions=(source&&Array.isArray(source.positions)?source.positions:[]).filter(position=>position&&Number.isFinite(position.altitude));
  if(!positions.length)return null;
  const best=positions.slice().sort((a,b)=>(b.altitude||-90)-(a.altitude||-90))[0];
  let bearing=best.compass||null;
  if(!bearing&&compass&&Number.isFinite(best.azimuth))bearing=compass(best.azimuth);
  if(!bearing)return null;
  return String(best.name||'The object')+' is about '+Math.round(best.altitude)+'\u00b0 up towards '+bearing+' at the best moment.';
}
function opticalFor(event, options){
  if(!event.optical)return null;
  const label=typeof options.opticalLabel==='function'?options.opticalLabel(event.optical):null;
  return label||String(event.optical);
}
/* For a pass, the direction changes through the pass, so all three calculated bearings are given. */
function satelliteDirection(source, options){
  const compass=typeof options.compass==='function'?options.compass:null;
  if(!compass||!source)return null;
  const point=value=>value&&Number.isFinite(value.az)?compass(value.az)+(Number.isFinite(value.el)?' ('+Math.round(value.el)+'\u00b0 up)':''):null;
  const entry=point(source.entry),peak=point(source.peak),exit=point(source.exit);
  if(!entry&&!peak&&!exit)return null;
  const parts=[];
  if(entry)parts.push('appears '+entry);
  if(peak)parts.push('highest '+peak);
  if(exit)parts.push('disappears '+exit);
  return 'look '+parts.join(', ')+'.';
}
function categoryLabel(category){
  switch(category){
    case 'satellites':return 'Satellites';
    case 'planets':return 'Planets & alignments';
    case 'meteors':return 'Meteor showers';
    case 'comets':return 'Comets & special events';
    case 'launches':return 'Rocket launches';
    default:return 'Observing opportunity';
  }
}

/* Satellite passes and calculated celestial opportunities: both ends of a real window, or one
   calculated instant. A missing endpoint is refused rather than padded to an arbitrary duration. */
function opportunityEvent(event, options, now){
  if(!event||typeof event!=='object')return {eligible:false,reason:'No observing opportunity was supplied.'};
  const start=event.start, end=event.end;
  if(!Number.isFinite(start)||!Number.isFinite(end))
    return {eligible:false,reason:'This opportunity has no start and end time, so no calendar appointment is created.'};
  if(end<start)return {eligible:false,reason:'This opportunity has an inconsistent observing window, so no calendar appointment is created.'};
  const instant=end===start;
  const uid=uidFor(event.category,event.sourceId);
  if(!uid)return {eligible:false,reason:'This opportunity has no stable identifier, so no calendar entry can be updated later.'};
  const satellite=event.category==='satellites';
  const train=satellite&&String(event.circumstance||'').startsWith('train:');
  const summary=satellite?String(event.title||'Satellite')+(train?' train pass':' pass'):String(event.title||'Observing opportunity');
  const direction=satellite?satelliteDirection(options.source,options):directionFor(options.source,options);
  const equipment=satellite?null:opticalFor(event,options);
  const score=Number.isFinite(event.categoryPriority)&&typeof options.scoreLabel==='function'
    ?'Local sighting score '+event.categoryPriority+'/100 ('+options.scoreLabel(event.categoryPriority)+') \u2014 a local recommendation, not a guarantee of visibility.' : null;
  const description=joinLines([
    event.explanation?String(event.explanation):null,
    '',
    instant?'Best moment: '+localMoment(start,options.timezone,options.clock)+' \u2014 a calculated instant, not a duration.'
      :'Observing window: '+localRange(start,end,options.timezone,options.clock)+' (local time at '+siteLabel(options)+').',
    satellite?'This is a calculated pass prediction from published orbital elements, not an observation.':null,
    direction?'Facing: '+direction:null,
    equipment?'Equipment: '+equipment+'.':null,
    event.weatherSummary?'Weather: '+String(event.weatherSummary)+'.':null,
    score,
    ...(event.warnings||[]).map(text=>'Note: '+String(text)),
    '',
    'Source: '+String(event.source||'Worth Looking Up local calculation')+'.',
    exportedLine(now),
    SITE_URL
  ]);
  return {eligible:true,event:{uid,summary,description,location:siteLabel(options),url:SITE_URL,
    allDay:false,start,end,instant,sortKey:start,categories:['Worth Looking Up',categoryLabel(event.category)]}};
}


/* Rocket launches. A published time is a target, never a confirmed liftoff; a published date is an
   all-day placeholder with no invented time; a broad announced period is refused outright. */
function launchEvent(event, options, now){
  const L=options.launches||null;
  const record=options.source||null;
  if(!event||!record)return {eligible:false,reason:'This launch has no published record to describe, so no calendar entry is created.'};
  if(!L||typeof L.precisionOf!=='function')return {eligible:false,reason:'The launch schedule module is unavailable, so no calendar entry is created.'};
  const uid=uidFor('launches',event.sourceId||record.id);
  if(!uid)return {eligible:false,reason:'This launch has no stable provider identifier, so no calendar entry can be updated later.'};
  const precision=L.precisionOf(record);
  const status=L.statusChip(record);
  const statusKind=(record.status&&record.status.kind)||'unknown';
  const name=String(record.name||event.title||'Scheduled launch');
  const net=Date.parse(record.net);
  const attribution=String(event.source||'Launch data: The Space Devs Launch Library 2');
  const links=[...(record.links&&record.links.info)||[],...(record.links&&record.links.webcast)||[]];
  const providerUrl=(record.links&&record.links.ll2)||null;
  const change=typeof L.changeText==='function'?L.changeText(record):null;
  const freshness=options.feed&&typeof L.freshness==='function'?L.freshness(options.feed,now):null;
  const site=record.site&&record.site.name?String(record.site.name):null;
  const pad=record.pad&&record.pad.name?String(record.pad.name):null;
  const location=[site,pad].filter(Boolean).join(' \u00b7 ')||siteLabel(options);
  const base=[];
  base.push('Vehicle: '+String(record.vehicle||'not published')+'.');
  base.push('Provider: '+String(record.provider||'not published')+'.');
  if(site)base.push('Launch site: '+location+'.');
  base.push('Provider status: '+status.label+' \u2014 '+status.detail);
  base.push('Scheduling precision: '+(precision.exact
    ?'the provider published a time, accurate to the '+String(precision.name||'second').toLowerCase()+'.'
    :'the provider published a date but no time of day.'));
  if(record.last_updated)base.push('Provider last updated this record: '+localMoment(Date.parse(record.last_updated),options.timezone,options.clock)+'.');
  if(change)base.push(change+'.');
  if(freshness)base.push('Schedule age: '+freshness.text);
  const visibility='Local visibility: unknown. Confirming a visible rocket or an illuminated exhaust plume needs the ascent '+
    'trajectory, staging, sunlight and shadow geometry, which this source does not provide.';
  const catalogue=['Source: '+attribution+'.'];
  if(providerUrl)catalogue.push('Provider record: '+providerUrl);
  for(const link of links.slice(0,3))if(link&&link.url)catalogue.push('More information: '+link.url);
  const tail=[...catalogue,exportedLine(now),SITE_URL];
  if(statusKind==='success'||statusKind==='failure'||statusKind==='in-flight')
    return {eligible:false,reason:'The provider reports this launch as completed or under way, so no future appointment is created.'};
  if(precision.exact){
    if(!Number.isFinite(net))return {eligible:false,reason:'The published launch time cannot be read, so no calendar entry is created.'};
    if(net<=now)return {eligible:false,reason:'The published launch time has already passed, so no future appointment is created.'};
    const padTime=record.site&&record.site.timezone?localMoment(net,record.site.timezone,options.clock):null;
    const window=(record.window&&Number.isFinite(Date.parse(record.window.start))&&Number.isFinite(Date.parse(record.window.end)))
      ?'Provider launch window: '+localRange(Date.parse(record.window.start),Date.parse(record.window.end),options.timezone,options.clock)+'.' : null;
    const description=joinLines([
      'Published target time for '+name+' from '+String(record.provider||'the provider')+'.',
      '',
      'Target time: '+localMoment(net,options.timezone,options.clock)+' your time'+(padTime?' ('+padTime+' at the launch site)':'')+'.',
      window,
      ...base,
      '',
      'Tentative: this is a published target time, not a confirmed liftoff. Rocket launches are postponed, held '+
        'and cancelled frequently; check the provider before travelling.',
      visibility,
      '',
      ...tail
    ]);
    return {eligible:true,event:{uid,summary:'Launch (published target time): '+name,description,location,url:SITE_URL,
      status:'TENTATIVE',allDay:false,start:net,end:null,instant:true,sortKey:net,categories:['Worth Looking Up','Rocket launches']}};
  }
  if(precision.kind==='day'){
    if(!Number.isFinite(net))return {eligible:false,reason:'The published launch date cannot be read, so no calendar entry is created.'};
    if(net+86400000<=now)return {eligible:false,reason:'The published launch date has already passed, so no future appointment is created.'};
    const day=isoDay(net);
    const description=joinLines([
      'Tentative launch date for '+name+' from '+String(record.provider||'the provider')+'.',
      '',
      'Published date: '+day+' (the date the provider published). No time of day is published, so this entry is '+
        'an all-day placeholder and no liftoff time is shown or implied.',
      ...base,
      '',
      'Tentative: a published date is not a confirmed liftoff, and it is not a time. Rocket launches are postponed, '+
        'held and cancelled frequently; check the provider before travelling.',
      visibility,
      '',
      ...tail
    ]);
    return {eligible:true,event:{uid,summary:'Launch date (tentative, no time published): '+name,description,location,url:SITE_URL,
      status:'TENTATIVE',allDay:true,date:day,start:null,end:null,sortKey:Date.parse(day+'T00:00:00Z'),
      categories:['Worth Looking Up','Rocket launches'],transparency:'TRANSPARENT'}};
  }
  const period=typeof L.periodLabel==='function'?L.periodLabel(record):'a broad announced period';
  return {eligible:false,reason:'Schedule not precise enough for calendar \u2014 '+period+'.',periodOnly:true};
}
/* One calendar entry from one discovery event. */
function describe(event, options){
  const settings=options||{};
  const now=Number.isFinite(settings.now)?settings.now:Date.now();
  const built=event&&event.category==='launches'?launchEvent(event,settings,now):opportunityEvent(event,settings,now);
  if(!built.eligible)return built;
  built.event.dtstamp=now;
  built.event.created=Number.isFinite(settings.createdAt)?settings.createdAt:now;
  built.event.lastModified=now;
  built.event.sequence=Number.isFinite(settings.sequence)?Math.max(0,Math.floor(settings.sequence)):0;
  return built;
}
function entrySource(entry){return entry&&entry.event?entry.event:entry;}
function entryOptions(entry, options){
  const settings=options||{};
  return {...settings,source:entry&&entry.source?entry.source:settings.source,
    sequence:entry&&entry.sequence,createdAt:entry&&entry.createdAt};
}
function describeAll(entries, options){
  const events=[],skipped=[];
  for(const entry of entries||[]){
    const source=entrySource(entry);
    const result=describe(source,entryOptions(entry,options));
    if(result.eligible)events.push(result.event);else skipped.push({id:source&&source.id,reason:result.reason});
  }
  return {events,skipped};
}
function sortEvents(events){
  return events.slice().sort((a,b)=>(a.sortKey-b.sortKey)||String(a.uid).localeCompare(String(b.uid)));
}
/* Repeated selections of the same source event collapse to one entry; the first selection wins, so a
   reader's explicit choice is never silently replaced by a later snapshot. */
function dedupe(entries){
  const seen=new Map();
  for(const entry of entries||[]){
    const key=String((entrySource(entry)||{}).id||'');
    if(!key||seen.has(key))continue;
    seen.set(key,entry);
  }
  return [...seen.values()];
}
/* RFC 5545 property lines. Names and parameters are never escaped; every text value is. */
function veventFields(item){
  const fields=[];
  fields.push('UID:'+String(item.uid));
  fields.push('DTSTAMP:'+formatUtc(item.dtstamp));
  if(Number.isFinite(item.created))fields.push('CREATED:'+formatUtc(item.created));
  if(Number.isFinite(item.lastModified))fields.push('LAST-MODIFIED:'+formatUtc(item.lastModified));
  if(Number.isFinite(item.sequence))fields.push('SEQUENCE:'+String(item.sequence));
  if(item.allDay){
    fields.push('DTSTART;VALUE=DATE:'+String(item.date).replace(/-/g,''));
    fields.push('DTEND;VALUE=DATE:'+formatDate(Date.parse(item.date+'T00:00:00Z')+86400000));
  }else{
    fields.push('DTSTART:'+formatUtc(item.start));
    if(Number.isFinite(item.end)&&item.end>item.start)fields.push('DTEND:'+formatUtc(item.end));
  }
  fields.push('SUMMARY:'+escapeText(item.summary));
  if(item.description)fields.push('DESCRIPTION:'+escapeText(item.description));
  if(item.location)fields.push('LOCATION:'+escapeText(item.location));
  if(item.url)fields.push('URL:'+escapeText(item.url));
  if(item.status)fields.push('STATUS:'+String(item.status));
  if(item.transparency)fields.push('TRANSP:'+String(item.transparency));
  if(item.categories&&item.categories.length)fields.push('CATEGORIES:'+escapeText(item.categories.join(',')));
  return fields;
}
/* Serialize already-built events. Every logical line is folded and the document uses CRLF only. */
function serialize(events, options){
  const settings=options||{};
  const now=Number.isFinite(settings.now)?settings.now:Date.now();
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:'+PRODID,'CALSCALE:GREGORIAN','METHOD:'+(settings.method||'PUBLISH'),
    'X-WR-CALNAME:'+escapeText(settings.name||CALENDAR_NAME)];
  for(const item of events||[]){
    if(!item||!item.uid)continue;
    lines.push('BEGIN:VEVENT',...veventFields(item),'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF)+CRLF;
}
/* One calendar entry from one event, ready to download. */
function single(entry, options){
  const settings=options||{};
  const now=Number.isFinite(settings.now)?settings.now:Date.now();
  const source=entrySource(entry);
  const built=describe(source,entryOptions(entry,settings));
  if(!built.eligible)return {...built,ics:null,name:null};
  return {eligible:true,event:built.event,ics:serialize([built.event],{now,name:settings.name||CALENDAR_NAME}),
    name:filename(settings.label||source.title||'observing-opportunity',now,'ics')};
}
/* A whole observing plan in one file, deduplicated and in chronological order. */
function itinerary(entries, options){
  const settings=options||{};
  const now=Number.isFinite(settings.now)?settings.now:Date.now();
  const {events,skipped}=describeAll(dedupe(entries),settings);
  const ordered=sortEvents(events);
  return {events:ordered,skipped,count:ordered.length,
    ics:ordered.length?serialize(ordered,{now,name:settings.name||PLAN_NAME}):null,
    name:filename(settings.label||'observing-plan',now,'ics')};
}
root.OverheadCalendar={CRLF,FOLD_OCTETS,PRODID,CALENDAR_NAME,PLAN_NAME,UID_DOMAIN,SITE_URL,BROAD_PERIODS,
  octets,escapeText,foldLine,formatUtc,formatDate,isoDay,slug,shortHash,uidFor,filename,localMoment,localRange,
  describe,describeAll,serialize,single,itinerary,dedupe,sortEvents,veventFields,categoryLabel};
if(typeof module!=='undefined')module.exports=root.OverheadCalendar;
})(typeof self!=='undefined'?self:globalThis);

