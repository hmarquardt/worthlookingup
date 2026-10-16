/* Calendar export in the browser: a real .ics download from a discovery card and from the launch
   calendar, the observing plan (add, deduplicate, review, remove, clear, download one file), mobile
   and keyboard accessibility, both themes, and no new provider request. */
const {test,expect}=require('@playwright/test'),fs=require('node:fs'),path=require('node:path');
test.use({channel:process.env.CI?'chromium':'chrome'});
test.setTimeout(180000);
const NOW=Date.parse('2026-10-08T18:00Z');
const ISS={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-10-08T06:00:00.000000',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,NORAD_CAT_ID:25544,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
const hourly={time:Array.from({length:240},(_,i)=>Math.floor(Date.parse('2026-10-08T00:00Z')/1000)+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:15,visibility:24000,precipitation:0,weather_code:0,temperature_2m:15}))hourly[key]=Array(240).fill(value);
function launch({id,name,net,precision,status='Go for Launch',statusKind='scheduled'}){
  return {id,slug:id,name,mission:name.split('| ').pop(),mission_type:'Communications',mission_description:'A scheduled flight used by the calendar regression.',orbit:'Low Earth Orbit',
   vehicle:'Falcon 9 Block 5',vehicle_family:'Falcon',provider:'SpaceX',provider_abbrev:'SpX',
   site:{name:'Cape Canaveral SFS, FL, USA',timezone:'America/New_York',country:'United States of America'},
   pad:{name:'Space Launch Complex 40',latitude:28.56194122,longitude:-80.57735736},
   status:{id:1,name:status,abbrev:'Go',kind:statusKind},net,precision,window:{start:null,end:null},
   last_updated:'2026-10-08T12:00:00.000Z',
   links:{ll2:'https://ll.thespacedevs.com/2.3.0/launches/'+id+'/',info:[{kind:'info',source:'spacex.com',title:'SpaceX',type:'Official Page',official:true,priority:10,url:'https://www.spacex.com/launches/calendar-test'}],webcast:[]},change:null};
}
const FEED={schema:'worthlookingup.launches/1',available:true,generated_at:new Date(NOW).toISOString(),refresh_interval_minutes:30,stale_after_minutes:180,stale:false,stale_reason:null,
 source:{name:'Launch Library 2',publisher:'The Space Devs',api_version:'2.3.0',attribution:'Launch data: The Space Devs Launch Library 2',rights:'Free unauthenticated access is limited to 15 requests per hour.',retrieved_at:new Date(NOW).toISOString(),sha256:'a'.repeat(64)},
 stats:{count:3,with_published_time:1,with_published_date:1,period_only:1,announced_total:3,window_days:180},
 launches:[
  launch({id:'calendar-exact',name:'Falcon 9 Block 5 | Calendar Test Flight',net:new Date(NOW+86400000).toISOString(),precision:{kind:'second',exact:true,dated:true,countdown:true,name:'Second'}}),
  launch({id:'calendar-day',name:'Electron | Date Only Schedule',net:'2026-10-11T00:00:00Z',precision:{kind:'day',exact:false,dated:true,countdown:false,name:'Day'},status:'To Be Determined',statusKind:'unconfirmed'}),
  launch({id:'calendar-period',name:'GSLV Mk II | Month Announced Only',net:'2026-10-31T00:00:00Z',precision:{kind:'month',exact:false,dated:false,countdown:false,name:'Month'},status:'To Be Determined',statusKind:'unconfirmed'})]};
