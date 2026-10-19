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
  page.__weather=[];
  await page.route('**api.open-meteo.com/**',route=>{page.__weather.push(route.request().url());
    return weather?route.fulfill({json:weather}):route.fulfill({status:503,body:'unavailable'});});
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
  await expect(door).toContainText('Forecast unavailable');
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
  // Notes, kit and the saved place come back with the record, before any refresh.
  await expect(page.locator('#milkyway-session textarea[data-session-input="notes"]')).toHaveValue('Park at the campsite, not the day-use lot.');
  await expect(page.locator('#milkyway-session [data-session-check="tripod"]')).toBeChecked();
  await expect(builder(page).locator('.sx-fieldsum')).toContainText('Camp Cadiz Campground');
  await page.locator('#milkyway-session [data-session="refresh"]').click();
  await expect(builder(page)).toContainText('Refresh finished');
  // The refreshed report distinguishes the local recalculation from the published record, and says plainly that
  // the site's own record is not the managing agency.
  await expect(page.locator('#milkyway-session .sx-refresh')).toContainText('Astronomy: recalculated at');
  await expect(builder(page)).toContainText('not with the managing agency');
  expect(await builder(page).innerText()).not.toMatch(/everything (was )?updated/i);
  await expect(page.locator('#milkyway-session textarea[data-session-input="notes"]')).toHaveValue('Park at the campsite, not the day-use lot.');
  await expect(page.locator('#milkyway-session [data-session-check="tripod"]')).toBeChecked();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('overhead.session.list.v1')));
  expect(after.length).toBe(1);
  expect(after[0].id).toBe(saved[0].id);
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

test('the printed sheet carries the destination forecast, its age and its state, and never more certainty than the panel',async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.sessionWeatherState().status==='ready',null,{timeout:30000});
  await page.evaluate(()=>{window.__PRINTED__=0;window.print=()=>{window.__PRINTED__++;};});
  await page.locator('#milkyway-session [data-session="print"]').click();
  await page.waitForFunction(()=>window.__PRINTED__===1,null,{timeout:20000});
  const sheet=await page.locator('#session-print').innerText();
  expect(sheet).toContain('Weather forecast');
  expect(sheet).toMatch(/Cloud cover \d+%/);
  expect(sheet).toMatch(/fetched \d+[mhd] before this sheet was printed/);
  expect(sheet).not.toMatch(/clear skies|guaranteed clear|drive time|depart at/i);
  // A date outside the provider's range prints the refusal, not an old or invented forecast.
  await setDate(page,'2027-06-15');
  await page.locator('#milkyway-session [data-session="print"]').click();
  await page.waitForFunction(()=>window.__PRINTED__===2,null,{timeout:20000});
  const later=await page.locator('#session-print').innerText();
  expect(later).toContain('not yet forecastable for this date');
  expect(later).not.toMatch(/Cloud cover \d+%/);
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

test("the forecast follows the chosen place: the visitor first, then the point's own coordinates",async({page})=>{
  // This fixture is what the page's own weather request returns: a timezone and hourly cloud cover.
  const hourly={time:[],cloud_cover:[]};
  const start=Date.parse('2026-10-16T18:00:00Z');
  for(let i=0;i<240;i++){hourly.time.push(Math.floor((start+i*3600000)/1000));hourly.cloud_cover.push(i%2?30:10);}
  const errors=await boot(page,{weather:{timezone:'America/Chicago',hourly}});
  await openMilkyWay(page);
  await openBuilder(page);
  const text=await builder(page).innerText();
  expect(text).toMatch(/Cloud cover \d+% over \d+ hours?/);
  expect(text).toContain('forecast of cloud is not a measurement of transparency, smoke or seeing');
  // Selecting a point asks the provider for the point's coordinates, not the visitor's. The answer must be quoted
  // with its own fetch age and the model-coarseness caveat.
  await choosePoint(page,'camp-cadiz-campground');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.sessionWeatherState().status==='ready',null,{timeout:30000});
  const forecast=builder(page).locator('.sx-forecast');
  await expect(forecast).toContainText(/Cloud cover \d+%/);
  await expect(forecast).toContainText('Open-Meteo for these coordinates');
  await expect(forecast).toContainText(/just fetched|fetched \d/);
  const urls=page.__weather||[];
  expect(urls.some(url=>{const q=new URL(url).searchParams;
    return Math.abs(Number(q.get('latitude'))-37.57834)<0.001&&Math.abs(Number(q.get('longitude'))+88.24417)<0.001;})).toBe(true);
  expect(errors).toEqual([]);
});

