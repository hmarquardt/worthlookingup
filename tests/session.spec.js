/* Photography sessions: the builder in a real browser.

   The comparison list is the interface and the map is a sketch beside it, so these tests treat the list as the
   authority and check that the map agrees with it. Everything is served from a local static server: no network,
   no tiles, no third-party request of any kind. */
const {test,expect}=require('@playwright/test');
const path=require('path'),fs=require('fs'),http=require('http');
test.use({channel:process.env.CI?'chromium':'chrome'});
test.setTimeout(90000);
const NOW=new Date('2026-10-16T23:30Z');          // October: no qualifying core window at this latitude
const ISS={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-07-01T11:57:47.376864',MEAN_MOTION:15.49018229,
  ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,
  EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',NORAD_CAT_ID:25544,ELEMENT_SET_NO:999,REV_AT_EPOCH:58451,
  BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
function serve(){
  return http.createServer((request,response)=>{
    const file=new URL(request.url,'http://local').pathname.slice(1);
    if(!/^(index\.html|overhead[\w-]*\.js|preferences-transfer\.js|analytics-lite\.js|assets\/[\w./-]+|vendor\/overhead\/[\w.-]+\.js|data\/[\w./-]+\.json)$/.test(file)){response.writeHead(404);response.end('not served');return;}
    const full=path.resolve(file);
    if(!fs.existsSync(full)){response.writeHead(404);response.end('missing');return;}
    response.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'application/javascript');
    response.end(fs.readFileSync(full));
  });
}
const servers=[];
test.afterEach(async()=>{ await Promise.all(servers.splice(0).map(server=>new Promise(resolve=>server.close(resolve)))); });
async function boot(page,{requests=[],now=NOW,server=null,weather=null}={}){
  const errors=[];
  page.on('pageerror',error=>errors.push('pageerror: '+error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push('console: '+message.text());});
  page.on('request',request=>requests.push(request.url()));
  await page.clock.setFixedTime(now);
  await page.route('**/api/analytics/**',route=>route.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',route=>route.fulfill({json:[ISS]}));
  // A forecast fixture is registered before the page loads, because the page asks for weather once and
  // keeps the answer; a later route could not retroactively supply it.
  await page.route('**api.open-meteo.com/**',route=>weather?route.fulfill({json:weather}):route.fulfill({status:503,body:'unavailable'}));
  await page.route('**api/launches.json*',route=>route.fulfill({status:404,body:'none'}));
  await page.route('**data/launches/upcoming.json',route=>route.fulfill({status:404,body:'none'}));
  const own=server||serve();
  if(!server)await new Promise(resolve=>own.listen(0,'127.0.0.1',resolve));
  servers.push(own);
  await page.goto('http://127.0.0.1:'+own.address().port+'/index.html');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!window.__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  return errors;
}
const openMilkyWay=async(page)=>{
  await page.locator('[data-category="milkyway"]').click();
  await page.waitForFunction(()=>{const c=window.__OVERHEAD_TEST__.celestial;
    return c.status==='ready'&&!c.busy&&c.result&&c.result.category==='milkyway';},null,{timeout:60000});
};
const openExplorer=async(page)=>{
  await page.locator('#whereto-open').click();
  await page.waitForFunction(()=>document.querySelectorAll('.whereto-area').length>0,null,{timeout:60000});
};
const section=page=>page.locator('#milkyway-whereto');

const openBuilder=async(page)=>{
  await page.locator('#session-open').click();
  await page.waitForFunction(()=>{const s=window.__OVERHEAD_TEST__.session;
    return s.open&&s.status==='ready'&&!!s.module&&!!document.querySelector('[data-session-root]');},null,{timeout:60000});
};
const builder=page=>page.locator('#milkyway-session');
const choosePoint=async(page,id)=>{
  await page.locator('#milkyway-session [data-session="where"][data-value="'+id+'"]').click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.session.where!=='home',null,{timeout:20000});
};
const setDate=async(page,iso)=>{
  await page.evaluate(date=>window.__OVERHEAD_TEST__.applySessionDate(date),iso);
  await page.waitForFunction(date=>window.__OVERHEAD_TEST__.session.date===date,iso,{timeout:20000});
};

