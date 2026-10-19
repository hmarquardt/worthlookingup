const {test,expect}=require('@playwright/test'),fs=require('node:fs'),path=require('node:path');
const NOW=Date.parse('2026-10-08T18:00Z');
const ISS={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-10-08T06:00:00.000000',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,NORAD_CAT_ID:25544,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
const hourly={time:Array.from({length:240},(_,i)=>Math.floor(Date.parse('2026-10-08T00:00Z')/1000)+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:15,visibility:24000,precipitation:0,weather_code:0,temperature_2m:15}))hourly[key]=Array(240).fill(value);
/* A self-contained launch feed for the guide. It never reads data/launches/upcoming.json: that artifact
   is refreshed hourly and its records change status as real launches fly, so deriving a fixture from a
   live sample made this suite depend on whichever launches the provider happened to be publishing. */
const LAUNCH_ENVELOPE={schema:'worthlookingup.launches/1',available:true,refresh_interval_minutes:30,stale_after_minutes:180,stale:false,stale_reason:null,
  source:{name:'Launch Library 2',publisher:'The Space Devs',api_version:'2.3.0',attribution:'Launch data: The Space Devs Launch Library 2',
    rights:'Free unauthenticated access is limited to 15 requests per hour.',retrieved_at:new Date(NOW).toISOString(),sha256:'a'.repeat(64)},
  stats:{count:3,with_published_time:1,with_published_date:1,period_only:1,announced_total:3,window_days:180}};
function launch({id,name,net,precision,status,statusKind}){
  return {id,slug:id,name,mission:name.split('| ').pop(),mission_type:'Communications',
    mission_description:'A fixed schedule used by the discovery regression.',orbit:'Low Earth Orbit',
    vehicle:'Falcon 9 Block 5',vehicle_family:'Falcon',provider:'SpaceX',provider_abbrev:'SpX',
    site:{name:'Cape Canaveral SFS, FL, USA',timezone:'America/New_York',country:'United States of America'},
    pad:{name:'Space Launch Complex 40',latitude:28.56194122,longitude:-80.57735736},
    status:{id:1,name:status,abbrev:statusKind==='hold'?'Hold':'TBD',kind:statusKind},net,precision,
    window:{start:null,end:null},last_updated:'2026-10-08T12:00:00.000Z',
    links:{ll2:'https://ll.thespacedevs.com/2.3.0/launches/'+id+'/',info:[],webcast:[]},change:null};
}
function feed(){return {...LAUNCH_ENVELOPE,generated_at:new Date(NOW).toISOString(),launches:[
  launch({id:'guide-exact',name:'Falcon 9 | Discovery mission',net:new Date(NOW+86400000).toISOString(),
    precision:{kind:'minute',name:'Minute',exact:true,dated:true,countdown:true},status:'On Hold',statusKind:'hold'}),
  launch({id:'guide-day',name:'Falcon 9 | Date-only schedule',net:'2026-10-10T00:00:00Z',
    precision:{kind:'day',name:'Day',exact:false,dated:true,countdown:false},status:'To Be Determined',statusKind:'unconfirmed'}),
  launch({id:'guide-period',name:'Falcon 9 | Broad schedule',net:'2026-10-31T00:00:00Z',
    precision:{kind:'month',name:'Month',exact:false,dated:false,countdown:false},status:'To Be Determined',statusKind:'unconfirmed'})]};}