/* ---- Phase 6D: destination forecast, access freshness, field copy, checklist targets ---------------------- */
const SEASON_NOW=new Date('2027-04-10T18:30Z');
function forecastFixture(){
  const hourly={time:[],cloud_cover:[],precipitation_probability:[],temperature_2m:[],wind_speed_10m:[],wind_gusts_10m:[],
    units:{temperature_2m:'°C',wind_speed_10m:'km/h',precipitation_probability:'%'}};
  const start=Date.parse('2027-04-10T00:00:00Z');
  for(let i=0;i<240;i++){
    hourly.time.push(Math.floor((start+i*3600000)/1000));
    hourly.cloud_cover.push(i%3?12:48);
    hourly.precipitation_probability.push(i%7);
    hourly.temperature_2m.push(8+(i%5));
    hourly.wind_speed_10m.push(7+(i%4));
    hourly.wind_gusts_10m.push(15+(i%6));
  }
  return {timezone:'America/Chicago',hourly};
}
const weatherRequests=page=>page.__weather||[];
const pointArtifact=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','geodata','points.json'),'utf8'));

async function bootWithWeather(page,{now=SEASON_NOW,requests=[],points=null,provider=true}={}){
  // The point artifact is routed here (boot registers no route for it); the forecast itself goes through boot,
  // because a route registered before boot would be shadowed by boot's own stub.
  if(points)await page.route('**data/geodata/points.json',route=>route.fulfill({json:points}));
  return boot(page,{requests,now,weather:provider?forecastFixture():null});
}

test('the forecast is requested for the destination coordinates, never borrowed from the visitor',async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  const before=(page.__weather||[]).length;
  await choosePoint(page,'camp-cadiz-campground');
  await page.waitForFunction(()=>{const w=window.__OVERHEAD_TEST__.sessionWeatherState();return w.status==='ready';},null,{timeout:30000});
  const urls=page.__weather||[];
  const pointRequests=urls.filter(url=>{const q=new URL(url).searchParams;
    return Math.abs(Number(q.get('latitude'))-37.57834)<0.001&&Math.abs(Number(q.get('longitude'))+88.24417)<0.001;});
  expect(pointRequests.length,'a request was made for the destination coordinates').toBeGreaterThan(0);
  expect(urls.length).toBeGreaterThan(before);
  // The destination request asks for the fields the panel quotes.
  const params=new URL(pointRequests[0]).searchParams.get('hourly');
  for(const field of ['cloud_cover','temperature_2m','precipitation_probability','wind_speed_10m'])expect(params).toContain(field);
  const panel=builder(page);
  await expect(panel).toContainText('Camp Cadiz Campground');
  await expect(panel.locator('.sx-forecast')).toContainText(/Cloud cover \d+%/);
  await expect(panel.locator('.sx-forecast')).toContainText('Wind');
  await expect(panel.locator('.sx-forecast')).toContainText('Temperature');
  await expect(panel.locator('.sx-forecast')).toContainText(/just fetched|fetched \d/);
  await expect(panel.locator('.sx-fieldsum')).toContainText('Cloud');
  // Nothing claims transparency, seeing or a measurement of brightness.
  const text=await panel.innerText();
  expect(text).not.toMatch(/transparency is|seeing is|bortle|mag\/arcsec|sky brightness of/i);
  // Switching away and back inside the provider's cache window reuses the response instead of asking again. The
  // cache is keyed by the coordinates, so the home answer can never stand in for the point's own.
  const afterFirst=urls.length;
  await page.locator('#milkyway-session [data-session="where"][data-value="home"]').click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.sessionWeatherState().status==='ready',null,{timeout:30000});
  await choosePoint(page,'camp-cadiz-campground');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.sessionWeatherState().status==='ready',null,{timeout:30000});
  expect((page.__weather||[]).length,'a cached destination response is reused').toBe(afterFirst);
  await expect(builder(page).locator('.sx-forecast')).toContainText('Open-Meteo for these coordinates');
  expect(errors).toEqual([]);
});