test('the builder is a door until opened, then loads the module, the points and the season without touching the page above',async({page})=>{
  const requests=[];
  const errors=await boot(page,{requests});
  await openMilkyWay(page);
  const door=builder(page);
  await expect(door).toContainText('Plan a photography session');
  await expect(door).toContainText('Plan a Photography Session');
  expect(requests.some(url=>/overhead-sessions\.js|points\.json/.test(url))).toBe(false);
  await openBuilder(page);
  const loaded=requests.filter(url=>/overhead-sessions\.js|points\.json/.test(url));
  expect(loaded.length).toBeGreaterThanOrEqual(2);
  expect(loaded.every(url=>url.startsWith('http://127.0.0.1'))).toBe(true);
  for(const heading of ['When','Where','Prepare','Save or export'])await expect(door).toContainText(heading);
  // All three verified points are offered, each with its own parking classification.
  await expect(door.locator('[data-session="where"]')).toHaveCount(4);
  await expect(door).toContainText('Camp Cadiz Campground');
  await expect(door).toContainText('Tower Rock Campground');
  await expect(door).toContainText('Garden of the Gods backpacker parking');
  await expect(door).toContainText('parking verified at designated campsite');
  await expect(door).toContainText('My saved location');
  await expect(door).toContainText('not a verified public site');
  expect(errors).toEqual([]);
});

test('tonight at a verified point is calculated at the point, with its own window, direction and terrain',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  const door=builder(page);
  await expect(door).toContainText('Camp Cadiz Campground');
  await expect(door).toContainText('America/Chicago');
  await expect(door.locator('.sx-facts')).toContainText('Observing window');
  await expect(door).toContainText('Best available moment');
  await expect(door).toContainText('Point the camera');
  await expect(door).toContainText('Terrain toward the core');
  await expect(door).toContainText('bare-earth');
  await expect(door).toContainText('Weather is not available for this place');
  await expect(door).toContainText('parking is verified only at a designated campsite');
  const text=await door.innerText();
  expect(text).not.toMatch(/bortle|mag\/arcsec|drive time|\d+ ?(min|minutes) drive/i);
  // A plain-language direction that is actually a word, not a compass letter with a suffix glued on.
  // Labels are uppercased by the stylesheet, so the match is case-insensitive.
  expect(text).toMatch(/point the camera[\s\S]{0,80}(north|south|east|west)/i);
  expect(text).not.toMatch(/\bsern\b|northerner|easternern|westernern/);
  // The visitor's own site is untouched by a point being inspected.
  const site=await page.evaluate(()=>window.__OVERHEAD_TEST__.state.site);
  expect(site.name).toBe('Princeton, Indiana');
  expect(errors).toEqual([]);
});

test('a date with no qualifying window explains itself and refuses to save, print or export',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2026-10-20');
  const door=builder(page);
  await expect(door).toContainText('No qualifying Galactic-core window at this place on this date.');
  await expect(door).toContainText('the galaxy is not invisible');
  await expect(door.locator('[data-session="save"]')).toBeDisabled();
  await expect(door.locator('[data-session="print"]')).toBeDisabled();
  await expect(door.locator('[data-session="calendar"]')).toBeDisabled();
  // Nothing was written for a night that has no window.
  expect(await page.evaluate(()=>window.__OVERHEAD_TEST__.session.saved.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('a custom date at the visitor\'s own location is labelled as unverified, with no invented terrain or forecast',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await setDate(page,'2027-04-13');
  const door=builder(page);
  await expect(door).toContainText('My saved location');
  await expect(door).toContainText('no public-access evidence');
  await expect(door).toContainText('Terrain horizon unavailable');
  await expect(door).toContainText('Weather is not yet forecastable for this date.');
  await expect(door.locator('.sx-facts')).toContainText('Observing window');
  expect(errors).toEqual([]);
});

test('a plan is saved, survives a reload, and a refresh never claims the access rule is unchanged',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.locator('#milkyway-session textarea[data-session-input="notes"]').fill('Park at the campsite, not the day-use lot.');
  await page.locator('#milkyway-session [data-session-check="tripod"]').check();
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(builder(page)).toContainText('Saved in this browser only');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('overhead.session.list.v1')));
  expect(saved.length).toBe(1);
  expect(saved[0].site.name).toBe('Camp Cadiz Campground');
  expect(saved[0].notes).toBe('Park at the campsite, not the day-use lot.');
  expect(saved[0].checklist.tripod).toBe(true);
  expect(saved[0].evidenceRef.access.parking).toBe('verified-at-designated-campsite');
  expect(saved[0].window.start).toBeGreaterThan(0);
  await page.reload();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!window.__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  await openMilkyWay(page);
  await openBuilder(page);
  await expect(builder(page)).toContainText('Camp Cadiz Campground');
  await page.locator('#milkyway-session [data-session="open"]').first().click();
  await expect(builder(page)).toContainText('Opened a plan saved');
  await page.locator('#milkyway-session [data-session="refresh"]').click();
  await expect(builder(page)).toContainText('Recalculated at');
  await expect(builder(page)).toContainText('the agency may still change it');
  expect(errors).toEqual([]);
});

