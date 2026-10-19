/* Where to go: the regional area explorer, in a real browser.

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
async function boot(page,{requests=[],now=NOW,server=null}={}){
  const errors=[];
  page.on('pageerror',error=>errors.push('pageerror: '+error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push('console: '+message.text());});
  page.on('request',request=>requests.push(request.url()));
  await page.clock.setFixedTime(now);
  await page.route('**/api/analytics/**',route=>route.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',route=>route.fulfill({json:[ISS]}));
  await page.route('**api.open-meteo.com/**',route=>route.fulfill({status:503,body:'unavailable'}));
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

test('the explorer is in the Milky Way category, loads only when opened, and shows areas not observation points',async({page})=>{
  const requests=[];
  const errors=await boot(page,{requests});
  // Nothing about places is fetched or loaded before the category is chosen.
  expect(await page.evaluate(()=>!!window.OverheadSites)).toBe(false);
  expect(requests.some(url=>/overhead-sites\.js|sites\.json/.test(url))).toBe(false);
  await openMilkyWay(page);
  await expect(section(page)).toBeVisible();
  await expect(section(page)).toContainText('Where to go');
  await expect(section(page)).toContainText('Show areas near me');
  // Still nothing: the section is a door, not a download.
  expect(requests.some(url=>/overhead-sites\.js|sites\.json/.test(url))).toBe(false);
  await openExplorer(page);
  const loaded=requests.filter(url=>/overhead-sites\.js|sites\.json/.test(url));
  expect(loaded.length).toBeGreaterThanOrEqual(2);
  expect(loaded.every(url=>url.startsWith('http://127.0.0.1'))).toBe(true);
  // Four researched areas, and the caveat that they are areas.
  await expect(page.locator('.whereto-area')).toHaveCount(4);
  await expect(section(page)).toContainText('not observation points');
  await expect(section(page)).toContainText('nearest mapped edge');
  await expect(section(page)).toContainText('No basemap is shown');
  // No darkness claim of any kind.
  const text=await section(page).innerText();
  expect(text).not.toMatch(/bortle|mag\/arcsec|mcd|dark sky|darkness rating/i);
  expect(text).toContain('Local artificial sky brightness has not yet been assessed');
  expect(errors).toEqual([]);
});

test('the list is the interface and the map agrees with it',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openExplorer(page);
  const listed=await page.locator('.whereto-area').evaluateAll(nodes=>nodes.map(node=>({
    id:node.dataset.area, name:node.querySelector('.whereto-name').textContent.trim() })));
  expect(listed.length).toBe(4);
  const mapLabel=await page.locator('.whereto-map svg').getAttribute('aria-label');
  expect(mapLabel).toContain('Mapped outlines of 4 published areas');
  expect(await page.locator('.whereto-map path').count()).toBe(4);
  const mapTitles=await page.locator('.whereto-map path title').allTextContents();
  for(const entry of listed)expect(mapTitles).toContain(entry.name);
  // Ordered by name, and nothing that looks like a ranking.
  const names=listed.map(entry=>entry.name);
  expect(names).toEqual([...names].sort((a,b)=>a.localeCompare(b)));
  expect(await section(page).innerText()).not.toMatch(/best|top pick|rank/i);
  // Each area carries its manager, its evidence and its official link.
  const first=page.locator('.whereto-area').first();
  await first.locator('summary').click();
  await expect(first).toContainText('Manager');
  await expect(first).toContainText('After-dark access');
  await expect(first).toContainText('Evidence');
  await expect(first).toContainText('Still unknown');
  const links=first.locator('a[href^="https://"]');
  expect(await links.count()).toBeGreaterThanOrEqual(2);
  for(const href of await links.evaluateAll(nodes=>nodes.map(node=>node.href))){
    expect(href).toMatch(/^https:\/\/(www\.)?(in\.gov|fs\.usda\.gov|usgs\.gov)/);
  }
  expect(errors).toEqual([]);
});

test('the visitor\'s own window is shown as theirs, and an empty horizon is not a reason to travel',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openExplorer(page);
  const text=await section(page).innerText();
  expect(text).toContain('Your window, at your location');
  // October at 38.4 N: no qualifying window, and the section says so without pushing a trip.
  expect(await section(page).getAttribute('data-window-empty')).toBe('true');
  expect(text).toContain('not a reason to travel tonight');
  expect(text).toContain('no area here has a verified observation point');
  expect(errors).toEqual([]);
});

test('an unsupported region is explained, and the Milky Way calculations keep working there',async({page})=>{
  const errors=await boot(page);
  // Move to Cape Town through the real location controls before opening the category.
  await page.route('**geocoding-api.open-meteo.com/**',route=>route.fulfill({json:{results:[
    {name:'Cape Town',admin1:'Western Cape',country:'South Africa',latitude:-33.9249,longitude:18.4241,
      timezone:'Africa/Johannesburg'}]}}));
  await page.click('#location-open');
  await page.fill('#search','Cape Town');
  await page.click('#search-form button[type="submit"]');
  await page.locator('#search-results button').first().click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.state.site.lat<-30,null,{timeout:60000});
  await openMilkyWay(page);
  await page.locator('#whereto-open').click();
  await expect(section(page)).toContainText('Location exploration is available in');
  expect(await page.locator('.whereto-area').count()).toBe(0);
  const text=await section(page).innerText();
  expect(text).toContain('continue worldwide');
  expect(text).not.toContain('nearest mapped edge');
  // The category itself is unaffected: the core window is real in Cape Town in October.
  expect(await page.locator('#celestial-events article.celestial-card').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a failed data load says so and can be retried',async({page})=>{
  const errors=await boot(page);
  let fail=true;
  await page.route('**/data/geodata/sites.json',route=>fail?route.fulfill({status:500,body:'boom'}):route.continue());
  await openMilkyWay(page);
  await page.locator('#whereto-open').click();
  await expect(section(page)).toContainText('could not be loaded');
  await expect(section(page)).toContainText('unaffected');
  await expect(page.locator('#whereto-retry')).toBeVisible();
  fail=false;
  await page.locator('#whereto-retry').click();
  await page.waitForFunction(()=>document.querySelectorAll('.whereto-area').length>0,null,{timeout:60000});
  await expect(page.locator('.whereto-area')).toHaveCount(4);
  expect(errors.length).toBe(0);
});