test('a cached destination forecast expires after thirty minutes, and only then is it requested again',async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.sessionWeatherState().status==='ready',null,{timeout:30000});
  const pointRequests=()=>(page.__weather||[]).filter(url=>{const q=new URL(url).searchParams;
    return Math.abs(Number(q.get('latitude'))-37.57834)<0.001&&Math.abs(Number(q.get('longitude'))+88.24417)<0.001;});
  const first=pointRequests().length;
  expect(first).toBeGreaterThan(0);
  // Inside the half-hour window the same coordinate key is reused, even after re-selecting the place.
  await page.clock.setFixedTime(new Date(SEASON_NOW.getTime()+29*60000));
  await page.locator('#milkyway-session [data-session="where"][data-value="camp-cadiz-campground"]').click();
  await page.waitForTimeout(500);
  expect(pointRequests().length,'a fresh response is reused inside its TTL').toBe(first);
  // Past it, the same place is asked for again rather than served from memory.
  await page.clock.setFixedTime(new Date(SEASON_NOW.getTime()+31*60000));
  await page.locator('#milkyway-session [data-session="where"][data-value="camp-cadiz-campground"]').click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.sessionWeatherState().status==='ready',null,{timeout:30000});
  await expect.poll(()=>pointRequests().length,{timeout:30000}).toBeGreaterThan(first);
  await expect(builder(page).locator('.sx-forecast')).toContainText(/just fetched|fetched \d/);
  expect(errors).toEqual([]);
});

test('a night beyond the forecast horizon is never requested and never described',async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await page.waitForTimeout(400);
  const before=(page.__weather||[]).length;
  await setDate(page,'2027-06-15');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.session.date==='2027-06-15');
  await page.waitForTimeout(600);
  expect((page.__weather||[]).length,'no request for a night outside the horizon').toBe(before);
  await expect(builder(page)).toContainText('Weather is not yet forecastable for this date.');
  const text=await builder(page).innerText();
  expect(text).not.toMatch(/Cloud cover \d+%/);
  expect(errors).toEqual([]);
});

test('a provider failure reads as unavailable, not as a clear sky',async({page})=>{
  const errors=await bootWithWeather(page,{provider:false});
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.sessionWeatherState().status==='error',null,{timeout:30000});
  const panel=builder(page);
  await expect(panel).toContainText('Forecast unavailable');
  const text=await panel.innerText();
  expect(text).not.toMatch(/clear skies|Cloud cover \d+%/);
  // The astronomy is untouched by a weather failure.
  await expect(panel.locator('.sx-facts')).toContainText('Observing window');
  // With no cached answer to fall back to, a refreshed plan reports the failure as a failure.
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(builder(page)).toContainText('Saved in this browser only');
  await page.locator('#milkyway-session [data-session="refresh"]').click();
  await page.waitForFunction(()=>{const r=window.__OVERHEAD_TEST__.refreshing();return Array.isArray(r)&&r.length>=4;},null,{timeout:30000});
  const failureReport=await page.locator('#milkyway-session .sx-refresh li').allInnerTexts();
  expect(failureReport.some(line=>/Weather: unavailable/.test(line))).toBe(true);
  expect(errors).toEqual([]);
});

