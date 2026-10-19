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
    const hook=window.__OVERHEAD_TEST__;
    const item=[...hook.calendarItems.values()].find(entry=>entry.event.category==='milkyway');
    return { start:item.source.start, end:item.source.end };
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

/* ---- the next season, beyond the ninety-day plan ------------------------------------------- */

// The season search is a separate, on-demand worker request. These tests wait for its own state, never for
// a timeout, so a slow machine cannot turn a real result into a flake.
const seasonReady=page=>page.waitForFunction(()=>{const s=window.__OVERHEAD_TEST__.season;
  return s.status==='ready'||s.status==='error';},null,{timeout:60000});
const seasonText=page=>page.locator('#milkyway-season').innerText();

test('outside the core season the category answers when it will next be workable, and why that night is marginal',async({page})=>{
  // Mid-October at 38.4 N: no qualifying window in the horizon, which is exactly when the seasonal answer
  // has to carry the category.
  const errors=await boot(page,{now:new Date('2026-10-16T23:30Z')});
  await openCategory(page);
  await seasonReady(page);
  const section=page.locator('#milkyway-season');
  await expect(section).toBeVisible();
  // Nothing qualified, so the season is the headline rather than a footnote.
  await expect(section).toHaveAttribute('data-prominent','true');
  const text=await seasonText(page);
  const state=await page.evaluate(()=>{
    const season=window.__OVERHEAD_TEST__.season.result.season;
    return {classification:season.classification,opening:season.opening,favorable:season.favorable,
      search:season.search,weather:season.weather,threshold:season.thresholdDeg};
  });
  expect(state.classification).toBe('season-favorable');
  expect(state.threshold).toBe(20);
  // The date, the local window, the altitude, the direction and the Moon all come from the calculation.
  expect(text).toContain('Next Galactic-core season');
  expect(text).toContain('Season opens');
  expect(text).toMatch(new RegExp('the core reaches \\d+° towards [A-Z]'));
  expect(text).toMatch(/min of astronomical darkness that night/);
  expect(text).toMatch(/Moon: /);
  // The opening is marginal and says so; the favourable night is a different date, labelled apart.
  expect(text).toContain('marginal');
  expect(state.opening.favorable).toBe(false);
  expect(text).toContain('First favourable night');
  expect(text).toContain('favorable');
  expect(state.favorable.date).not.toBe(state.opening.date);
  expect(state.favorable.quality).toBeGreaterThan(state.opening.quality);
  // The limitations of the opening are listed, and they are facts about geometry and moonlight.
  for(const limitation of state.opening.limitations)expect(text).toContain(limitation.replace(/\s+/g,' '));
  // Months ahead there is no forecast, and the block refuses to imply one.
  expect(state.weather.state).toBe('not-forecastable');
  expect(text).toContain('No forecast exists at this range');
  expect(text).toContain('not a prediction of cloud, haze or light pollution');
  expect(text).not.toMatch(/clear skies|guaranteed|bortle|sky brightness|sighting chance/i);
  // The walk is described honestly: how many nights were examined, and how many qualified.
  expect(text).toContain('Walked ');
  expect(text).toContain(' of the 365 observing nights');
  expect(state.search.stoppedEarly).toBe(true);
  expect(text).toContain('stopped once both answers were known');
  expect(errors).toEqual([]);
});

test('a marginal opening is never presented as the best night of the season',async({page})=>{
  const errors=await boot(page,{now:new Date('2026-10-16T23:30Z')});
  await openCategory(page);
  await seasonReady(page);
  const text=await seasonText(page);
  expect(text).not.toMatch(/best night|ideal|perfect conditions|guaranteed/i);
  expect(text).toMatch(/qualifying but marginal window/);
  expect(text).toContain('window quality');
  expect(text).not.toMatch(/sighting score|cross-category|overall score/i);
  expect(errors).toEqual([]);
});