test('keyboard and screen-reader use: the button, the summaries and the map label',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  const open=page.locator('#whereto-open');
  await open.focus();
  expect(await page.evaluate(()=>document.activeElement.id)).toBe('whereto-open');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.whereto-area').length>0,null,{timeout:60000});
  // The section and the map are labelled; the list is a set of native disclosures.
  await expect(section(page)).toHaveAttribute('aria-label','Where to go');
  const svg=page.locator('.whereto-map svg');
  await expect(svg).toHaveAttribute('role','img');
  await expect(svg).toHaveAttribute('aria-label',/Mapped outlines of 4 published areas/);
  const summary=page.locator('.whereto-area').first().locator('summary');
  await summary.focus();
  expect(await page.evaluate(()=>document.activeElement.tagName)).toBe('SUMMARY');
  await page.keyboard.press('Enter');
  expect(await page.locator('.whereto-area').first().evaluate(node=>node.open)).toBe(true);
  // The focus ring is visible rather than removed.
  const outline=await summary.evaluate(node=>{node.focus();return getComputedStyle(node).outlineStyle;});
  expect(outline).not.toBe('none');
  expect(errors).toEqual([]);
});

test('four widths, both themes, no overflow and no homepage regression',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openExplorer(page);
  const snapshot=async()=>page.evaluate(()=>{
    const node=document.getElementById('milkyway-whereto');
    return { text:node.innerText.replace(/\s+/g,' ').trim(), areas:document.querySelectorAll('.whereto-area').length };
  });
  const dark=await snapshot();
  expect(dark.areas).toBe(4);
  for(const width of [390,768,1280,1440]){
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(150);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    await expect(section(page)).toBeVisible();
    const box=await section(page).boundingBox();
    expect(box.width).toBeLessThanOrEqual(width);
    // The map never pushes the layout wider than the page.
    expect(await page.evaluate(()=>{const svg=document.querySelector('.whereto-map svg');
      return svg?Math.round(svg.getBoundingClientRect().right):0;})).toBeLessThanOrEqual(width);
    expect(await snapshot()).toEqual(dark);
  }
  await page.setViewportSize({width:390,height:900});
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Use light theme'}).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(1,1);
  expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');
  expect(await snapshot()).toEqual(dark);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({fullPage:true,path:'/tmp/whereto-light-390.png'});
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Use dark theme'}).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(1,1);
  // Homepage geometry is untouched: the first opportunity sits where it did before this release.
  await page.locator('[data-category="satellites"]').click();
  await page.waitForTimeout(300);
  const layout=await page.evaluate(()=>{const hero=document.querySelector('.sky-intro');
    return {heroHeight:Math.round(hero?hero.getBoundingClientRect().height:-1),
      scroll:document.documentElement.scrollWidth,width:innerWidth};});
  expect(layout.scroll).toBe(layout.width);
  expect(layout.heroHeight).toBeGreaterThan(0);
  await page.setViewportSize({width:390,height:900});
  expect(await page.evaluate(()=>Math.round(document.querySelector('.sky-intro').getBoundingClientRect().height)))
    .toBeLessThan(240);
  expect(errors).toEqual([]);
});