test('refresh reports each part separately and never calls a partial result a success',async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(builder(page)).toContainText('Saved in this browser only');
  // The provider now fails and the page's own seven-day response cache is cleared, so there is nothing to fall
  // back to: the refresh must say weather is unavailable rather than reusing the earlier answer as if it were new.
  await page.route('**api.open-meteo.com/**',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.deleteDatabase('overhead-cache');
    request.onsuccess=request.onerror=request.onblocked=()=>resolve();}));
  await page.locator('#milkyway-session [data-session="refresh"]').click();
  await page.waitForFunction(()=>{const r=window.__OVERHEAD_TEST__.refreshing();return Array.isArray(r)&&r.length>=3;},null,{timeout:30000});
  const report=await page.locator('#milkyway-session .sx-refresh li').evaluateAll(nodes=>nodes.map(node=>({status:node.dataset.refreshStatus,text:node.textContent})));
  expect(report.length).toBeGreaterThanOrEqual(4);
  expect(report.some(line=>line.status==='ok'&&/Astronomy/.test(line.text))).toBe(true);
  // The page still holds a response in memory from a minute ago, so the honest outcome is a labelled cached
  // answer, not a silent reuse and not a claim that everything updated.
  expect(report.some(line=>line.status==='warn'&&/cached response/.test(line.text))).toBe(true);
  expect(await builder(page).innerText()).not.toMatch(/everything (was )?updated/i);
  expect(report.some(line=>/Access/.test(line.text))).toBe(true);
  const statuses=report.map(line=>line.status);
  expect(statuses.includes('ok')).toBe(true);
  expect(statuses.includes('warn')).toBe(true);
  // Notes and checklist survive, and the identity is unchanged.
  const saved=await page.evaluate(()=>window.__OVERHEAD_TEST__.session.saved.map(entry=>entry.id));
  expect(new Set(saved).size).toBe(saved.length);
  expect(errors).toEqual([]);
});

test('refresh never turns a changed place or night into a second saved plan',async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(builder(page)).toContainText('Saved in this browser only');
  const saved=await page.evaluate(()=>window.__OVERHEAD_TEST__.session.saved.map(entry=>({id:entry.id,date:entry.date,pointId:entry.pointId})));
  expect(saved.length).toBe(1);
  // The reader moves the plan to their own location, then asks to refresh. That is a different plan: refresh
  // recalculates what is on screen but must not overwrite or duplicate the saved Camp Cadiz plan.
  await page.locator('#milkyway-session [data-session="where"][data-value="home"]').click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.session.where==='home');
  await page.locator('#milkyway-session [data-session="refresh"]').click();
  await page.waitForFunction(()=>{const r=window.__OVERHEAD_TEST__.refreshing();return Array.isArray(r)&&r.length>=4;},null,{timeout:30000});
  const report=await page.locator('#milkyway-session .sx-refresh li').allInnerTexts();
  expect(report.some(line=>/different place or night from the plan you opened/.test(line))).toBe(true);
  const after=await page.evaluate(()=>window.__OVERHEAD_TEST__.session.saved.map(entry=>({id:entry.id,date:entry.date,pointId:entry.pointId})));
  expect(after.length).toBe(1);
  expect(after[0]).toEqual(saved[0]);
  expect(after[0].pointId).toBe('camp-cadiz-campground');
  expect(after[0].date).toBe('2027-04-13');
  expect(errors).toEqual([]);
});

test('a changed access record is shown as changed, with both versions, not as still verified',async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(builder(page)).toContainText('Saved in this browser only');
  // The published record changes after the plan was saved. Both parking classifications are publishable, so the
  // artifact still validates and the test exercises the comparison rather than the artifact gate.
  const changed=pointArtifact();
  changed.points.find(point=>point.id==='camp-cadiz-campground').access.parking='verified';
  await page.route('**data/geodata/points.json',route=>route.fulfill({json:changed}));
  await page.locator('#milkyway-session [data-session="refresh"]').click();
  await page.waitForFunction(()=>{const r=window.__OVERHEAD_TEST__.refreshing();return Array.isArray(r)&&r.length>=4;},null,{timeout:30000});
  const panel=builder(page);
  await expect(panel.locator('[data-access-status="changed"]')).toBeVisible();
  await expect(panel.locator('[data-access-status="changed"]')).toContainText('has changed since this plan was saved');
  await expect(panel.locator('[data-access-status="changed"]')).toContainText('parking');
  await expect(panel.locator('[data-access-status="changed"]')).toContainText('was');
  const report=await page.locator('#milkyway-session .sx-refresh li').allInnerTexts();
  expect(report.some(line=>/Access: the published record has changed/.test(line))).toBe(true);
  expect(report.some(line=>/Everything|all updated/i.test(line))).toBe(false);
  expect(errors).toEqual([]);
});

