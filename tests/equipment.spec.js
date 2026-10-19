/* Phase 7A browser tests: difficulty on real cards, lazy guide, local equipment profile, session
   prefill, responsive layout and keyboard operation. */
const {test,expect}=require('@playwright/test');
const path=require('path'),fs=require('fs'),http=require('http');
test.use({channel:process.env.CI?'chromium':'chrome'});
test.setTimeout(90000);
const NOW=new Date('2026-10-19T18:00Z');
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
test.afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise(resolve=>server.close(resolve))));});
function fixture(){
  const hourly={time:[],cloud_cover:[],precipitation_probability:[],temperature_2m:[],wind_speed_10m:[],wind_gusts_10m:[],
    units:{temperature_2m:'°C',wind_speed_10m:'km/h',precipitation_probability:'%'}};
  const start=Date.parse('2026-10-18T00:00:00Z');
  for(let i=0;i<120;i++){hourly.time.push(Math.floor((start+i*3600000)/1000));hourly.cloud_cover.push(20);
    hourly.precipitation_probability.push(2);hourly.temperature_2m.push(10);hourly.wind_speed_10m.push(7);hourly.wind_gusts_10m.push(14);}
  return {timezone:'America/Chicago',hourly};
}
async function boot(page,clock=NOW){
  const errors=[];const requests=[];
  page.on('pageerror',error=>errors.push('pageerror: '+error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push('console: '+message.text());});
  page.on('request',request=>requests.push(request.url()));
  await page.clock.setFixedTime(clock);
  await page.route('**/api/analytics/**',route=>route.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',route=>route.fulfill({json:[ISS]}));
  await page.route('**data/launches/**',route=>route.fulfill({status:404,body:'none'}));
  await page.route('**api/launches.json*',route=>route.fulfill({status:404,body:'none'}));
  await page.route('**api.open-meteo.com/**',route=>route.fulfill({json:fixture()}));
  const server=serve();servers.push(server);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!window.__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  return {errors,requests};
}
async function openPlanets(page){
  await page.locator('[data-category="planets"]').click();
  await page.waitForFunction(()=>{const c=window.__OVERHEAD_TEST__.celestial;return c.status==='ready'&&!c.busy;},null,{timeout:60000});
  await expect(page.locator('.celestial-card').first()).toBeVisible();
}
async function openSettingsAndGuide(page){
  await page.locator('#settings-open').click();
  await page.locator('#equipment-open').click();
  await expect(page.locator('#equipment-dialog')).toBeVisible();
  await page.waitForFunction(()=>document.querySelector('#equipment-dialog').innerText.includes('Choosing equipment for the night sky'));
}

test('difficulty appears on a card, and the guide is lazy until asked for',async({page})=>{
  const {errors,requests}=await boot(page);
  await openPlanets(page);
  const card=page.locator('.celestial-card').first();
  await expect(card.locator('.difficulty')).toBeVisible();
  await expect(card.locator('.difficulty-chip').first()).toContainText(/Visual:/);
  await expect(card.locator('.difficulty')).toContainText('Suggested approach');
  await expect(card.locator('.difficulty')).toContainText('How this was assessed');
  await expect(card.locator('.difficulty')).toContainText('or a promise of detection');
  expect(requests.some(url=>url.includes('overhead-equipment.js')),'the guide must not load on its own').toBe(false);
  await openSettingsAndGuide(page);
  expect(requests.some(url=>url.includes('overhead-equipment.js')),'the guide is fetched when opened').toBe(true);
  await expect(page.locator('#equipment-dialog')).toContainText('Naked eye');
  await expect(page.locator('#equipment-dialog')).toContainText('Binoculars');
  await expect(page.locator('#equipment-dialog')).toContainText('Visual telescopes');
  await expect(page.locator('#equipment-dialog')).toContainText('Smart telescopes');
  await expect(page.locator('#equipment-dialog')).toContainText('DSLR or mirrorless camera');
  await expect(page.locator('#equipment-dialog')).toContainText('Advanced imaging');
  await expect(page.locator('#equipment-dialog')).toContainText('How the two difficulty labels differ');
  expect(errors).toEqual([]);
});

test('a comet card keeps the score separate from visual and imaging difficulty',async({page})=>{
  const {errors}=await boot(page);
  await page.locator('[data-category="comets"]').click();
  await page.waitForFunction(()=>{const c=window.__OVERHEAD_TEST__.celestial;return c.status==='ready'&&!c.busy;},null,{timeout:60000});
  const cards=page.locator('.celestial-card');
  await expect(cards.first()).toBeVisible();
  const card=cards.filter({has:page.locator('.difficulty')}).first();
  await expect(card.locator('.celestial-chip')).toContainText('/100');
  await expect(card.locator('.difficulty-chip')).toHaveCount(2);
  await expect(card.locator('.difficulty')).toContainText('Visual:');
  await expect(card.locator('.difficulty')).toContainText('Imaging:');
  await expect(card.locator('.difficulty')).toContainText('not a stellar limiting magnitude');
  expect(errors).toEqual([]);
});

test('a profile is saved locally, changes qualified guidance and resets cleanly',async({page})=>{
  const {errors}=await boot(page);
  await openPlanets(page);
  await openSettingsAndGuide(page);
  await page.locator('input[name="types.binoculars"]').check();
  await page.locator('input[name="binoculars.magnification"]').fill('10');
  await page.locator('input[name="binoculars.objectiveMm"]').fill('50');
  await page.locator('input[name="types.telescope"]').check();
  await page.locator('input[name="telescope.apertureMm"]').fill('150');
  await page.locator('#equipment-form button[type="submit"]').click();
  await expect(page.locator('.equipment-status')).toContainText('Equipment saved');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('overhead.equipment.v1')));
  expect(stored.types.binoculars).toBe(true);
  expect(stored.telescope.apertureMm).toBe(150);
  expect(await page.locator('#equipment-summary').innerText()).toContain('150 mm telescope');
  await page.locator('#equipment-dialog [data-close]').click();
  await expect(page.locator('.celestial-card .difficulty-fit').first()).toContainText(/telescope|binocular/i);
  await page.locator('#equipment-open').click();
  await page.waitForFunction(()=>document.querySelector('#equipment-dialog').innerText.includes('Choosing equipment for the night sky'));
  await page.locator('#equipment-dialog [data-equipment-reset]').click();
  await expect(page.locator('#equipment-dialog .equipment-status')).toContainText('profile reset');
  expect(await page.evaluate(()=>localStorage.getItem('overhead.equipment.v1'))).toBe(null);
  expect(await page.locator('#equipment-summary').innerText()).toBe('No equipment profile');
  expect(errors).toEqual([]);
});