test('notes cannot inject markup, and a corrupt saved record is skipped rather than rendered',async({page})=>{
  const errors=await boot(page);
  await page.evaluate(()=>localStorage.setItem('overhead.session.list.v1',JSON.stringify([{schema:'nonsense/1'},{schema:'worthlookingup.session/1',id:'session:home:2027-04-13',date:'2027-04-13',site:{name:'<b>bold</b>',lat:38.3553,lon:-87.5675,tz:'America/Chicago'},notes:'<img src=x onerror=alert(1)>'}])));
  await openMilkyWay(page);
  await openBuilder(page);
  const door=builder(page);
  await expect(door).toContainText('One saved plan could not be read and was skipped.');
  await expect(page.locator('#milkyway-session img')).toHaveCount(0);
  await expect(page.locator('#milkyway-session b')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the calendar event is the observing window at the chosen place, and the plan holds it once',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'tower-rock-campground');
  await setDate(page,'2027-04-13');
  const record=await page.evaluate(()=>{const s=window.__OVERHEAD_TEST__;const computed=s.computeSession();
    return {start:computed.analysis.window.start,end:computed.analysis.window.end,site:computed.site};});
  expect(record.site.name).toBe('Tower Rock Campground');
  expect(record.end).toBeGreaterThan(record.start);
  await page.locator('#milkyway-session [data-session="plan"]').click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.observingPlan.size===1,null,{timeout:20000});
  const entry=await page.evaluate(()=>{const plan=window.__OVERHEAD_TEST__.observingPlan;
    const item=[...plan.values()][0];return {start:item.event.start,end:item.event.end,title:item.event.title,location:item.event.location||null};});
  expect(entry.start).toBe(record.start);
  expect(entry.end).toBe(record.end);
  expect(entry.title).toContain('Tower Rock Campground');
  // The same site and night twice is the same event, not a second one.
  await page.locator('#milkyway-session [data-session="plan"]').click();
  expect(await page.evaluate(()=>window.__OVERHEAD_TEST__.observingPlan.size)).toBe(1);
  expect(errors).toEqual([]);
});

test('the printed field plan carries the window, the access quote, the kit and the unknowns',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'garden-of-the-gods-backpacker-parking-indian-point-trailhead');
  await setDate(page,'2027-04-13');
  await page.evaluate(()=>{window.__PRINTED__=0;window.print=()=>{window.__PRINTED__++;};});
  await page.locator('#milkyway-session [data-session="print"]').click();
  await page.waitForFunction(()=>window.__PRINTED__===1,null,{timeout:20000});
  const sheet=await page.locator('#session-print').innerText();
  expect(sheet).toContain('Milky Way photography session');
  expect(sheet).toContain('Garden of the Gods backpacker parking');
  expect(sheet).toContain('Observing window');
  expect(sheet).toContain('Best available moment');
  expect(sheet).toContain('Official access evidence');
  expect(sheet).toContain('backpacker');
  expect(sheet).toContain('Equipment');
  expect(sheet).toContain('Unresolved');
  expect(sheet).toContain('not a permission, a forecast or a promise');
  expect(sheet).not.toMatch(/drive time|depart at|travel/i);
  expect(errors).toEqual([]);
});