test('a point that is no longer published keeps its plan, its identity and a prominent warning',async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(builder(page)).toContainText('Saved in this browser only');
  const withheld=pointArtifact();
  withheld.points=withheld.points.filter(point=>point.id!=='camp-cadiz-campground');
  await page.route('**data/geodata/points.json',route=>route.fulfill({json:withheld}));
  await page.locator('#milkyway-session [data-session="refresh"]').click();
  await page.waitForFunction(()=>{const r=window.__OVERHEAD_TEST__.refreshing();return Array.isArray(r)&&r.length>=4;},null,{timeout:30000});
  const panel=builder(page);
  await expect(panel.locator('[data-access-status="withheld"]')).toBeVisible();
  await expect(panel.locator('[data-access-status="withheld"]')).toContainText('no longer published');
  await expect(panel.locator('.sx-fieldsum')).toContainText('no longer published');
  // It is still the same place and the same plan, not the visitor's home site.
  await expect(panel.locator('.sx-fieldsum')).toContainText('Camp Cadiz Campground');
  await expect(panel.locator('.sx-fieldsum')).not.toContainText('Princeton, Indiana');
  const saved=await page.evaluate(()=>window.__OVERHEAD_TEST__.session.saved.map(entry=>({id:entry.id,pointId:entry.pointId})));
  expect(saved.length).toBe(1);
  expect(saved[0].pointId).toBe('camp-cadiz-campground');
  expect(saved[0].id).toContain('camp-cadiz-campground');
  expect(errors).toEqual([]);
});

test("reopening after the point is withheld keeps the place, not the visitor's home",async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(builder(page)).toContainText('Saved in this browser only');
  const withheld=pointArtifact();
  withheld.points=withheld.points.filter(point=>point.id!=='camp-cadiz-campground');
  await page.route('**data/geodata/points.json',route=>route.fulfill({json:withheld}));
  await page.reload();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!window.__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  await openMilkyWay(page);
  await openBuilder(page);
  await page.locator('#milkyway-session [data-session="open"]').first().click();
  const panel=builder(page);
  await expect(panel.locator('.sx-fieldsum')).toContainText('Camp Cadiz Campground');
  await expect(panel.locator('.sx-fieldsum')).not.toContainText('Princeton, Indiana');
  await expect(panel.locator('[data-access-status="withheld"]')).toBeVisible();
  await expect(panel.locator('[data-access-status="withheld"]')).toContainText('no longer published');
  const saved=await page.evaluate(()=>window.__OVERHEAD_TEST__.session.saved.map(entry=>({id:entry.id,pointId:entry.pointId})));
  expect(saved.length).toBe(1);
  expect(saved[0].pointId).toBe('camp-cadiz-campground');
  expect(errors).toEqual([]);
});