test('corrupt profile storage is ignored rather than breaking the page',async({page})=>{
  const {errors}=await boot(page);
  await page.evaluate(()=>localStorage.setItem('overhead.equipment.v1','{"types": broken'));
  await page.reload();
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!window.__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  await openPlanets(page);
  await openSettingsAndGuide(page);
  await expect(page.locator('#equipment-summary')).toContainText('No equipment profile');
  await expect(page.locator('#equipment-dialog')).toContainText('My equipment');
  expect(errors).toEqual([]);
});

test('a camera profile prefills the Milky Way session without overwriting saved choices',async({page})=>{
  const {errors}=await boot(page);
  await openSettingsAndGuide(page);
  await page.locator('input[name="types.camera"]').check();
  await page.locator('select[name="camera.sensor"]').selectOption('aps-c');
  await page.locator('input[name="camera.focalLengthMm"]').fill('24');
  await page.locator('input[name="camera.aperture"]').fill('2.8');
  await page.locator('#equipment-form button[type="submit"]').click();
  await page.locator('#equipment-dialog [data-close]').click();
  await page.locator('#settings-dialog [data-close]').click();
  await page.locator('[data-category="milkyway"]').click();
  await page.waitForFunction(()=>{const c=window.__OVERHEAD_TEST__.celestial;return c.status==='ready'&&!c.busy;},null,{timeout:60000});
  await page.locator('#session-open').click();
  await page.waitForFunction(()=>{const s=window.__OVERHEAD_TEST__.session;return s.open&&s.status==='ready'&&!!document.querySelector('[data-session-root]');},null,{timeout:60000});
  await expect(page.locator('#milkyway-session input[data-session-input="focalLength"]')).toHaveValue('24');
  await expect(page.locator('#milkyway-session select[data-session-input="sensor"]')).toHaveValue('aps-c');
  await expect(page.locator('#milkyway-session')).toContainText('prefilled from your equipment profile');
  expect(errors).toEqual([]);
});