test('the builder is usable at every width, in both themes, with no horizontal overflow',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  for(const width of [390,768,1280,1440]){
    await page.setViewportSize({width,height:900});
    for(const theme of ['dark','light']){
      await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow<=0,'overflow at '+width+' '+theme+' is '+overflow).toBe(true);
      const box=await page.locator('#milkyway-session [data-session="save"]').boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
  }
  // Keyboard: every choice is a real button and the checklist is a real checkbox.
  expect(await page.locator('#milkyway-session .sx-choice').first().evaluate(node=>node.tagName)).toBe('BUTTON');
  await page.locator('#milkyway-session [data-session-check="camera"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#milkyway-session [data-session-check="camera"]')).toBeChecked();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('overhead.session.checklist.v1')).camera)).toBe(true);
  expect(errors).toEqual([]);
});

test('the first favourable night comes from the season search at the selected place, not from another site',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await page.locator('#milkyway-session [data-session="when"][data-value="favourable"]').click();
  await page.waitForFunction(()=>{const s=window.__OVERHEAD_TEST__.session;
    return s.when==='favourable'&&typeof s.date==='string'&&s.date!==new Date().toISOString().slice(0,10);},null,{timeout:90000});
  const state=await page.evaluate(()=>{const s=window.__OVERHEAD_TEST__.session;
    return {date:s.date,seasonSite:s.season.site,point:s.season.point};});
  // The season was searched at the point's own coordinates, not at the visitor's home.
  expect(state.seasonSite.lat).toBeCloseTo(37.57834,3);  // Camp Cadiz's published marker, not the home site
  expect(state.seasonSite.tz).toBe('America/Chicago');
  await expect(builder(page)).toContainText('Camp Cadiz Campground');
  await expect(builder(page).locator('.sx-facts')).toContainText('Observing window');
  // The chosen chip is the one that reads as pressed, and the plan is for the season's own night.
  await expect(page.locator('#milkyway-session [data-session="when"][data-value="favourable"]')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>window.__OVERHEAD_TEST__.session.date)).toBe(state.date);
  expect(errors).toEqual([]);
});

test('a saved plan stays readable when the network drops, because its record is local',async({page,context})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(builder(page)).toContainText('Saved in this browser only');
  await page.locator('#milkyway-session [data-session="close"]').click();
  await context.setOffline(true);
  // The module is already in memory; the record is in localStorage. Nothing is requested to read it back.
  await openBuilder(page);
  await expect(builder(page)).toContainText('Saved plans in this browser');
  await page.locator('#milkyway-session [data-session="open"]').first().click();
  await expect(builder(page)).toContainText('Camp Cadiz Campground');
  await expect(builder(page)).toContainText('Opened a plan saved');
  const notes=await page.evaluate(()=>window.__OVERHEAD_TEST__.session.current.site.tz);
  expect(notes).toBe('America/Chicago');
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('a night inside the forecast horizon shows the real cloud context, dated, and never for a point',async({page})=>{
  // This fixture is what the page's own weather request returns: a timezone and hourly cloud cover. It is the
  // only path in which the builder may quote a forecast, and it used to throw before reaching the panel.
  const hourly={time:[],cloud_cover:[]};
  const start=Date.parse('2026-10-16T18:00:00Z');
  for(let i=0;i<240;i++){hourly.time.push(Math.floor((start+i*3600000)/1000));hourly.cloud_cover.push(i%2?30:10);}
  const errors=await boot(page,{weather:{timezone:'America/Chicago',hourly}});
  await openMilkyWay(page);
  await openBuilder(page);
  const text=await builder(page).innerText();
  expect(text).toMatch(/Cloud cover \d+% averaged over the night's forecast hours \(fetched .* ago\)\./);
  expect(text).toContain('One forecast, not a promise');
  // The same night at a point says nothing about weather rather than borrowing this forecast.
  await page.locator('#milkyway-session [data-session="where"][data-value="camp-cadiz-campground"]').click();
  await expect(builder(page)).toContainText('Weather is not available for this place.');
  expect(await builder(page).innerText()).not.toMatch(/Cloud cover \d+%/);
  expect(errors).toEqual([]);
});