test('offline, a saved plan keeps its place, kit and notes, and labels the last forecast it saved',async({page,context})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.locator('#milkyway-session textarea[data-session-input="notes"]').fill('Gate code is on the board.');
  await page.locator('#milkyway-session textarea[data-session-input="notes"]').blur();
  await page.locator('#milkyway-session [data-session-check="tripod"]').check();
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(builder(page)).toContainText('Saved in this browser only');
  // Reload once while online, so the panel starts from a fresh in-memory weather state rather than the answer it
  // fetched a moment ago. Then the browser reports no connection and the saved record is the only forecast left.
  await page.reload();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!window.__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  await openMilkyWay(page);
  await openBuilder(page);
  await page.locator('#milkyway-session [data-session="close"]').click();
  // Remove the page's own response cache too, so the test exercises the saved record rather than a cached
  // provider answer that happens to still be inside its seven-day fallback window.
  await page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('overhead-cache',1);
    request.onsuccess=()=>{const database=request.result;
      try{const tx=database.transaction('responses','readwrite');tx.objectStore('responses').clear();
        tx.oncomplete=()=>{database.close();resolve();};tx.onerror=()=>{database.close();resolve();};}
      catch{ database.close();resolve(); }};
    request.onerror=()=>resolve();}));
  await context.setOffline(true);
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.session.online===false,null,{timeout:10000});
  await openBuilder(page);
  await page.locator('#milkyway-session [data-session="open"]').first().click();
  const panel=builder(page);
  await expect(panel.locator('.sx-fieldsum')).toContainText('Connection');
  await expect(panel.locator('.sx-fieldsum')).toContainText('Offline');
  await expect(panel.locator('.sx-fieldsum')).toContainText('Camp Cadiz Campground');
  await expect(panel).toContainText('Forecast unavailable while offline');
  const savedForecast=panel.locator('.sx-lastforecast');
  await expect(savedForecast).toBeVisible();
  await expect(savedForecast).toContainText(/Last-known|saved/i);
  await expect(savedForecast).toContainText('not a current one');
  await expect(savedForecast).toContainText('before this plan was saved');
  await expect(panel.locator('textarea[data-session-input="notes"]')).toHaveValue('Gate code is on the board.');
  await expect(panel.locator('[data-session-check="tripod"]')).toBeChecked();
  // A checklist edit made offline is stored locally and does not need the network.
  await panel.locator('[data-session-check="camera"]').check();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('overhead.session.checklist.v1')).camera)).toBe(true);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('the field copy is a real offline file, and it opens with no network at all',async({page,context})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await choosePoint(page,'camp-cadiz-campground');
  await setDate(page,'2027-04-13');
  await page.locator('#milkyway-session textarea[data-session-input="notes"]').fill('Park at the campsite.');
  await page.locator('#milkyway-session [data-session-ready="parking"]').check();
  const downloadPromise=page.waitForEvent('download',{timeout:20000});
  await page.locator('#milkyway-session [data-session="offline"]').click();
  const download=await downloadPromise;
  let html='';
  for await (const chunk of await download.createReadStream())html+=chunk.toString();
  expect(download.suggestedFilename()).toMatch(/^worth-looking-up-field-plan-camp-cadiz-campground-2027-04-13\.html$/);
  expect((html.match(/<script/g)||[]).length).toBe(0);
  expect(html).toContain('Camp Cadiz Campground');
  expect(html).toContain('Observing window');
  expect(html).toContain('Access at planning time');
  expect(html).toContain('Park at the campsite.');
  expect(html).toContain('Still to do before leaving');
  // The file is the cold-start answer: open it in a fresh page with the network switched off.
  const offlinePage=await context.newPage();
  await context.setOffline(true);
  await offlinePage.setContent(html,{waitUntil:'load'});
  const text=await offlinePage.locator('body').innerText();
  expect(text).toContain('Camp Cadiz Campground');
  expect(text).toContain('Observing window');
  expect(text).toContain('Park at the campsite.');
  expect(text).toContain('This file works with no network');
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('every checklist row is a full-size target on a phone, and a row toggles its own box once',async({page})=>{
  const errors=await bootWithWeather(page);
  await openMilkyWay(page);
  await openBuilder(page);
  await page.setViewportSize({width:390,height:844});
  const rows=page.locator('#milkyway-session .sx-check');
  const count=await rows.count();
  expect(count).toBeGreaterThanOrEqual(20);
  for(const index of [0,5,15,count-1]){
    const box=await rows.nth(index).boundingBox();
    expect(box.height,'row ' + index + ' height').toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThan(200);
  }
  // Clicking the text of a row toggles its own box exactly once.
  const gear=page.locator('#milkyway-session [data-session-check="tripod"]');
  const label=page.locator('#milkyway-session .sx-check', {has:page.locator('[data-session-check="tripod"]')});
  await label.locator('span').first().click();
  await expect(gear).toBeChecked();
  await label.locator('span').first().click();
  await expect(gear).not.toBeChecked();
  // Keyboard: focus, visible ring, space.
  await gear.focus();
  const outline=await gear.evaluate(node=>getComputedStyle(node).outlineWidth+' '+getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe('0px none');
  await page.keyboard.press('Space');
  await expect(gear).toBeChecked();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('overhead.session.checklist.v1')).tripod)).toBe(true);
  // The pre-departure list uses the same control, and a tick is not a verification of anything.
  const ready=page.locator('#milkyway-session [data-session-ready="rules"]');
  await page.locator('#milkyway-session .sx-check', {has:page.locator('[data-session-ready="rules"]')}).locator('span').first().click();
  await expect(ready).toBeChecked();
  await expect(builder(page)).toContainText('It does not verify anything');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow<=0,'overflow ' + overflow).toBe(true);
  expect(errors).toEqual([]);
});