async function boot(page){
  const requests=[],errors=[];
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(_ok,fail)=>fail({message:'Permission denied'})}}));
  await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',r=>r.fulfill({json:[ISS]}));
  await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{timezone:'America/Chicago',hourly}}));
  await page.route('**/data/overhead/*.json',r=>{const name=r.request().url().split('/').pop().split('?')[0];r.fulfill({contentType:'application/json',body:fs.readFileSync(path.resolve('data/overhead',name),'utf8')});});
  for(const pattern of ['**/api/launches.json*','**/data/launches/*.json'])await page.route(pattern,r=>r.fulfill({json:FEED}));
  await page.goto('file://'+path.resolve('index.html'));
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
  return {requests,errors};
}
async function download(page,locator){
  const pending=page.waitForEvent('download',{timeout:20000});
  await locator.click();
  const download=await pending;
  return {name:download.suggestedFilename(),text:fs.readFileSync(await download.path(),'utf8')};
}
const unfold=ics=>ics.split('\r\n').filter(line=>line!=='').reduce((list,line)=>{if(line.startsWith(' '))list[list.length-1]+=line.slice(1);else list.push(line);return list;},[]);
const prop=(ics,name)=>{const line=unfold(ics).find(x=>x.startsWith(name+':')||x.startsWith(name+';'));return line?line.slice(line.indexOf(':')+1):null;};


