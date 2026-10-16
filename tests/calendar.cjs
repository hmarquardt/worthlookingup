/* Calendar export regression: RFC 5545 structure, CRLF, UTF-8 line folding, escaping, stable UIDs,
   UTC/DST/midnight correctness, observing windows versus calculated instants, launch precision
   (exact, date-only, broad period, cancelled, postponed, stale), multiple-event serialization,
   deduplication, source links, safe titles/filenames and the refusal to invent precision.
   Generated output is also parsed by an independent standards implementation (ical.js, a
   development-only dependency; it is never shipped to the browser).
   Run: node tests/calendar.cjs */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../overhead-calendar.js'),D=require('../overhead-discovery.js'),L=require('../overhead-launches.js');
const ICAL=require('ical.js');
const feed=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/launches/upcoming.json'),'utf8'));
const NOW=Date.parse('2026-10-15T20:00:00Z');
const COMPASS=az=>['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(az/22.5)%16];
const site={name:'Princeton, Indiana',lat:38.3553,lon:-87.5675,tz:'America/Chicago'};
const options=extra=>({now:NOW,site,timezone:site.tz,clock:'12',launches:L,feed,compass:COMPASS,
  scoreLabel:value=>value>=75?'Excellent':value>=40?'Possible':'Poor',opticalLabel:value=>value||'Unknown',...extra});

/* ---- helpers ------------------------------------------------------------ */
const physicalLines=ics=>ics.split('\r\n');
const unfold=ics=>ics.split('\r\n').filter(line=>line!=='')
  .reduce((list,line)=>{if(line.startsWith(' '))list[list.length-1]+=line.slice(1);else list.push(line);return list;},[]);
const property=(ics,name)=>{
  const match=unfold(ics).find(line=>line===name||line.startsWith(name+':')||line.startsWith(name+';'));
  if(!match)return null;
  const colon=match.indexOf(':');
  return {head:match.slice(0,colon),value:match.slice(colon+1)};
};
const decode=value=>String(value).replace(/\\n/gi,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\');
const vevents=ics=>{
  const out=[];let current=null;
  for(const line of unfold(ics)){
    if(line==='BEGIN:VEVENT')current={};
    else if(line==='END:VEVENT'){out.push(current);current=null;}
    else if(current){const colon=line.indexOf(':');current[line.slice(0,colon)]=line.slice(colon+1);}
  }
  return out;
};
const satelliteEvent=(overrides={})=>({id:'satellites:25544-1760000000000',sourceId:'25544-1760000000000',category:'satellites',
  title:'ISS (ZARYA)',start:Date.parse('2026-10-16T00:01:05Z'),end:Date.parse('2026-10-16T00:06:05Z'),
  best:Date.parse('2026-10-16T00:03:00Z'),precision:'interval',classification:'local-opportunity',categoryPriority:78,
  circumstance:'object:25544',explanation:'48\u00b0 peak \u00b7 5 min useful visibility',
  warnings:['Orbital elements may be stale; future predictions are uncertain.'],
  source:'CelesTrak orbital elements \u00b7 local SGP4 calculation',...overrides});
const pass={entry:{az:30,el:5},peak:{az:75,el:48},exit:{az:150,el:10}};
const celestialEvent=(overrides={})=>({id:'planets:conjunction:jupiter-venus',sourceId:'planets:conjunction:jupiter-venus',
  category:'planets',title:'Close approach: Jupiter and Venus',start:Date.parse('2026-10-16T01:00:00Z'),
  end:Date.parse('2026-10-16T03:00:00Z'),best:Date.parse('2026-10-16T02:00:00Z'),precision:'window',
  classification:'local-opportunity',categoryPriority:88,optical:'telescope',explanation:'4\u00b0 apart',
  weatherSummary:'Forecast: 12% cloud \u00b7 24000 m visibility \u00b7 0 mm precipitation',
  warnings:['Equipment: Telescope'],source:'Astronomy Engine',...overrides});
const launchEvent=record=>({id:'launches:'+record.id,sourceId:record.id,category:'launches',
  title:record.mission||record.name,precision:record.precision.kind,
  start:record.precision.exact?Date.parse(record.net):null,source:feed.source.attribution});
const exactRecord=feed.launches.find(record=>record.precision.exact&&Date.parse(record.net)>NOW);
const dayRecord=feed.launches.find(record=>record.precision.kind==='day'&&Date.parse(record.net)>NOW);
const monthRecord=feed.launches.find(record=>record.precision.kind==='month');
const yearRecord=feed.launches.find(record=>record.precision.kind==='year');
assert.ok(exactRecord&&dayRecord&&monthRecord&&yearRecord,'the committed launch feed must still contain every precision used here');

/* ---- 1. escaping and structure ------------------------------------------ */
assert.equal(C.escapeText('a,b;c\\d\ne'),'a\\,b\\;c\\\\d\\ne');
assert.equal(C.escapeText('line1\r\nline2'),'line1\\nline2');
assert.equal(C.escapeText('line1\rline2'),'line1\\nline2');
assert.equal(C.escapeText(null),'');
const weird=satelliteEvent({title:'Comet 12P/Pons-Brooks; "odd, name" \\ test\nsecond line',source:'Source; with, commas'});
const weirdOut=C.single({event:weird,source:pass},options());
const weirdSummary=property(weirdOut.ics,'SUMMARY').value;
assert.equal(decode(weirdSummary),'Comet 12P/Pons-Brooks; "odd, name" \\ test\nsecond line pass');
assert.ok(weirdSummary.includes('\\;')&&weirdSummary.includes('\\,')&&weirdSummary.includes('\\\\'),'escaping is present in the raw value');
assert.ok(property(weirdOut.ics,'DESCRIPTION').value.includes('Source\\; with\\, commas'),'the upstream source line is escaped too');

/* ---- 2. CRLF, folding and UTF-8 safety --------------------------------- */
assert.equal(C.CRLF,'\r\n');
assert.ok(weirdOut.ics.endsWith('\r\n'),'a document ends with CRLF');
assert.equal(/[^\r]\n/.test(weirdOut.ics),false,'there is no bare LF anywhere');
assert.equal(/\r[^\n]/.test(weirdOut.ics),false,'there is no bare CR anywhere');
for(const line of physicalLines(weirdOut.ics))assert.ok(C.octets(line)<=75,'every physical line is at most 75 octets ('+C.octets(line)+')');
assert.ok(physicalLines(weirdOut.ics).some(line=>line.startsWith(' ')),'a long description is folded');
assert.ok(unfold(weirdOut.ics).some(line=>line.startsWith('DESCRIPTION:')&&line.length>75),'unfolding restores the logical line');
const emoji=satelliteEvent({title:'Test \u2014 \u00e9\u00e8\u00ea \u4e2d\u6587 \ud83d\ude80 pass',explanation:'\u00b0\u00b0\u00b0'.repeat(40)});
const emojiOut=C.single({event:emoji,source:pass},options());
assert.equal(decode(property(emojiOut.ics,'SUMMARY').value),'Test \u2014 \u00e9\u00e8\u00ea \u4e2d\u6587 \ud83d\ude80 pass pass');
for(const line of physicalLines(emojiOut.ics))assert.ok(C.octets(line)<=75,'folded lines stay within the octet limit with multi-byte text');
assert.equal(Buffer.from(emojiOut.ics,'utf8').toString('utf8'),emojiOut.ics,'the document is valid UTF-8');

/* ---- 3. VCALENDAR and VEVENT structure --------------------------------- */
const lines=unfold(weirdOut.ics);
assert.equal(lines[0],'BEGIN:VCALENDAR');
assert.equal(lines[lines.length-1],'END:VCALENDAR');
for(const required of ['VERSION:2.0','CALSCALE:GREGORIAN','BEGIN:VEVENT','END:VEVENT'])
  assert.ok(lines.includes(required),'document contains '+required);
assert.match(property(weirdOut.ics,'PRODID').value,/Worth Looking Up/);
assert.equal(property(weirdOut.ics,'METHOD').value,'PUBLISH');
const event=vevents(weirdOut.ics)[0];
for(const required of ['UID','DTSTAMP','DTSTART','SUMMARY'])assert.ok(event[required],'VEVENT has '+required);
assert.match(event.DTSTAMP,/^\d{8}T\d{6}Z$/);
assert.match(event.CREATED,/^\d{8}T\d{6}Z$/);
assert.match(event['LAST-MODIFIED'],/^\d{8}T\d{6}Z$/);
assert.equal(event.SEQUENCE,'0');
assert.equal(event.DTSTART,'20261016T000105Z');
assert.equal(event.DTEND,'20261016T000605Z');
assert.equal(event.LOCATION,'Princeton\\, Indiana (America/Chicago)');
assert.equal(event.URL,C.SITE_URL);
assert.equal(event.CATEGORIES,'Worth Looking Up\\,Satellites');
assert.equal(vevents(weirdOut.ics).length,1,'one event per file');


/* ---- 4. UTC, timezones, DST and midnight crossings --------------------- */
assert.equal(C.formatUtc(Date.parse('2026-10-16T00:01:05Z')),'20261016T000105Z');
assert.equal(C.formatDate(Date.parse('2026-11-01T05:30:00Z')),'20261101');
// A window that crosses a UTC date boundary keeps two distinct instants on two dates.
const utcSpan=satelliteEvent({start:Date.parse('2026-10-15T23:00:00Z'),end:Date.parse('2026-10-16T02:00:00Z')});
const utcSpanOut=C.single({event:utcSpan,source:pass},options());
assert.equal(property(utcSpanOut.ics,'DTSTART').value,'20261015T230000Z');
assert.equal(property(utcSpanOut.ics,'DTEND').value,'20261016T020000Z');
// A window that crosses local midnight at the observing site names both local dates.
const midnight=satelliteEvent({start:Date.parse('2026-10-16T04:00:00Z'),end:Date.parse('2026-10-16T06:00:00Z')});
const midnightOut=C.single({event:midnight,source:pass},options());
assert.equal(property(midnightOut.ics,'DTSTART').value,'20261016T040000Z');
assert.equal(property(midnightOut.ics,'DTEND').value,'20261016T060000Z');
const midnightDescription=decode(property(midnightOut.ics,'DESCRIPTION').value);
assert.match(midnightDescription,/15 Oct/);assert.match(midnightDescription,/16 Oct/);
// A DST fold names both offsets at the observing site, and never a hardcoded one.
for(const [timezone,window,markers] of [
  ['America/Indiana/Indianapolis',['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z'],['GMT-4','GMT-5']],
  ['America/New_York',['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z'],['GMT-4','GMT-5']],
  ['America/Los_Angeles',['2026-11-01T08:30:00Z','2026-11-01T09:30:00Z'],['GMT-7','GMT-8']],
  ['Europe/London',['2026-10-25T00:30:00Z','2026-10-25T01:30:00Z'],['BST','GMT']]]){
  const fold=satelliteEvent({start:Date.parse(window[0]),end:Date.parse(window[1])});
  const out=C.single({event:fold,source:pass},options({site:{name:'Test site'},timezone}));
  const text=decode(property(out.ics,'DESCRIPTION').value);
  for(const marker of markers)assert.ok(text.includes(marker),timezone+' names '+marker+' in the observing window');
  assert.equal(property(out.ics,'DTSTART').value,C.formatUtc(Date.parse(window[0])),'UTC serialization is unchanged by the display timezone');
  assert.equal(property(out.ics,'DTEND').value,C.formatUtc(Date.parse(window[1])));
}
// Arizona does not observe daylight saving: the same UTC offset in July and January.
const arizona=ms=>C.localMoment(ms,'America/Phoenix','24');
assert.match(arizona(Date.parse('2026-07-01T05:00:00Z')),/, 22:00 GMT-7$/);
assert.match(arizona(Date.parse('2026-01-15T05:00:00Z')),/, 22:00 GMT-7$/);
// The visitor's own timezone never appears in the serialized instants; the observing site's zone does.
assert.equal(C.localMoment(Date.parse('2026-10-16T00:01:05Z'),'Europe/Berlin','24'),'Fri 16 Oct, 02:01 CEST');
assert.equal(C.localMoment(Date.parse('2026-10-16T00:01:05Z'),'Pacific/Auckland','24'),'Fri 16 Oct, 13:01 GMT+13');
assert.equal(C.localMoment(Date.parse('2026-10-16T00:01:05Z'),'America/Chicago','24'),'Thu 15 Oct, 19:01 GMT-5');
assert.equal(C.localMoment(Date.parse('2026-10-16T00:01:05Z'),'Asia/Kolkata','24'),'Fri 16 Oct, 05:31 GMT+5:30');
assert.equal(C.localMoment(Number.NaN,'America/Chicago','24'),null);
assert.equal(C.localMoment(Date.parse('2026-10-16T00:01:05Z'),'Not/AZone','24'),'20261016T000105Z UTC');
// A site timezone different from the visitor's is described, never converted.
const foreign=C.single({event:satelliteEvent(),source:pass},options({site:{name:'Mahia Peninsula'},timezone:'Pacific/Auckland',clock:'24'}));
assert.match(decode(property(foreign.ics,'DESCRIPTION').value),/13:01 GMT\+13/);
assert.equal(property(foreign.ics,'DTSTART').value,'20261016T000105Z');


/* ---- 5. Observing windows versus calculated instants ------------------- */
const instant=celestialEvent({start:Date.parse('2026-10-16T02:00:00Z'),end:Date.parse('2026-10-16T02:00:00Z')});
const instantOut=C.single({event:instant,source:{positions:[{name:'Jupiter',altitude:42,azimuth:135}]}},options());
assert.equal(property(instantOut.ics,'DTEND'),null,'a calculated instant has no invented end');
assert.match(decode(property(instantOut.ics,'DESCRIPTION').value),/calculated instant, not a duration/);
const windowOut=C.single({event:celestialEvent(),source:{positions:[{name:'Jupiter',altitude:42,azimuth:135},{name:'Venus',altitude:20,azimuth:120}]}},options());
assert.equal(property(windowOut.ics,'DTSTART').value,'20261016T010000Z');
assert.equal(property(windowOut.ics,'DTEND').value,'20261016T030000Z');
const windowDescription=decode(property(windowOut.ics,'DESCRIPTION').value);
assert.match(windowDescription,/Observing window:/);
assert.match(windowDescription,/Jupiter is about 42\u00b0 up towards SE at the best moment/);
assert.match(windowDescription,/Equipment: telescope/);
assert.match(windowDescription,/Weather: Forecast: 12% cloud/);
assert.ok(windowDescription.includes('Note: Equipment: Telescope'));
assert.ok(!/duration of (one|1) hour/i.test(windowDescription),'no arbitrary duration is claimed');
// No defensible window: refused rather than padded to a duration.
for(const broken of [{start:NaN,end:Date.parse('2026-10-16T03:00:00Z')},{start:Date.parse('2026-10-16T03:00:00Z'),end:NaN},
  {start:Date.parse('2026-10-16T03:00:00Z'),end:Date.parse('2026-10-16T01:00:00Z')}]){
  const refused=C.describe(celestialEvent(broken),options());
  assert.equal(refused.eligible,false);
  assert.match(refused.reason,/no start and end time|inconsistent observing window/);
}
assert.equal(C.describe(null,options()).eligible,false);
assert.equal(C.describe({id:'x'},options()).eligible,false,'an event with no timing is refused');
// A pass gives all three calculated bearings and no unsupported claim.
const passOut=C.single({event:satelliteEvent(),source:pass},options());
const passDescription=decode(property(passOut.ics,'DESCRIPTION').value);
assert.match(passDescription,/Facing: look appears NNE \(5\u00b0 up\), highest ENE \(48\u00b0 up\), disappears SSE \(10\u00b0 up\)\./);
assert.match(passDescription,/calculated pass prediction from published orbital elements, not an observation/);
assert.match(passDescription,/Local sighting score 78\/100 \(Excellent\)/);
assert.ok(!/naked eye|magnitude/i.test(passDescription),'no unsupported brightness or optical claim for a pass');
// With no compass helper available, no direction is claimed rather than one being guessed.
const noCompass=C.single({event:satelliteEvent(),source:pass},options({compass:null}));
assert.ok(!decode(property(noCompass.ics,'DESCRIPTION').value).includes('Facing:'),'direction is omitted without geometry');

/* ---- 6. Stable identity and safe filenames ----------------------------- */
const base=satelliteEvent();
const uidA=C.uidFor('satellites',base.sourceId);
assert.equal(uidA,'wlu-satellites-25544-1760000000000@worthlookingup.com');
assert.equal(C.uidFor('satellites',base.sourceId),uidA);
assert.notEqual(C.uidFor('satellites',base.sourceId+'1'),uidA);
assert.notEqual(C.uidFor('planets',base.sourceId),uidA);
assert.equal(C.uidFor('satellites',''),null);
assert.equal(C.uidFor('satellites',null),null);
const renamed=C.single({event:{...base,title:'A completely different displayed name'},source:pass},options({label:'other'}));
assert.equal(property(renamed.ics,'UID').value,uidA,'a translated or renamed title never changes the UID');
const laterTime=C.single({event:{...base,start:base.start+90000,end:base.end+90000},source:pass},options());
assert.equal(property(laterTime.ics,'UID').value,uidA,'a shifted prediction keeps the same UID');
assert.equal(property(laterTime.ics,'DTSTART').value,'20261016T000235Z','the shifted window is still serialized');
assert.equal(C.uidFor('celestial','planets:conjunction:jupiter-venus|2026-10-16'),
  'wlu-celestial-planets-conjunction-jupiter-venus-2026-10-16-'+C.shortHash('planets:conjunction:jupiter-venus|2026-10-16')+'@worthlookingup.com');
assert.equal(C.slug('ISS (ZARYA) pass'),'iss-zarya-pass');
assert.equal(C.slug('../../etc/passwd'),'etc-passwd');
assert.equal(C.slug(''),'');
assert.equal(C.filename('ISS (ZARYA) pass',Date.parse('2026-10-16T00:00:00Z')),'worth-looking-up-iss-zarya-pass-20261016.ics');
assert.equal(C.filename('../../etc/passwd',Date.parse('2026-10-16T00:00:00Z')),'worth-looking-up-etc-passwd-20261016.ics');
assert.equal(C.filename('',Date.parse('2026-10-16T00:00:00Z')),'worth-looking-up-observing-opportunity-20261016.ics');
assert.ok(!/[/\\]/.test(C.filename('a/b\\c',Date.parse('2026-10-16T00:00:00Z'))),'no path separator survives');
assert.ok(C.filename('x'.repeat(200),Date.parse('2026-10-16T00:00:00Z')).length<120,'filenames stay short');
// No browser state, coordinates or storage identifiers reach the file.
assert.ok(!weirdOut.ics.includes('overhead.'),'no localStorage key is exported');
assert.ok(!weirdOut.ics.includes('38.3553')&&!weirdOut.ics.includes('-87.5675'),'coordinates are not exported');


/* ---- 7. Launch precision: exact, date-only and broad periods ----------- */
const exactOut=C.single({event:launchEvent(exactRecord),source:exactRecord},options());
assert.equal(exactOut.eligible,true);
const exactVevent=vevents(exactOut.ics)[0];
assert.equal(exactVevent.STATUS,'TENTATIVE','a published target time is always tentative');
assert.equal(exactVevent.DTEND,undefined,'an instantaneous liftoff target has no fabricated end');
assert.equal(exactVevent.DTSTART,C.formatUtc(Date.parse(exactRecord.net)));
const exactText=decode(exactVevent.DESCRIPTION);
assert.match(exactText,/published target time, not a confirmed liftoff/);
assert.match(exactText,/Provider status: /);
assert.match(exactText,/Provider last updated this record: /);
assert.match(exactText,/Local visibility: unknown/);
assert.match(exactText,/ascent trajectory/);
assert.match(exactText,/postponed, held and cancelled frequently/);
assert.match(exactText,/Source: Launch data: The Space Devs Launch Library 2/);
assert.match(exactText,/Provider record: https:\/\/ll\.thespacedevs\.com\//);
assert.ok(exactText.includes(C.SITE_URL),'the entry links back to Worth Looking Up');
assert.ok(!/\bwill be visible\b|\bguarantee\w*\b|\bprobability\b|\bchance of\b|\bmagnitude\b/i.test(exactText),'no visibility or probability claim');
assert.equal(exactVevent.URL,C.SITE_URL);
// A date-only schedule is an all-day placeholder that says it is tentative and has no time.
const dayOut=C.single({event:launchEvent(dayRecord),source:dayRecord},options());
assert.equal(dayOut.eligible,true);
const dayVevent=vevents(dayOut.ics)[0];
assert.equal(dayVevent['DTSTART;VALUE=DATE'],C.formatDate(Date.parse(dayRecord.net)));
assert.equal(dayVevent['DTEND;VALUE=DATE'],C.formatDate(Date.parse(dayRecord.net)+86400000),'an all-day end is exclusive');
assert.equal(dayVevent.DTSTART,undefined,'a date-only schedule never acquires a time');
assert.equal(dayVevent.STATUS,'TENTATIVE');
assert.equal(dayVevent.TRANSP,'TRANSPARENT');
assert.match(decode(dayVevent.SUMMARY),/tentative, no time published/);
assert.match(decode(dayVevent.DESCRIPTION),/no liftoff time is shown or implied/);
const dayPublished=decode(dayVevent.DESCRIPTION).split('Published date:')[1].split('\n')[0];
assert.ok(!/\d{2}:\d{2}/.test(dayPublished),'no time appears beside the published date');
// Broad periods are refused with an explanation, never converted into a date.
for(const record of [monthRecord,yearRecord]){
  const refused=C.single({event:launchEvent(record),source:record},options());
  assert.equal(refused.eligible,false);
  assert.equal(refused.ics,null);
  assert.match(refused.reason,/^Schedule not precise enough for calendar \u2014 /);
  assert.ok(refused.reason.length>40,'the refusal names the announced period');
}
for(const kind of ['quarter','half','unknown']){
  const record={...exactRecord,id:'period-'+kind,precision:{kind,exact:false,dated:false,countdown:false,name:kind},
    net:new Date(NOW+40*86400000).toISOString(),status:{kind:'unconfirmed',name:'To Be Determined'}};
  const refused=C.single({event:launchEvent(record),source:record},options());
  assert.equal(refused.eligible,false,'a '+kind+'-only schedule is refused');
  assert.match(refused.reason,/Schedule not precise enough for calendar/);
}

// A completed, failed or under-way launch is never exported as a future appointment.
for(const kind of ['success','failure','in-flight']){
  const record={...exactRecord,id:'status-'+kind,status:{kind,name:kind}};
  const refused=C.single({event:launchEvent(record),source:record},options());
  assert.equal(refused.eligible,false,'a '+kind+' launch is refused');
  assert.match(refused.reason,/completed or under way/);
}
// A published time that has already passed is not offered as a future appointment.
const passed={...exactRecord,id:'passed',net:new Date(NOW-60000).toISOString()};
assert.match(C.single({event:launchEvent(passed),source:passed},options()).reason,/already passed/);
// A missing or unreadable record is refused rather than guessed.
assert.equal(C.single({event:launchEvent(exactRecord),source:null},options()).eligible,false);
assert.equal(C.describe(launchEvent(exactRecord),options({launches:null})).eligible,false);
assert.equal(C.single({event:launchEvent(exactRecord),source:{...exactRecord,net:'not a date'}},options()).eligible,false);
// A stale schedule is labelled in the exported description.
const staleFeed={...feed,generated_at:new Date(NOW-6*3600000).toISOString()};
const staleText=decode(vevents(C.single({event:launchEvent(exactRecord),source:exactRecord},options({feed:staleFeed})).ics)[0].DESCRIPTION);
assert.match(staleText,/Schedule age: The launch schedule is 6 h 0 min old/);
assert.match(staleText,/may not reflect postponements or cancellations/);
// A postponement is carried into the export, and the UID does not move with it.
const moved={...exactRecord,change:{kind:'postponed',delta_minutes:1440,previous_net:new Date(Date.parse(exactRecord.net)-86400000).toISOString()}};
const movedOut=C.single({event:launchEvent(moved),source:moved},options());
assert.match(decode(vevents(movedOut.ics)[0].DESCRIPTION),/Rescheduled later by 24 h 0 min since the previous schedule/);
assert.equal(vevents(movedOut.ics)[0].UID,exactVevent.UID,'a postponement keeps the same calendar identifier');

/* ---- 8. Multiple events, deduplication and revision -------------------- */
const first={event:satelliteEvent(),source:pass};
const second={event:celestialEvent(),source:{positions:[{name:'Jupiter',altitude:42,azimuth:135}]}};
const third={event:launchEvent(exactRecord),source:exactRecord};
const fourth={event:launchEvent(monthRecord),source:monthRecord};
const plan=C.itinerary([second,first,third,fourth,{...first}],options({label:'observing-plan'}));
assert.equal(plan.count,3,'a broad period is skipped and a repeated selection is deduplicated');
assert.equal(plan.skipped.length,1);
assert.match(plan.skipped[0].reason,/Schedule not precise enough for calendar/);
assert.equal(plan.name,'worth-looking-up-observing-plan-20261015.ics');
assert.equal(vevents(plan.ics).length,3,'one VEVENT per distinct event');
assert.equal(unfold(plan.ics).filter(line=>line==='BEGIN:VCALENDAR').length,1);
const starts=vevents(plan.ics).map(item=>item.DTSTART||item['DTSTART;VALUE=DATE']);
assert.deepEqual(starts,starts.slice().sort(),'the itinerary is chronological');
assert.deepEqual(starts.slice().sort(),
  [C.formatUtc(Date.parse('2026-10-16T00:01:05Z')),C.formatUtc(Date.parse(exactRecord.net)),'20261016T010000Z'].sort(),
  'every selected event appears once, at its own time');
assert.equal(C.dedupe([first,{...first}]).length,1);
assert.equal(C.dedupe([first,second,{...second}]).length,2);
assert.equal(C.dedupe([]).length,0);
// Revision: the same source event re-exported later keeps its UID and reports a higher SEQUENCE.
const revised=C.itinerary([{event:{...base,start:base.start+300000,end:base.end+300000},source:pass,sequence:1}],options());
assert.equal(vevents(revised.ics)[0].UID,uidA);
assert.equal(vevents(revised.ics)[0].SEQUENCE,'1');
assert.equal(vevents(revised.ics)[0].DTSTART,'20261016T000605Z');
// An empty plan produces no calendar at all rather than an empty calendar file.
assert.equal(C.itinerary([],options()).ics,null);
assert.equal(C.itinerary([fourth],options()).ics,null,'a plan of only refused events exports nothing');
assert.equal(C.serialize([]).includes('BEGIN:VEVENT'),false);
assert.equal(C.serialize([{uid:null}]).includes('BEGIN:VEVENT'),false,'an entry without a UID is never serialized');


/* ---- 9. Independent standards parser (ical.js) ------------------------- */
const parsed=new ICAL.Component(ICAL.parse(plan.ics));
assert.equal(parsed.name,'vcalendar');
assert.equal(parsed.getFirstPropertyValue('version'),'2.0');
assert.match(String(parsed.getFirstPropertyValue('prodid')),/Worth Looking Up/);
const parsedEvents=parsed.getAllSubcomponents('vevent');
assert.equal(parsedEvents.length,3);
for(const item of parsedEvents){
  assert.ok(item.getFirstPropertyValue('uid'),'parsed event has a UID');
  assert.ok(item.getFirstPropertyValue('dtstamp'),'parsed event has a DTSTAMP');
  assert.ok(item.getFirstPropertyValue('summary'),'parsed event has a summary');
  assert.ok(item.getFirstPropertyValue('dtstart'),'parsed event has a DTSTART');
}
const parsedSatellite=parsedEvents.find(item=>String(item.getFirstPropertyValue('uid')).includes('satellites'));
assert.equal(parsedSatellite.getFirstPropertyValue('dtstart').toICALString(),'20261016T000105Z');
assert.equal(parsedSatellite.getFirstPropertyValue('dtend').toICALString(),'20261016T000605Z');
assert.equal(String(parsedSatellite.getFirstPropertyValue('summary')),'ISS (ZARYA) pass');
assert.ok(String(parsedSatellite.getFirstPropertyValue('description')).includes('Observing window:'),'the parser sees the unfolded description');
const parsedDay=new ICAL.Component(ICAL.parse(dayOut.ics)).getFirstSubcomponent('vevent');
assert.equal(parsedDay.getFirstPropertyValue('dtstart').toICALString(),C.formatDate(Date.parse(dayRecord.net)));
assert.equal(parsedDay.getFirstPropertyValue('dtend').toICALString(),C.formatDate(Date.parse(dayRecord.net)+86400000));
// The independent parser accepts the special-character document unchanged.
assert.equal(String(new ICAL.Component(ICAL.parse(weirdOut.ics)).getFirstSubcomponent('vevent').getFirstPropertyValue('summary')),
  'Comet 12P/Pons-Brooks; "odd, name" \\ test\nsecond line pass');
// The launch module remains the only source of precision labels: nothing here re-implements them.
assert.equal(C.describe(launchEvent(monthRecord),options({source:monthRecord})).reason,
  'Schedule not precise enough for calendar \u2014 '+L.periodLabel(monthRecord)+'.');
assert.equal(D.launchRecord(exactRecord,{module:L,feed}).precision,L.precisionOf(exactRecord).kind);
assert.equal(D.launchRecord(exactRecord,{module:L,feed}).start,Date.parse(exactRecord.net));
assert.equal(D.launchRecord(monthRecord,{module:L,feed}).start,null,'a period-only schedule carries no timestamp');
console.log('PASS: RFC 5545 structure/CRLF/folding/escaping, UTC+DST+midnight windows, instants, stable UIDs and safe filenames, launch exact/date-only/period/cancelled/passed/stale/postponed rules, multi-event plans, dedupe and revision, verified with an independent ical.js parse ('+
  plan.count+' event itinerary, '+feed.launches.length+' committed launches).');