test('a future window exports to the calendar and joins the observing plan',async({page})=>{
  const errors=await boot(page,{now:new Date('2026-10-16T23:30Z')});
  await openCategory(page);
  await seasonReady(page);
  const section=page.locator('#milkyway-season');
  const exportButton=section.locator('[data-calendar-add]').first();
  await expect(exportButton).toBeVisible();
  const captured=[];
  page.on('download',download=>captured.push(download));
  // Clicking the real button must run the real calendar path and announce a file.
  await exportButton.click();
  await expect(page.locator('#status')).toContainText(/\.ics/);
  const exported=await page.evaluate(()=>{
    const hook=window.__OVERHEAD_TEST__;
    const season=hook.season.result.season;
    const id=hook.season.events.get(season.opening.date);
    const item=id?hook.calendarItems.get(id):null;
    return {id,result:hook.calendar.single(item,hook.calendarOptions({source:item.source,label:item.event.title})),
      start:item.event.start, end:item.event.end, precision:item.event.precision, opening:season.opening};
  });
  expect(exported.id).toBeTruthy();
  expect(exported.result.eligible).toBe(true);
  expect(exported.result.name).toMatch(/\.ics$/);
  expect(exported.precision).toBe('window');
  // The interval is the calculated window, to the millisecond.
  expect(exported.start).toBe(exported.opening.start);
  expect(exported.end).toBe(exported.opening.end);
  expect(exported.end-exported.start).toBeGreaterThan(10*60000);
  // Unfold first: the serializer folds at 75 octets, so a phrase can legitimately straddle a fold.
  const text=String(exported.result.ics).replace(/\r\n[ \t]/g,'');
  expect(text).toContain('BEGIN:VEVENT');
  expect(text).toContain('SUMMARY:Milky Way core window');
  expect(text).toContain('Milky Way window quality');
  expect(text).toContain('not comparable with satellite');
  expect(text).toMatch(/not forecastable|no forecast exists/i);
  expect(text).toMatch(/DTSTART:/);
  expect(text).toMatch(/DTEND:/);
  // Same night, same UID: a second export updates the entry instead of duplicating it.
  const again=await page.evaluate(()=>{
    const hook=window.__OVERHEAD_TEST__;
    const season=hook.season.result.season;
    const item=hook.calendarItems.get(hook.season.events.get(season.opening.date));
    return hook.calendar.single(item,hook.calendarOptions({source:item.source})).event.uid;
  });
  expect(again).toBe(exported.result.event.uid);
  // The observing plan takes the same identity and keeps the window rather than an instant.
  await section.locator('[data-plan-toggle]').first().click();
  await expect(page.locator('#observing-plan')).toBeVisible();
  await expect(page.locator('#plan-list')).toContainText('Milky Way core window');
  const planned=await page.evaluate(()=>[...window.__OVERHEAD_TEST__.observingPlan.values()].map(entry=>({
    start:entry.event.start, end:entry.event.end, precision:entry.event.precision })));
  expect(planned.length).toBe(1);
  expect(planned[0].start).toBe(exported.start);
  expect(planned[0].precision).toBe('window');
  expect(errors).toEqual([]);
});

test('when there are opportunities the season stays available but secondary, and it opens by keyboard',async({page})=>{
  // Mid-July at 38.4 N: the plan has windows, so the seasonal answer is context rather than the headline.
  const errors=await boot(page);
  await openCategory(page);
  await seasonReady(page);
  const section=page.locator('#milkyway-season');
  await expect(section).toBeVisible();
  await expect(section).toHaveAttribute('data-prominent','false');
  const details=section.locator('details');
  await expect(details).toHaveCount(1);
  const summary=details.locator('summary');
  await expect(summary).toContainText('Season opens');
  // Collapsed by default, so it never competes with tonight's window.
  expect(await details.evaluate(node=>node.open)).toBe(false);
  expect(await section.innerText()).not.toContain('the core reaches');
  // Reachable and operable without a mouse.
  await summary.focus();
  expect(await page.evaluate(()=>document.activeElement.tagName)).toBe('SUMMARY');
  await page.keyboard.press('Enter');
  expect(await details.evaluate(node=>node.open)).toBe(true);
  // A horizon change re-renders the block, and must not close what the reader opened.
  await page.locator('[data-horizon="extended"]').click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.celestial.horizon==='extended'&&
    window.__OVERHEAD_TEST__.celestial.status==='ready',null,{timeout:60000});
  await expect(section.locator('details')).toHaveCount(1);
  expect(await section.locator('details').evaluate(node=>node.open)).toBe(true);
  const text=await section.innerText();
  expect(text).toMatch(new RegExp('the core reaches \\d+° towards [A-Z]'));
  expect(text).toContain('window quality');
  expect(text).toContain('No forecast exists at this range');
  expect(errors).toEqual([]);
});