test('a discovery opportunity downloads a real single-event calendar file',async({page})=>{
  const {requests,errors}=await boot(page);
  await expect(page.locator('.discovery-event').first()).toBeVisible();
  const add=page.locator('.discovery-event [data-calendar-add]').first();
  await expect(add).toBeVisible();
  const before=requests.length;
  const {name,text}=await download(page,add);
  expect(name).toMatch(/^worth-looking-up-[\w-]+-\d{8}\.ics$/);
  expect(name).not.toMatch(/[/\\]/);
  expect(/[^\r]\n/.test(text)).toBe(false);
  for(const line of text.split('\r\n'))expect(Buffer.byteLength(line,'utf8')).toBeLessThanOrEqual(75);
  const lines=unfold(text);
  expect(lines[0]).toBe('BEGIN:VCALENDAR');expect(lines[lines.length-1]).toBe('END:VCALENDAR');
  expect(lines.filter(line=>line==='BEGIN:VEVENT')).toHaveLength(1);
  expect(prop(text,'PRODID')).toContain('Worth Looking Up');
  expect(prop(text,'UID')).toMatch(/^wlu-satellites-[\w-]+@worthlookingup\.com$/);
  expect(prop(text,'DTSTAMP')).toMatch(/^\d{8}T\d{6}Z$/);
  expect(prop(text,'DTSTART')).toMatch(/^\d{8}T\d{6}Z$/);
  expect(prop(text,'DTEND')).toMatch(/^\d{8}T\d{6}Z$/);
  expect(prop(text,'SUMMARY')).toContain('pass');
  expect(prop(text,'URL')).toBe('https://worthlookingup.com/');
  expect(prop(text,'LOCATION')).toContain('Princeton');
  expect(text).not.toContain('overhead.');
  expect(text).not.toContain('38.3553');
  await expect(page.locator('#status')).toContainText('Downloaded worth-looking-up-');
  await expect(page.locator('#status')).toContainText('cannot change your calendar itself');
  // The download is a local file: exporting made no new network request at all.
  expect(requests.length).toBe(before);
  expect(requests.filter(url=>/\.ics(\?|$)/i.test(url))).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('the satellite event dialog offers the same calendar action',async({page})=>{
  const {errors}=await boot(page);
  await page.locator('.event').first().click();
  await expect(page.locator('#event-dialog')).toBeVisible();
  const add=page.locator('#detail-calendar');
  await expect(add).toBeEnabled();
  await expect(add).toHaveText('Add to calendar (.ics)');
  const {text}=await download(page,add);
  expect(prop(text,'UID')).toMatch(/^wlu-satellites-[\w-]+@worthlookingup\.com$/);
  expect(prop(text,'SUMMARY')).toContain('pass');
  expect(unfold(text).some(line=>line.startsWith('DESCRIPTION:')&&line.includes('calculated pass prediction'))).toBe(true);
  expect(errors).toEqual([]);
});

test('the launch calendar exports a precise schedule and refuses a broad announced period',async({page})=>{
  const {errors}=await boot(page);
  await page.getByRole('tab',{name:'ROCKET LAUNCHES'}).click();
  await page.locator('[data-horizon="week"]').click();
  await expect(page.locator('[data-launch="calendar-exact"]')).toBeVisible();
  const exact=page.locator('[data-launch="calendar-exact"] [data-calendar-add]');
  await expect(exact).toBeVisible();
  const {text}=await download(page,exact);
  expect(prop(text,'STATUS')).toBe('TENTATIVE');
  expect(prop(text,'DTSTART')).toMatch(/^\d{8}T\d{6}Z$/);
  expect(unfold(text).filter(line=>line.startsWith('DTEND'))).toHaveLength(0);
  expect(prop(text,'UID')).toBe('wlu-launches-calendar-exact@worthlookingup.com');
  const description=unfold(text).find(line=>line.startsWith('DESCRIPTION:'));
  expect(description).toContain('published target time\\, not a confirmed liftoff');
  expect(description).toContain('Local visibility: unknown');
  expect(description).toContain('Provider record: https://ll.thespacedevs.com/');
  expect(description).toContain('Schedule age:');
  expect(description).not.toMatch(/will be visible|probability|chance of/i);
  // A published date becomes an all-day placeholder that says it is tentative.
  const day=page.locator('[data-launch="calendar-day"] [data-calendar-add]');
  await expect(day).toBeVisible();
  const dayFile=await download(page,day);
  expect(unfold(dayFile.text).filter(line=>line.startsWith('DTSTART'))).toEqual(['DTSTART;VALUE=DATE:20261011']);
  expect(prop(dayFile.text,'DTEND;VALUE=DATE')).toBe('20261012');
  expect(prop(dayFile.text,'STATUS')).toBe('TENTATIVE');
  expect(prop(dayFile.text,'TRANSP')).toBe('TRANSPARENT');
  // A month-only schedule has no calendar action at all and says why.
  await expect(page.locator('[data-launch="calendar-period"]')).toHaveCount(0);
  await expect(page.locator('[data-launch-period="calendar-period"]')).toHaveCount(1);
  await expect(page.locator('#celestial-more-body')).toContainText('not precise enough for a calendar entry');
  expect(await page.locator('[data-launch-period] [data-calendar-add]').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('the observing plan collects, deduplicates, reviews, removes and exports several events',async({page})=>{
  const {errors}=await boot(page);
  const panel=page.locator('#observing-plan');
  await expect(panel).toBeHidden();
  const toggles=page.locator('.discovery-event [data-plan-toggle]');
  const firstTitle=(await toggles.nth(0).locator('xpath=ancestor::article//button[@data-discovery-open]').innerText()).trim();
  await toggles.nth(0).click();
  await expect(panel).toBeVisible();
  await expect(page.locator('#plan-count')).toHaveText('· 1 event');
  await expect(page.locator('#plan-list li')).toHaveCount(1);
  await expect(page.locator('#status')).toContainText('added to the observing plan');
  // The same opportunity reached through the pass dialog shares one identity, and a repeated
  // selection is refused rather than duplicated.
  await page.locator('.discovery-event [data-discovery-open]').first().click();
  await expect(page.locator('#event-dialog')).toBeVisible();
  await expect(page.locator('#detail-plan')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#detail-plan')).toHaveText('In observing plan ✓');
  const planId=await page.locator('#detail-plan').evaluate(element=>element.dataset.planToggle);
  await page.evaluate(id=>__OVERHEAD_TEST__.planAdd(id),planId);
  await expect(page.locator('#status')).toContainText('already in your observing plan');
  await expect(page.locator('#plan-list li')).toHaveCount(1);
  await expect(page.locator('#plan-count')).toHaveText('· 1 event');
  await page.keyboard.press('Escape');
  await page.locator('#discovery-back').click();
  // A second opportunity: the review panel is chronological and its file carries both events.
  await page.locator('#discovery-coming summary').first().click();
  await page.locator('#discovery-upcoming [data-plan-toggle]').first().click();
  await expect(page.locator('#plan-list li')).toHaveCount(2);
  await expect(page.locator('#plan-notice')).toContainText('Times are stored in UTC, so your calendar app shows them in its own timezone');
  const order=await page.evaluate(()=>{
    const T=__OVERHEAD_TEST__;
    return {items:[...T.observingPlan.values()].slice().sort((a,b)=>T.planSortKey(a.event)-T.planSortKey(b.event)).map(entry=>entry.id),
      rendered:[...document.querySelectorAll('#plan-list li')].map(li=>li.dataset.planItem)};
  });
  expect(order.rendered).toEqual(order.items);
  const plan=await download(page,page.locator('#plan-download'));
  expect(plan.name).toMatch(/^worth-looking-up-observing-plan-\d{8}\.ics$/);
  expect(unfold(plan.text).filter(line=>line==='BEGIN:VEVENT')).toHaveLength(2);
  expect(unfold(plan.text).filter(line=>line==='BEGIN:VCALENDAR')).toHaveLength(1);
  const uids=unfold(plan.text).filter(line=>line.startsWith('UID:'));
  expect(new Set(uids).size).toBe(2);
  expect(plan.text).toContain('URL:https://worthlookingup.com/');
  // Removing one event keeps the other; clearing empties the plan and hides the panel.
  const remove=page.locator('#plan-list [data-plan-remove]').first();
  await expect(remove).toHaveAttribute('aria-label',new RegExp('^Remove '+firstTitle.slice(0,8).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  await remove.click();
  await expect(page.locator('#plan-list li')).toHaveCount(1);
  await expect(page.locator('#status')).toContainText('removed from the observing plan');
  await page.locator('#plan-clear').click();
  await expect(page.locator('#status')).toContainText('cleared');
  await expect(panel).toBeHidden();
  await expect(page.locator('.discovery-event [data-plan-toggle]').nth(0)).toHaveAttribute('aria-pressed','false');
  // The plan is session state: it never writes a preference key of its own.
  const stored=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('overhead.')));
  expect(stored).not.toContain('overhead.plan');
  expect(errors).toEqual([]);
});


test('calendar controls stay usable on a phone and with the keyboard in both themes',async({page})=>{
  const {errors}=await boot(page);
  await page.setViewportSize({width:390,height:844});
  await page.locator('.discovery-event [data-plan-toggle]').first().click();
  await expect(page.locator('#observing-plan')).toBeVisible();
  for(const width of [390,768,1024,1440]){
    await page.setViewportSize({width,height:900});
    await page.waitForTimeout(80);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('#plan-download')).toBeVisible();
    await expect(page.locator('#plan-list [data-plan-remove]').first()).toBeVisible();
  }
  await page.setViewportSize({width:390,height:844});
  const box=await page.locator('#plan-download').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(40);
  const removeBox=await page.locator('#plan-list [data-plan-remove]').first().boundingBox();
  expect(removeBox.height).toBeGreaterThanOrEqual(40);
  const addBox=await page.locator('.discovery-event [data-calendar-add]').first().boundingBox();
  expect(addBox.height).toBeGreaterThanOrEqual(40);
  // Visible focus and Enter activation on the calendar action.
  const add=page.locator('.discovery-event [data-calendar-add]').first();
  await page.keyboard.press('Tab');
  await add.focus();
  expect(await add.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('solid');
  const pending=page.waitForEvent('download',{timeout:20000});
  await page.keyboard.press('Enter');
  const keyboardDownload=await pending;
  expect(keyboardDownload.suggestedFilename()).toMatch(/\.ics$/);
  expect(fs.readFileSync(await keyboardDownload.path(),'utf8')).toContain('BEGIN:VCALENDAR');
  // The remove control is reachable and activatable with the keyboard.
  const remove=page.locator('#plan-list [data-plan-remove]').first();
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#observing-plan')).toBeHidden();
  for(const theme of ['light','dark']){
    await page.locator('#settings-open').click();
    await page.getByRole('button',{name:theme==='light'?'Use light theme':'Use dark theme'}).click();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.locator('.discovery-event [data-calendar-add]').first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

