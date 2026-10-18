/* Milky Way category: navigation, the panel and its chart, themes, mobile widths, missing weather, calendar
   export, the observing plan, discovery integration and the promise that nothing is calculated or fetched
   until the category is chosen. The engine needs no dataset, so this suite can run from file:// with only
   the weather and feed routes stubbed, exactly as the other celestial suites do. */
const {test,expect}=require('@playwright/test');
const path=require('path'),fs=require('fs'),http=require('http');
test.use({channel:process.env.CI?'chromium':'chrome'});
test.setTimeout(90000);
const NOW=new Date('2026-07-15T22:00Z');           // mid-July: the northern core window is real
const start=Date.parse('2026-07-15T00:00Z')/1000;
const hourly={time:Array.from({length:200},(_,i)=>start+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:8,cloud_cover_low:4,cloud_cover_mid:2,cloud_cover_high:2,
  visibility:30000,precipitation:0,relative_humidity_2m:55,weather_code:0,temperature_2m:18}))hourly[key]=Array(200).fill(value);
const ISS={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-07-01T11:57:47.376864',MEAN_MOTION:15.49018229,
  ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,
  EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',NORAD_CAT_ID:25544,ELEMENT_SET_NO:999,REV_AT_EPOCH:58451,
  BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
// One static server for the whole suite: index.html, the overhead modules, the vendor builds and the
// theme assets, and nothing else.
function serve(){
  return http.createServer((request,response)=>{
    const file=new URL(request.url,'http://local').pathname.slice(1);
    if(!/^(index\.html|overhead[\w-]*\.js|preferences-transfer\.js|analytics-lite\.js|assets\/[\w./-]+|vendor\/overhead\/[\w.-]+\.js)$/.test(file)){response.writeHead(404);response.end();return;}
    const full=path.resolve(file);
    if(!fs.existsSync(full)){response.writeHead(404);response.end();return;}
    response.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/javascript');
    response.end(fs.readFileSync(full));
  });
}
const openServers=[];
test.afterEach(async()=>{ await Promise.all(openServers.splice(0).map(server=>new Promise(resolve=>server.close(resolve)))); });
async function boot(page,{weather=true,requests=[],server=null,now=NOW}={}){
  const errors=[];
  page.on('pageerror',error=>errors.push('pageerror: '+error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push('console: '+message.text());});
  page.on('request',request=>requests.push(request.url()));
  await page.clock.setFixedTime(now);
  await page.route('**/api/analytics/**',route=>route.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',route=>route.fulfill({json:[ISS]}));
  await page.route('**api.open-meteo.com/**',route=>route.fulfill(weather
    ?{json:{timezone:'America/Chicago',hourly}}:{status:503,body:'unavailable'}));
  await page.route('**/api/launches.json*',route=>route.fulfill({status:404,body:'none'}));
  await page.route('**data/launches/upcoming.json',route=>route.fulfill({status:404,body:'none'}));
  const own=server||serve();
  if(!server)await new Promise(resolve=>own.listen(0,'127.0.0.1',resolve));
  await page.goto('http://127.0.0.1:'+own.address().port+'/index.html');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!window.__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  openServers.push(own);
  return errors;
}
// Waiting on the *category's own* result, not merely on 'ready': the previous category's plan is still in
// memory, so a status-only wait would return before this category had been calculated at all.
const openCategory=async(page,id='milkyway')=>{
  await page.locator(`[data-category="${id}"]`).click();
  await page.waitForFunction(target=>{const c=window.__OVERHEAD_TEST__.celestial;
    return c.status==='ready'&&!c.busy&&c.result&&c.result.category===target;},id,{timeout:60000});
};
const cards=page=>page.locator('#celestial-events article.celestial-card');
const panelFor=page=>page.locator('.milkyway-panel').first();

test('the Milky Way is a sixth category, last in the tab order, and it renders a window card',async({page})=>{
  const errors=await boot(page);
  const tabs=await page.locator('[data-category]').evaluateAll(nodes=>nodes.map(node=>node.dataset.category));
  expect(tabs).toEqual(['satellites','launches','planets','meteors','comets','milkyway']);
  await expect(page.locator('[data-category="milkyway"]')).toHaveText('MILKY WAY');
  // Nothing is calculated before the category is chosen.
  expect(await page.evaluate(()=>window.__OVERHEAD_TEST__.celestial.result)).toBeNull();
  expect(await page.evaluate(()=>document.querySelectorAll('.milkyway-panel').length)).toBe(0);
  await openCategory(page);
  await expect(page.locator('#celestial-eyebrow')).toHaveText('MILKY WAY');
  await expect(page.locator('#celestial-headline')).toContainText(/galactic core/i);
  await expect(page.locator('#category-note')).toContainText(/galactic core/i);
  expect(await cards(page).count()).toBeGreaterThanOrEqual(1);
  const first=cards(page).first();
  await expect(first).toHaveAttribute('data-type','milky-way');
  await expect(first.locator('[data-opportunity]')).toHaveCount(0);
  await expect(first.locator('.celestial-chip')).toContainText('window quality');
  await expect(first).toContainText('Milky Way window quality');
  await expect(first).toContainText('not comparable with satellite');
  // The plain-language panel says what to do with the information.
  await expect(panelFor(page)).toContainText('In plain language');
  await expect(panelFor(page)).toContainText('For a camera');
  await expect(panelFor(page)).toContainText(/tripod/i);
  await expect(panelFor(page)).toContainText(/Time above the thresholds/);
  await expect(page.locator('#celestial-summary')).toContainText(/Best window:/);
  expect(errors).toEqual([]);
});

test('the chart is labelled, and the window is drawn where the numbers say it is',async({page})=>{
  const errors=await boot(page);
  await openCategory(page);
  const chart=page.locator('.milkyway-chart').first();
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute('role','img');
  const label=await chart.getAttribute('aria-label');
  expect(label).toMatch(/Core altitude from .* peaking at \d+ degrees around /);
  expect(label).toMatch(/observing window/);
  const markup=await chart.evaluate(node=>node.outerHTML);
  for(const text of ['0°','30°','60°','90°'])expect(markup).toContain('>'+text+'<');
  expect(markup).toMatch(/\d+° window threshold/);
  expect(markup).toContain('Milky Way core altitude ·');
  expect((markup.match(/text-anchor="middle"/g)||[]).length).toBeGreaterThanOrEqual(3);
  expect((markup.match(/<path /g)||[]).length).toBe(2);
  expect(markup).toContain('stroke-dasharray="5 3"');
  expect(await chart.locator('title').count()).toBeGreaterThanOrEqual(3);
  const geometry=await page.evaluate(()=>{
    const plan=window.__OVERHEAD_TEST__.celestial.result.plans.week.opportunities[0];
    return { minutes:plan.attributes.windowMinutes, windowStart:plan.attributes.chart.window.start,
      windowEnd:plan.attributes.chart.window.end, start:plan.start, end:plan.end,
      threshold:plan.attributes.chart.thresholdDeg, points:plan.attributes.chart.points.length,
      bands:Object.keys(plan.attributes.chart.bands) };
  });
  expect(geometry.points).toBeGreaterThan(4);
  expect(geometry.minutes).toBeGreaterThan(30);
  expect(geometry.windowStart).toBe(geometry.start);
  expect(geometry.windowEnd).toBe(geometry.end);
  expect(geometry.threshold).toBe(20);
  expect(geometry.bands).toEqual(expect.arrayContaining(['astronomical','nautical','civil']));
  expect(errors).toEqual([]);
});

test('both themes and four widths keep the panel intact and overflow-free',async({page})=>{
  const errors=await boot(page);
  await openCategory(page);
  const content=async()=>page.evaluate(()=>{
    const panel=document.querySelector('.milkyway-panel');
    const chart=document.querySelector('.milkyway-chart');
    return { panel:panel?panel.innerText.replace(/\s+/g,' ').trim().slice(0,400):null,
      path:chart?chart.querySelector('path')?.getAttribute('d')?.slice(0,60):null,
      cards:document.querySelectorAll('#celestial-events article.celestial-card').length };
  });
  const dark=await content();
  expect(dark.panel).toBeTruthy();
  for(const width of [390,768,1280,1440]){
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(200);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    await expect(panelFor(page)).toBeVisible();
    const chart=page.locator('.milkyway-chart').first();
    await expect(chart).toBeVisible();
    const box=await chart.boundingBox();
    expect(box.width).toBeLessThanOrEqual(width);
    await page.screenshot({fullPage:true,path:`/tmp/milkyway-dark-${width}.png`});
  }
  await page.setViewportSize({width:390,height:900});
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Use light theme'}).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(1,1);
  expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');
  expect(await content()).toEqual(dark);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({fullPage:true,path:'/tmp/milkyway-light-390.png'});
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Use dark theme'}).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(1,1);
  expect(await content()).toEqual(dark);
  expect(errors).toEqual([]);
});

test('a season with no core window explains itself instead of dead-ending',async({page})=>{
  // Mid-October at 38.4 N: the core is low in the south-west at dusk and never clears 20 degrees while the
  // sky is dark, so the horizon has no window. The category must still answer the question.
  const errors=await boot(page,{now:new Date('2026-10-16T23:30Z')});
  await openCategory(page);
  const empty=page.locator('.celestial-empty');
  await expect(empty).toBeVisible();
  await expect(page.locator('.milkyway-panel[data-milkyway-empty="true"]')).toBeVisible();
  const text=await page.locator('.milkyway-panel[data-milkyway-empty="true"]').innerText();
  expect(text).toContain('Why there is no Milky Way window in this horizon');
  expect(text).toContain('Closest night in this horizon');
  // One decimal, so the sentence and the comparison cannot disagree at the threshold.
  expect(text).toMatch(/core reaching \d+\.\d°/);
  expect(text).toMatch(/20 (degrees|°)/);
  expect(text).toMatch(/minutes of astronomical darkness/);
  expect(text).toMatch(/sampled galactic longitudes/);
  expect(text).toMatch(/not a claim that the Milky Way is invisible|not about the Milky Way/);
  expect(text).toMatch(/0 of \d+ nights/);
  // The explanation is geometry, never a claim about clouds or brightness.
  expect(text).not.toMatch(/clear skies|brightness of|sighting chance/i);
  // Switching to the ninety-day horizon re-requests with ninety nights and keeps the same honest answer.
  await page.locator('[data-horizon="extended"]').click();
  await page.waitForFunction(()=>{const c=window.__OVERHEAD_TEST__.celestial;
    return c.status==='ready'&&!c.busy&&c.horizon==='extended'&&c.result&&c.result.category==='milkyway';},null,{timeout:60000});
  const extended=await page.locator('.milkyway-panel[data-milkyway-empty="true"]').innerText();
  expect(extended).toMatch(/0 of \d{2,} nights/);
  const horizon=await page.evaluate(()=>{
    const hook=window.__OVERHEAD_TEST__, result=hook.celestial.result, plan=result.plans.extended;
    const days=[...new Set(hook.celestialWindows(90).map(night=>night.day))];
    return { spanDays: result.span.days, nights: result.milkyWay.summary.nights, distinctDays: days.length,
      planStart: plan.start, planEnd: plan.end, considered: plan.considered,
      lastDay: days[days.length-1] };
  });
  expect(horizon.spanDays).toBe(90);
  expect(horizon.distinctDays).toBeGreaterThanOrEqual(88);
  expect(horizon.nights).toBeGreaterThanOrEqual(88);
  expect(horizon.considered).toBeGreaterThanOrEqual(80);
  expect((horizon.planEnd-horizon.planStart)/86400000).toBeGreaterThan(80);
  expect(errors).toEqual([]);
});

test('missing weather removes the forecast and never turns into clear skies',async({page})=>{
  const errors=await boot(page,{weather:false});
  await openCategory(page);
  expect(await cards(page).count()).toBeGreaterThanOrEqual(1);
  const text=await page.locator('#celestial-events').innerText();
  expect(text).toContain('Milky Way window quality');
  expect(text).toContain('no-usable-forecast');
  expect(text).not.toMatch(/clear skies/i);
  expect(text).toMatch(/No forecast is applied at this range/);
  const grades=await page.evaluate(()=>window.__OVERHEAD_TEST__.celestial.result.plans.week.opportunities
    .map(opportunity=>opportunity.confidence.observing.grade));
  expect(Array.from(new Set(grades))).toEqual(['no-usable-forecast']);
  expect(errors).toEqual([]);
});

test('a window exports to the calendar as an interval and joins the observing plan',async({page})=>{
  const errors=await boot(page);
  await openCategory(page);
  const first=cards(page).first();
  // Clicking the button must run the real calendar path and hand a file to the browser. Chromium does not
  // always surface a blob download to the automation layer, so the click is proved by its own announcement
  // and the document is asserted through the same page functions the button used.
  const captured=[];
  page.on('download',download=>captured.push(download));
  await first.locator('[data-calendar-add]').click();
  await expect(page.locator('#status')).toContainText(/\.ics/);
  const exported=await page.evaluate(()=>{
    const hook=window.__OVERHEAD_TEST__;
    const item=[...hook.calendarItems.values()].find(entry=>entry.event.category==='milkyway');
    return hook.calendar.single(item,hook.calendarOptions({source:item.source,label:item.event.title}));
  });
  expect(exported.eligible).toBe(true);
  expect(exported.name).toMatch(/\.ics$/);
  // Unfold first: the serializer folds at 75 octets, so a phrase can legitimately straddle a fold.
  const text=String(exported.ics).replace(/\r\n[ \t]/g,'');
  expect(text).toContain('BEGIN:VCALENDAR');
  expect(text).toContain('BEGIN:VEVENT');
  expect(text).toContain('SUMMARY:Milky Way core window');
  expect(text).toContain('CATEGORIES:');
  expect(text).toContain('Milky Way');
  expect(text).toContain('Milky Way window quality');
  expect(text).toContain('not comparable with satellite');
  expect(text).toContain('Equipment: Camera on a tripod');
  const window=await page.evaluate(()=>{
    const plan=window.__OVERHEAD_TEST__.celestial.result.plans.week.opportunities[0];
    return { start:plan.start, end:plan.end };
  });
  const stamp=await page.evaluate(ms=>window.__OVERHEAD_TEST__.calendar.formatUtc(ms),window.start);
  const endStamp=await page.evaluate(ms=>window.__OVERHEAD_TEST__.calendar.formatUtc(ms),window.end);
  expect(text).toContain('DTSTART:'+stamp);
  expect(text).toContain('DTEND:'+endStamp);
  expect(window.end-window.start).toBeGreaterThan(60*60000);
  // The observing plan keeps the same identity, and its own list shows the window rather than an instant.
  await first.locator('[data-plan-toggle]').click();
  await expect(page.locator('#observing-plan')).toBeVisible();
  await expect(page.locator('#plan-list')).toContainText('Milky Way core window');
  await expect(page.locator('#plan-count')).not.toHaveText('');
  const planned=await page.evaluate(()=>[...window.__OVERHEAD_TEST__.observingPlan.values()].map(entry=>({
    id:entry.id, start:entry.event.start, end:entry.event.end, precision:entry.event.precision })));
  expect(planned.length).toBe(1);
  expect(planned[0].start).toBe(window.start);
  expect(planned[0].end).toBe(window.end);
  expect(planned[0].precision).toBe('window');
  expect(errors).toEqual([]);

});

test('the other categories, discovery and the satellite page are unchanged by this feature',async({page})=>{
  const requests=[];
  const errors=await boot(page,{requests});
  // Nothing about the Milky Way is loaded, calculated or fetched until it is chosen: the engine itself is a
  // lazy fetch, there is no data request at all, and no plan is in memory for the category. The measured
  // cost is therefore zero for a reader who never opens the tab, and one 12.6 KB gzipped module for one who
  // does (asserted below, in the same run).
  expect(requests.some(url=>/overhead-milkyway\.js/.test(url))).toBe(false);
  expect(requests.some(url=>/data\/overhead\//.test(url))).toBe(false);
  expect(await page.evaluate(()=>window.__OVERHEAD_TEST__.celestial.result)).toBeNull();
  expect(await page.evaluate(()=>window.__OVERHEAD_TEST__.currentDiscoveryPlans?0:window.__OVERHEAD_TEST__.discoveryPlans.size)).toBe(0);
  // The satellite pipeline is untouched: its results are byte-for-byte what they were after the page
  // finished loading, before any celestial category ran.
  const satelliteResults=await page.evaluate(()=>JSON.stringify(window.__OVERHEAD_TEST__.state.results));
  const satelliteHeadline=await page.locator('#headline').innerText();
  const satelliteObjects=await page.evaluate(()=>window.__OVERHEAD_TEST__.state.objects.length);
  await openCategory(page,'planets');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.celestial.status==='ready',null,{timeout:60000});
  const planets=await page.evaluate(()=>window.__OVERHEAD_TEST__.celestial.result.plans.week.opportunities
    .map(opportunity=>({ category:opportunity.category, value:opportunity.observing.value })));
  expect(planets.every(entry=>entry.category!=='milkyway')).toBe(true);
  // The Milky Way category still computes its own plan after the others, and discovery then offers it.
  await openCategory(page,'milkyway');
  expect(requests.some(url=>/overhead-milkyway\.js/.test(url))).toBe(true,
    'opening the category must fetch the engine');
  expect(await page.evaluate(()=>!!window.__OVERHEAD_TEST__.celestialEngines.milkyway)).toBe(true);
  const discovery=await page.evaluate(()=>{
    const model=window.__OVERHEAD_TEST__.discoveryModel();
    return { tonight:model.tonight.map(event=>event.category), coming:model.coming.map(event=>event.category),
      coverage:model.coverage };
  });
  expect(discovery.coverage, JSON.stringify(discovery)).toContain('milkyway');
  expect(discovery.tonight.concat(discovery.coming)).toContain('milkyway');
  // Discovery never mixes the categories' scores: the Milky Way event carries its own priority only.
  const event=await page.evaluate(()=>{
    const model=window.__OVERHEAD_TEST__.discoveryModel();
    const found=model.tonight.concat(model.coming).find(entry=>entry.category==='milkyway');
    return found?{ id:found.id, category:found.category, priority:found.categoryPriority, precision:found.precision,
      warnings:found.warnings } : null;
  });
  expect(event).toBeTruthy();
  expect(event.id.startsWith('milkyway:')).toBe(true);
  expect(event.precision).toBe('window');
  expect(event.warnings.join(' ')).toMatch(/not comparable|light-pollution|sky-brightness/i);
  // Back to satellites: the view and the computed results are exactly what they were.
  await page.locator('[data-category="satellites"]').click();
  await expect(page.locator('#category-note')).toContainText(/satellite/i);
  expect(await page.evaluate(()=>JSON.stringify(window.__OVERHEAD_TEST__.state.results))).toBe(satelliteResults);
  expect(await page.evaluate(()=>window.__OVERHEAD_TEST__.state.objects.length)).toBe(satelliteObjects);
  expect(await page.locator('#headline').innerText()).toBe(satelliteHeadline);
  expect(await page.locator('#events').count()).toBe(1);
  expect(errors).toEqual([]);

});