test('a saved session keeps its own camera when the general profile changes',async({page})=>{
  const {errors}=await boot(page,new Date('2027-04-10T18:30Z'));
  await openSettingsAndGuide(page);
  await page.locator('input[name="types.camera"]').check();
  await page.locator('select[name="camera.sensor"]').selectOption('aps-c');
  await page.locator('input[name="camera.focalLengthMm"]').fill('24');
  await page.locator('#equipment-form button[type="submit"]').click();
  await page.locator('#equipment-dialog [data-close]').click();
  await page.locator('#settings-dialog [data-close]').click();
  await page.locator('[data-category="milkyway"]').click();
  await page.waitForFunction(()=>{const c=window.__OVERHEAD_TEST__.celestial;return c.status==='ready'&&!c.busy;},null,{timeout:60000});
  await page.locator('#session-open').click();
  await page.waitForFunction(()=>{const s=window.__OVERHEAD_TEST__.session;return s.open&&s.status==='ready'&&!!document.querySelector('[data-session-root]');},null,{timeout:60000});
  await page.locator('#milkyway-session [data-session="where"][data-value="camp-cadiz-campground"]').click();
  await page.locator('#milkyway-session [data-session="when"][data-value="custom"]').click();
  await page.locator('#milkyway-session input[data-session-input="date"]').fill('2027-04-13');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__.session.date==='2027-04-13');
  await expect(page.locator('#milkyway-session input[data-session-input="focalLength"]')).toHaveValue('24');
  await page.locator('#milkyway-session input[data-session-input="focalLength"]').fill('50');
  await page.locator('#milkyway-session [data-session="save"]').click();
  await expect(page.locator('#milkyway-session')).toContainText('Saved in this browser only');
  await page.locator('#settings-open').click();await page.locator('#equipment-open').click();
  await page.waitForFunction(()=>document.querySelector('#equipment-dialog').innerText.includes('Choosing equipment for the night sky'));
  await page.locator('#equipment-form input[name="camera.focalLengthMm"]').fill('14');
  await page.locator('#equipment-form button[type="submit"]').click();
  await page.locator('#equipment-dialog [data-close]').click();await page.locator('#settings-dialog [data-close]').click();
  await page.locator('#milkyway-session [data-session="close"]').click();
  await page.locator('#session-open').click();
  await page.waitForFunction(()=>!!document.querySelector('[data-session-root]'),null,{timeout:30000});
  await page.locator('#milkyway-session [data-session="open"]').first().click();
  await page.waitForFunction(()=>!!window.__OVERHEAD_TEST__.session.current,null,{timeout:30000});
  await expect(page.locator('#milkyway-session input[data-session-input="focalLength"]')).toHaveValue('50');
  await expect(page.locator('#milkyway-session')).toContainText('saved plan uses its own camera settings');
  expect(errors).toEqual([]);
});

test('the guide and cards stay usable at four widths in both themes',async({page})=>{
  const {errors}=await boot(page);
  await openPlanets(page);
  for(const width of [390,768,1280,1440]){
    await page.setViewportSize({width,height:900});
    for(const theme of ['dark','light']){
      await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow<=0,'overflow at '+width+' '+theme+' is '+overflow).toBe(true);
    }
  }
  await page.setViewportSize({width:390,height:844});
  await openSettingsAndGuide(page);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const check=page.locator('#equipment-form .equipment-check').first();
  const box=await check.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await check.evaluate(node=>node.tagName)).toBe('LABEL');
  expect(await page.locator('#equipment-form input[type="checkbox"]').first().evaluate(node=>node.type)).toBe('checkbox');
  await page.locator('#equipment-form button[type="submit"]').focus();
  const outline=await page.locator('#equipment-form button[type="submit"]').evaluate(node=>getComputedStyle(node).outlineWidth+' '+getComputedStyle(node).outlineStyle);
  expect(outline).not.toBe('0px none');
  expect(errors).toEqual([]);
});