test('other categories are unaffected, and the explorer hides when the category changes',async({page})=>{
  const errors=await boot(page);
  await openMilkyWay(page);
  await openExplorer(page);
  await expect(section(page)).toBeVisible();
  await page.locator('[data-category="planets"]').click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.celestial.result?.category==='planets',null,{timeout:60000});
  await expect(section(page)).toBeHidden();
  expect(await page.locator('#celestial-events article.celestial-card').count()).toBeGreaterThan(0);
  await page.locator('[data-category="satellites"]').click();
  await page.waitForFunction(()=>{const list=document.getElementById('events');
    return !!list&&(list.querySelectorAll('.event').length>0||list.querySelector('.empty'));},null,{timeout:60000});
  expect(await page.evaluate(()=>{const list=document.getElementById('events');
    return list.querySelectorAll('.event').length>0||!!list.querySelector('.empty');})).toBe(true);
  // Coming back keeps the explorer without refetching it.
  const requests=[];
  page.on('request',request=>requests.push(request.url()));
  await openMilkyWay(page);
  await expect(page.locator('.whereto-area')).toHaveCount(4);
  expect(requests.some(url=>/sites\.json/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

// The artifact carries the date its evidence was read. These two tests serve altered copies of it, because
// the states they cover are about time and emptiness rather than about the four areas that are live today.
const artifactPath=path.join(__dirname,'..','data','geodata','sites.json');
const liveArtifact=()=>JSON.parse(fs.readFileSync(artifactPath,'utf8'));

test('expired access evidence is withheld, named and never shown as available',async({page})=>{
  const errors=await boot(page);
  // A year and a month later the same artifact must stop presenting the old permission as current.
  const aged=liveArtifact();
  aged.checked_at='2025-09-01';
  for(const area of aged.areas)area.verifiedAt='2025-09-01';
  await page.route('**/data/geodata/sites.json',route=>route.fulfill({json:aged}));
  await openMilkyWay(page);
  await page.locator('#whereto-open').click();
  await expect(section(page)).toContainText('No area currently meets the publication rule',{timeout:60000});
  expect(await page.locator('.whereto-area').count()).toBe(0);
  expect(await page.locator('.whereto-map path').count()).toBe(0);
  const withheld=page.locator('.whereto-withheld');
  await expect(withheld).toHaveCount(1);
  await expect(withheld).toContainText('Withheld: verification expired');
  await expect(withheld).toContainText('last confirmed 2025-09-01');
  const links=withheld.locator('a[href^="https://"]');
  expect(await links.count()).toBe(4);
  // The shared limitations and the sky sentence survive the empty state.
  await expect(section(page)).toContainText('Local artificial sky brightness has not yet been assessed');
  expect(await section(page).innerText()).not.toMatch(/bortle|dark sky/i);
  expect(errors).toEqual([]);
});

test('an artifact with no areas explains the rule instead of showing an empty list',async({page})=>{
  const errors=await boot(page);
  const empty=liveArtifact();
  empty.areas=[];
  empty.publication={...empty.publication,publishedAreas:0,excludedCount:11};
  await page.route('**/data/geodata/sites.json',route=>route.fulfill({json:empty}));
  await openMilkyWay(page);
  await page.locator('#whereto-open').click();
  await expect(section(page)).toContainText('No area currently meets the publication rule',{timeout:60000});
  await expect(section(page)).toContainText('Areas are published only when the managing agency documents after-dark access');
  expect(await page.locator('.whereto-area').count()).toBe(0);
  expect(await page.locator('.whereto-empty').count()).toBe(1);
  // The Milky Way calculations above are untouched by an empty area list.
  await expect(page.locator('#celestial-events')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

/* ---- verified observation points ----------------------------------------------------------------
   The April clock is used here because a point shows tonight's window at its own coordinates, and in October
   there is none: both states must exist and both must be honest. */
const APRIL=new Date('2027-04-13T04:00Z');

 test('points are listed apart from areas, with provenance, terrain and official evidence',async({page})=>{
  const errors=await boot(page,{now:APRIL});
  await openMilkyWay(page);
  await openExplorer(page);
  await page.waitForFunction(()=>document.querySelectorAll('.whereto-point').length>0,null,{timeout:60000});
  const points=page.locator('.whereto-point');
  expect(await points.count()).toBe(3);
  expect(await page.locator('.whereto-area').count()).toBe(4);
  expect(await page.locator('.whereto-map .whereto-point-mark').count()).toBe(3);
  const mapLabel=await page.locator('.whereto-map svg').getAttribute('aria-label');
  expect(mapLabel).toContain('3 verified observation points');
  // A point is labelled as a point and carries its facility type.
  const first=points.first();
  await expect(first.locator('.whereto-chip[data-kind="point"]')).toHaveText('point');
  await expect(first.locator('summary')).toContainText(/campground|trailhead/);
  await first.locator('summary').click();
  const text=await first.innerText();
  expect(text).toContain('Coordinates');
  expect(text).toMatch(/agency-marker|mapped-facility-node/);
  expect(text).toContain('Night presence');
  expect(text).toContain('Parking');
  expect(text).toContain('Evidence');
  expect(text).toContain('Tonight at this point');
  expect(text).toContain('Reference night 2027-04-13');
  expect(text).toContain('Terrain');
  expect(text).toMatch(/modelled terrain horizon/);
  expect(text).toContain('uncertainty');
  expect(text).toContain('Local artificial sky brightness has not yet been assessed');
  expect(text).not.toMatch(/bortle|mag\/arcsec|drive time|travel time/i);
  const links=first.locator('a[href^="https://"]');
  expect(await links.count()).toBeGreaterThanOrEqual(2);
  for(const href of await links.evaluateAll(nodes=>nodes.map(node=>node.href))){
   expect(href).toMatch(/^https:\/\/(www\.)?(apps\.)?(fs\.usda\.gov|usgs\.gov|openstreetmap\.org)/);
  }
  expect(errors).toEqual([]);
 });

 test('a point computes its own window, keeps the home site, and exports an entry that names the point',async({page})=>{
  const errors=await boot(page,{now:APRIL});
  await openMilkyWay(page);
  await openExplorer(page);
  await page.waitForFunction(()=>document.querySelectorAll('.whereto-point').length>0,null,{timeout:60000});
  const home=await page.evaluate(()=>JSON.parse(JSON.stringify(window.__OVERHEAD_TEST__.state.site)));
  const point=page.locator('.whereto-point').first();
  await point.locator('summary').click();
  const tonight=await point.innerText();
  expect(tonight).toMatch(/Window \d+:\d+ [AP]M–\d+:\d+ [AP]M \(\d+ min\)/);
  expect(tonight).toMatch(/The core reaches \d+\.\d° towards [A-Z]/);
  expect(tonight).toContain('astronomical darkness');
  expect(tonight).toMatch(/Window quality \d+\/100/);
  // The visitor's own site is untouched by inspecting a point.
  expect(await page.evaluate(()=>JSON.parse(JSON.stringify(window.__OVERHEAD_TEST__.state.site)))).toEqual(home);
  expect(home.name).toContain('Princeton');
  // The point's event names the point and its own coordinates.
  const built=await page.evaluate(()=>{
   const hook=window.__OVERHEAD_TEST__;
   const item=[...hook.calendarItems.values()].find(entry=>entry.site&&entry.event.target&&/milkyway/.test(entry.event.category));
   if(!item)return null;
   const calendar=hook.calendar.single(item,hook.calendarOptions({source:item.source,site:item.site,timezone:item.site.tz}));
   return {site:item.site,title:item.event.title,ics:calendar.ics,eligible:calendar.eligible};
  });
  expect(built).not.toBeNull();
  expect(built.eligible).toBe(true);
  expect(built.site.name).not.toBe(home.name);
  expect(built.title).toContain(built.site.name);
  const ics=built.ics.replace(/\r\n[ \t]/g,'');
  expect(ics).toContain('LOCATION:'+built.site.name);
  expect(ics).toMatch(/DTSTART:|DTEND:/);
  // The plan takes the same identity, and the home site stays where it was.
  await point.locator('[data-plan-toggle]').first().click();
  await expect(page.locator('#observing-plan')).toBeVisible();
  const planned=await page.evaluate(()=>[...window.__OVERHEAD_TEST__.observingPlan.values()].map(entry=>({
   title:entry.event.title,site:entry.site})));
  expect(planned.length).toBeGreaterThanOrEqual(1);
  expect(planned[0].title).toContain(built.site.name);
  expect(await page.evaluate(()=>JSON.parse(JSON.stringify(window.__OVERHEAD_TEST__.state.site)))).toEqual(home);
  expect(errors).toEqual([]);
 });

 test('points keep four widths, both themes and no overflow',async({page})=>{
  const errors=await boot(page,{now:APRIL});
  await openMilkyWay(page);
  await openExplorer(page);
  await page.waitForFunction(()=>document.querySelectorAll('.whereto-point').length>0,null,{timeout:60000});
  await setViewportAndOpen(page,390);
  for(const width of [390,768,1280,1440]){
   await page.setViewportSize({width,height:1000});
   await page.waitForTimeout(200);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
   await expect(page.locator('.whereto-points')).toBeVisible();
   const box=await page.locator('.whereto-points').boundingBox();
   expect(box.width).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({width:390,height:900});
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Use light theme'}).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(1,1);
  expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  expect(await page.locator('.whereto-point').count()).toBe(3);
  expect(errors).toEqual([]);
 });

async function setViewportAndOpen(page,width){
 await page.setViewportSize({width,height:1000});
}