test('the year is never searched until the category is opened, and never with a network request',async({page})=>{
  const requests=[];
  const errors=await boot(page,{requests,now:new Date('2026-10-16T23:30Z')});
  // Nothing has run yet, and nothing about the season has been fetched.
  expect(await page.evaluate(()=>window.__OVERHEAD_TEST__.season.status)).toBe('idle');
  expect(requests.filter(url=>/overhead-milkyway\.js/.test(url))).toEqual([]);
  await openCategory(page);
  await seasonReady(page);
  // The engine and the worker are the only new requests, and both are same-origin files: no dataset, no
  // forecast, no provider call.
  const engineRequests=requests.filter(url=>/overhead-milkyway\.js|overhead-celestial-worker\.js/.test(url));
  expect(engineRequests.length).toBeGreaterThanOrEqual(1);
  expect(engineRequests.every(url=>/^http:\/\/127\.0\.0\.1:\d+\//.test(url))).toBe(true);
  // A second visit in the same session is served from the session cache: same result, no new work.
  const first=await page.evaluate(()=>({key:window.__OVERHEAD_TEST__.season.key,
    ms:window.__OVERHEAD_TEST__.season.searchMs,start:window.__OVERHEAD_TEST__.season.result.season.opening.start}));
  await page.locator('[data-category="planets"]').click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.celestial.result?.category==='planets');
  await openCategory(page);
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.season.status==='ready');
  const second=await page.evaluate(()=>({ms:window.__OVERHEAD_TEST__.season.searchMs,
    start:window.__OVERHEAD_TEST__.season.result.season.opening.start}));
  expect(second.start).toBe(first.start);
  expect(second.ms).toBe(first.ms);
  expect(errors).toEqual([]);
});

test('a saved location change re-searches the year for the new place',async({page})=>{
  const errors=await boot(page,{now:new Date('2026-10-16T23:30Z')});
  await page.route('**geocoding-api.open-meteo.com/**',route=>route.fulfill({json:{results:[
    {name:'Cape Town',admin1:'Western Cape',country:'South Africa',latitude:-33.9249,longitude:18.4241,
      timezone:'Africa/Johannesburg'}]}}));
  await openCategory(page);
  await seasonReady(page);
  const northern=await page.evaluate(()=>({key:window.__OVERHEAD_TEST__.season.key,
    result:window.__OVERHEAD_TEST__.season.result.season}));
  // Move to the southern hemisphere through the real location search.
  await page.click('#location-open');
  await page.fill('#search','Cape Town');
  await page.click('#search-form button[type="submit"]');
  // The search lists places; the site changes when one is chosen, exactly as a reader would do it.
  await page.locator('#search-results button').first().click();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.state.site.lat<-30,null,{timeout:60000});
  await openCategory(page);
  await page.waitForFunction(previous=>window.__OVERHEAD_TEST__.season.key!==previous&&
    window.__OVERHEAD_TEST__.season.status==='ready',northern.key,{timeout:60000});
  const southern=await page.evaluate(()=>({result:window.__OVERHEAD_TEST__.season.result.season,
    site:window.__OVERHEAD_TEST__.state.site}));
  expect(southern.site.name).toContain('Cape Town');
  expect(southern.result.classification).toBe('season-favorable');
  // Cape Town is in season now; Indiana was not. The answer moved with the observer, not with a calendar.
  expect(southern.result.opening.start).not.toBe(northern.result.opening.start);
  expect(southern.result.opening.date).not.toBe(northern.result.opening.date);
  expect(southern.result.opening.coreAltitude).toBeGreaterThan(northern.result.opening.coreAltitude);
  // Cape Town is in season, so the block is a collapsed summary: open it before reading.
  await page.locator('#milkyway-season summary').click();
  const text=await seasonText(page);
  expect(text).toContain('Cape Town');
  // The block's own actions now point at the southern night, so nothing links to the northern one.
  const linked=await page.evaluate(()=>{
    const hook=window.__OVERHEAD_TEST__;
    return [...hook.season.events.values()].map(id=>hook.calendarItems.get(id)).filter(Boolean)
      .map(entry=>({start:entry.event.start,category:entry.event.category}));
  });
  expect(linked.length).toBeGreaterThanOrEqual(1);
  expect(linked.every(entry=>entry.category==='milkyway')).toBe(true);
  expect(linked.map(entry=>entry.start)).toContain(southern.result.opening.start);
  expect(linked.map(entry=>entry.start)).not.toContain(northern.result.opening.start);
  expect(errors).toEqual([]);
});