async function boot(page,{offline=false,weather=true,launchOffline=false}={}){
 const requests=[],errors=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date(NOW));
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(_ok,fail)=>fail({message:'Permission denied'})}}));
 await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
 await page.route('**celestrak.org/**',r=>r.fulfill({json:offline?{error:'Unavailable'}:[ISS]}));
 await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:weather?{timezone:'America/Chicago',hourly}:{error:'Unavailable'}}));
 await page.route('**/data/overhead/*.json',r=>{const name=r.request().url().split('/').pop().split('?')[0];r.fulfill({contentType:'application/json',body:fs.readFileSync(path.resolve('data/overhead',name),'utf8')});});
 for(const pattern of ['**/api/launches.json*','**/data/launches/*.json'])await page.route(pattern,r=>launchOffline?r.fulfill({status:503,body:'Unavailable'}):r.fulfill({json:feed()}));
 await page.goto('file://'+path.resolve('index.html'));await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
 return {requests,errors};
}
const previewRequests=xs=>xs.filter(x=>/data\/overhead\/|api\/launches.json|data\/launches\//.test(x));
test('guide reuses category engines, retains diverse results and opens the matching source without more fetches',async({page})=>{
 const {requests,errors}=await boot(page);
 expect(previewRequests(requests)).toHaveLength(0);
 await page.locator('#discovery-build').click();await expect(page.locator('#discovery-build')).toBeEnabled({timeout:90000});
 await expect(page.locator('#discovery-coverage')).toContainText('Three celestial categories calculated');
 const counts=previewRequests(requests).reduce((m,x)=>(m[x]=(m[x]||0)+1,m),{});for(const n of Object.values(counts))expect(n).toBe(1);expect(Object.keys(counts)).toHaveLength(4);
 const stored=await page.evaluate(()=>JSON.stringify(localStorage));
 const model=await page.evaluate(()=>__OVERHEAD_TEST__.discoveryModel());
 expect(model.coverage).toEqual(['satellites','planets','meteors','comets']);expect(model.coming.length).toBeLessThanOrEqual(6);
 expect(model.coming.filter(e=>e.category==='satellites').length).toBeLessThanOrEqual(2);
 expect(model.events.every(e=>e.category!=='launches')).toBe(true);
 await page.locator('#discovery-coming summary').first().click();
 const entry=[...model.tonight,...model.coming].find(e=>e.category!=='satellites');expect(entry).toBeTruthy();
 if(await page.locator('#discovery-tonight-more').count())await page.locator('#discovery-tonight-more summary').first().click();
 await page.locator('[data-discovery-open]').filter({hasText:entry.title}).first().click();
 await expect(page.locator('#celestial')).toBeVisible();
 expect(await page.evaluate(()=>document.activeElement.getAttribute('data-opportunity'))).toBe(entry.sourceId);
 await expect(page.locator('#discovery-back')).toBeVisible();await page.locator('#discovery-back').click();await expect(page.locator('#discovery')).toBeFocused();
 await page.locator('#discovery-launches summary').first().click();
 await expect(page.locator('#discovery-launch-preview')).toContainText('Local visibility unknown');
 await expect(page.locator('#discovery-launch-preview .discovery-state[data-state="unknown"]').first()).toHaveText('Scheduled · visibility unknown');
 await expect(page.locator('#discovery-launch-preview')).toContainText('On Hold');
 await expect(page.locator('#discovery-launch-preview')).toContainText('October 2026 (month announced, no day published)');
 await page.getByRole('button',{name:'Date-only schedule',exact:false}).click();
 await expect(page.locator('[data-launch="guide-day"]')).toBeFocused();await page.locator('#discovery-back').click();
 await page.getByRole('button',{name:'Broad schedule',exact:false}).click();
 await expect(page.locator('[data-launch-period="guide-period"]')).toBeFocused();
 await page.locator('#discovery-back').click();
 const before=previewRequests(requests).length;const computations=await page.evaluate(()=>[...__OVERHEAD_TEST__.discoveryPlans.values()].map(x=>x.at));
 await page.locator('#discovery-build').click();await expect(page.locator('#discovery-build')).toBeEnabled();
 expect(previewRequests(requests).length).toBe(before);expect(await page.evaluate(()=>[...__OVERHEAD_TEST__.discoveryPlans.values()].map(x=>x.at))).toEqual(computations);
 // Navigating away and back never alters saved places, settings or favorites.
 expect(await page.evaluate(()=>JSON.stringify(localStorage))).toBe(stored);
 for(const id of ['discovery-coming','discovery-launches','discovery-tonight-more'])if(await page.locator('#'+id).count())await page.locator('#'+id).evaluate(e=>e.open=false);
 for(const width of [390,768,1280,1440])for(const theme of ['dark','light']){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>document.querySelector('[data-theme-choice="'+t+'"]').click(),theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  expect(await page.locator('header').count()).toBe(1);await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(100);
  await page.screenshot({path:`/tmp/wlu-discovery-${theme}-${width}.png`,fullPage:true});
 }
 expect(errors).toEqual([]);
});
test('multiple active intervals remain compact, warnings persist and the disclosure survives a minute render',async({page})=>{
 await boot(page);const capture=require('./fixtures/overhead-incident-2026-09-08.json');
 await page.clock.setFixedTime(new Date('2026-09-09T01:18Z'));
 await page.evaluate(c=>{const a=__OVERHEAD_TEST__,s=a.state;s.nights=a.engine.nights(s.site,Date.now());const extra=Array.from({length:6},(_,i)=>({...structuredClone(c.pass),id:'active-'+i,norad:String(90000+i),name:'Active spacecraft '+i,likely:false,provisional:true,groups:['visual']}));s.results={0:[c.pass,...extra]};s.groups=new Set(['iss','stations','visual']);s.busy=false;s.loading=false;a.render();},capture);
 const metrics=[];
 for(const width of [390,768,1280,1440]){
  await page.setViewportSize({width,height:900});
  for(const theme of ['dark','light']){
   await page.evaluate(t=>document.querySelector('[data-theme-choice="'+t+'"]').click(),theme);
   await expect(page.locator('[data-happening]').first()).toBeVisible();await expect(page.locator('[data-happening="active-0"]')).toBeHidden();
   await expect(page.locator('#happening-now')).toContainText('6 orbital-only, 6 weather-incomplete');
   const collapsed=(await page.locator('#happening-now').boundingBox()).height;expect(collapsed).toBeLessThan(350);
   const summary=page.locator('#happening-more summary');await summary.focus();await page.keyboard.press('Enter');await expect(page.locator('[data-happening="active-0"]')).toBeVisible();
   await expect(page.locator('[data-happening="active-0"]')).toContainText('not predicted to be visible');
   await page.clock.setFixedTime(new Date('2026-09-09T01:19Z'));await page.evaluate(()=>__OVERHEAD_TEST__.render());await expect(summary).toBeFocused();expect(await page.locator('#happening-more').evaluate(e=>e.open)).toBe(true);
   const expanded=(await page.locator('#happening-now').boundingBox()).height;expect(expanded).toBeGreaterThan(collapsed);
   metrics.push({width,theme,collapsed,expanded});await summary.press('Enter');
   await page.screenshot({path:`/tmp/wlu-now-${theme}-${width}.png`});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  }
 }
 fs.writeFileSync('/tmp/wlu-now-metrics.json',JSON.stringify(metrics,null,2));
 await page.locator('#happening-more summary').click();await page.locator('[data-happening="active-0"]').click();await expect(page.locator('#event-dialog')).toBeVisible();await page.keyboard.press('Escape');
});
test('missing weather, denied location, empty results, stale feed and scope changes are explicit',async({page})=>{
 const {errors}=await boot(page,{weather:false});
 await expect(page.locator('#discovery-tonight')).toContainText('Weather incomplete');
 await page.evaluate(()=>{for(const rows of Object.values(__OVERHEAD_TEST__.state.results))for(const p of rows)p.epoch=Date.now()-4*86400000;__OVERHEAD_TEST__.renderDiscovery();});
 await expect(page.locator('#discovery-tonight')).toContainText('Orbital elements may be stale');
 await page.locator('#location-open').click();await page.locator('#geolocate').click();await expect(page.locator('#location-status')).toContainText('Permission denied');await page.keyboard.press('Escape');
 await page.locator('#discovery-build').click();await expect(page.locator('#discovery-build')).toBeEnabled({timeout:90000});
 await page.evaluate(()=>{__OVERHEAD_TEST__.launches.feed.stale=true;__OVERHEAD_TEST__.launches.feed.stale_reason='Provider unavailable';__OVERHEAD_TEST__.renderDiscovery();});
 await page.locator('#discovery-launches summary').first().click();await expect(page.locator('#discovery-launch-preview')).toContainText('may not reflect postponements or cancellations');
 await page.evaluate(()=>{const a=__OVERHEAD_TEST__;a.state.site={...a.state.site,name:'New location',lat:40};a.state.generation++;a.state.results={0:[]};a.render();});
 expect(await page.evaluate(()=>__OVERHEAD_TEST__.discoveryPlans.size)).toBe(0);await expect(page.locator('#discovery-tonight')).toContainText('No opportunity clears');
 expect(errors).toEqual([]);
});
test('unavailable orbital and launch sources never invent an empty-sky answer or a schedule',async({page})=>{
 await boot(page,{offline:true,weather:false,launchOffline:true});await expect(page.locator('#discovery-tonight')).toContainText('Not enough current orbital data');
 await page.locator('#discovery-build').click();await expect(page.locator('#discovery-build')).toBeEnabled({timeout:90000});
 await page.locator('#discovery-launches summary').first().click();await expect(page.locator('#discovery-launch-preview')).toContainText('missing data, not an empty schedule');
 expect(await page.evaluate(()=>__OVERHEAD_TEST__.discoveryModel().launch.events.length)).toBe(0);
});