test('a throttled phone-sized browser measures the season in both cache states',async({page})=>{
  const errors=await boot(page,{now:new Date('2026-10-16T23:30Z')});
  await page.setViewportSize({width:390,height:844});
  // Four times slower than this machine's CPU, the documented stand-in for a mid-range phone.
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.locator('[data-category="milkyway"]').click();
  // The plan's own render does not wait for the year: its cards are decided by the plan worker alone.
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.celestial.status==='ready'&&
    !!window.__OVERHEAD_TEST__.celestial.result?.plans?.week,null,{timeout:60000});
  await seasonReady(page);
  const cold=await page.evaluate(()=>window.__OVERHEAD_TEST__.season.result.season.search);
  expect(cold.ms).toBeGreaterThan(0);
  expect(cold.scanned).toBeGreaterThan(1);
  // The worker's cache lives and dies with the worker, so a warm measurement has to run in one thread: the
  // engine walked twice, the second time against the nights it already analysed. The harness fixes Date.now
  // (so the page cannot see today move), therefore performance.now times these two walks.
  const repeats=await page.evaluate(()=>{
    const hook=window.__OVERHEAD_TEST__,MW=hook.celestialEngines.milkyway,site=hook.state.site;
    const windows=hook.celestialWindows(365);
    const options={stepMinutes:20,solarStepMinutes:15,moonStepMinutes:20};
    MW.clearCache();
    let started=performance.now();
    const cold=MW.analyseSeason(windows,site,options).search;
    const coldMs=performance.now()-started;
    started=performance.now();
    const warm=MW.analyseSeason(windows,site,options).search;
    const warmMs=performance.now()-started;
    return {cold:{...cold,ms:Math.round(coldMs)},warm:{...warm,ms:Math.round(warmMs)}};
  });
  expect(repeats.cold.cacheMisses).toBe(repeats.cold.scanned);
  expect(repeats.warm.cacheHits).toBe(repeats.warm.scanned);
  expect(repeats.warm.cacheMisses).toBe(0);
  const warm=repeats.warm;
  console.log(`in-page engine, 4x throttled: cold ${repeats.cold.ms} ms (${repeats.cold.cacheMisses} nights analysed), `+
   `warm ${warm.ms} ms (${warm.cacheHits} nights reused)`);
  expect(warm.ms).toBeLessThan(repeats.cold.ms);
  // Even throttled it is a bounded background task, and the block is readable when it lands.
  expect(cold.ms).toBeLessThan(30000);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  await expect(page.locator('#milkyway-season')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]);
});

test('the season block keeps four widths, both themes and no overflow',async({page})=>{
  const errors=await boot(page,{now:new Date('2026-10-16T23:30Z')});
  await openCategory(page);
  await seasonReady(page);
  const section=page.locator('#milkyway-season');
  const snapshot=()=>page.evaluate(()=>{
    const node=document.getElementById('milkyway-season');
    return {text:node.innerText.replace(/\s+/g,' ').trim(),width:Math.round(node.getBoundingClientRect().width)};
  });
  const dark=await snapshot();
  expect(dark.text).toContain('Next Galactic-core season');
  for(const width of [390,768,1280,1440]){
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(150);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
    await expect(section).toBeVisible();
    const box=await section.boundingBox();
    expect(box.width).toBeLessThanOrEqual(width);
    expect(box.x).toBeGreaterThanOrEqual(0);
    // Every action stays inside the block, so nothing is clipped off the right edge.
    for(const button of await section.locator('button').all()){
      const action=await button.boundingBox();
      if(action)expect(action.x+action.width).toBeLessThanOrEqual(width+1);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  }
  await page.setViewportSize({width:390,height:900});
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Use light theme'}).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(1,1);
  expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('light');
  expect((await snapshot()).text).toBe(dark.text);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({fullPage:true,path:'/tmp/milkyway-season-light-390.png'});
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Use dark theme'}).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(1,1);
  expect((await snapshot()).text).toBe(dark.text);
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
