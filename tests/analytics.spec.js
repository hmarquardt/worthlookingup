/* CFLab Analytics integration: what this application actually sends to the shared collector.
   The collector itself is stubbed; the assertions are about the payload, the event names and the
   privacy promise (no coordinates, no search text, Do Not Track suppresses everything).
   Run: npx playwright test tests/analytics.spec.js */
const {test,expect}=require('@playwright/test');
const path=require('path');
test.use({channel:process.env.CI?'chromium':'chrome'});
test.setTimeout(90000);
const iss={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-09-07T11:57:47.376864',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',NORAD_CAT_ID:25544,ELEMENT_SET_NO:999,REV_AT_EPOCH:58451,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
const start=Date.parse('2026-09-06T00:00Z')/1000;
const hourly={time:Array.from({length:264},(_,i)=>start+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:12,cloud_cover_low:5,cloud_cover_mid:0,cloud_cover_high:7,visibility:30000,precipitation:0,relative_humidity_2m:60,weather_code:0,temperature_2m:20}))hourly[key]=Array(264).fill(value);

async function boot(page,{doNotTrack=false}={}){
  const posts=[];
  if(doNotTrack)await page.addInitScript(()=>Object.defineProperty(navigator,'doNotTrack',{get:()=>'1'}));
  await page.route('**/api/analytics/**',async route=>{
    const body=route.request().postData()||'';
    try{posts.push(JSON.parse(body));}catch{posts.push({unparsed:body});}
    await route.fulfill({status:204,body:''});
  });
  await page.route('**celestrak.org/**',route=>route.fulfill({json:[iss]}));
  await page.route('**api.open-meteo.com/**',route=>route.fulfill({json:{timezone:'America/Chicago',hourly}}));
  await page.route('**geocoding-api.open-meteo.com/**',route=>route.fulfill({json:{results:[{name:'Lompoc',admin1:'California',country:'United States',latitude:34.6391,longitude:-120.4579,timezone:'America/Los_Angeles'}]}}));
  await page.route('**query.wikidata.org/**',route=>route.fulfill({json:{results:{bindings:[]}}}));
  await page.clock.setFixedTime(new Date('2026-09-07T18:00Z'));
  await page.goto(`file://${path.resolve('index.html')}`);
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
  await page.waitForFunction(()=>!!window.cflabAnalytics);
  return posts;
}
const named=(posts,name)=>posts.filter(p=>p.event_name===name);

test('pageviews and the three interaction events reach the shared CFLab Analytics collector',async({page})=>{
  const posts=await boot(page);
  // 1. Page view, on load, with the registered site identity and the document host the collector
  //    checks against its domain allowlist.
  await expect.poll(()=>posts.filter(p=>p.event_type==='pageview').length).toBeGreaterThan(0);
  expect(posts[0].site_id).toBe('worthlookingup');
  expect(typeof posts[0].page.host).toBe('string');
  expect(posts[0].page.path.length).toBeGreaterThan(0);
  expect(posts[0].session_id).toMatch(/^s/);
  // 2. Event detail view, opened through the same handler the event cards use, while the first
  //    calculation is still the one on screen.
  const opened=await page.evaluate(()=>{const T=window.__OVERHEAD_TEST__,p=T.passes()[0]||Object.values(T.state.results).flat().find(Boolean);if(!p)return null;T.showEvent(p.id,p);return p.name;});
  expect(opened).not.toBeNull();
  await expect.poll(()=>named(posts,'event_detail_view').length).toBe(1);
  expect(named(posts,'event_detail_view')[0].props.category.length).toBeGreaterThan(0);
  // The detail dialog is modal, so close it before driving the rest of the page.
  await page.keyboard.press('Escape');
  // 3. Location search by place, and by coordinates: one event name, a method property.
  await page.click('#location-open');
  await page.fill('#search','Lompoc');
  await page.click('#search-form button[type="submit"]');
  await expect.poll(()=>named(posts,'location_search').length).toBe(1);
  await page.fill('#latitude','34.6391');await page.fill('#longitude','-120.4579');await page.fill('#timezone','America/Los_Angeles');
  await page.click('#coordinate-form button[type="submit"]');
  await expect.poll(()=>named(posts,'location_search').length).toBe(2);
  expect(named(posts,'location_search').map(p=>p.props.method)).toEqual(['place','coordinates']);
  // 4. Category selection (the view tabs), last because the About view is the end state.
  await page.click('[data-view="about"]');
  await expect.poll(()=>named(posts,'category_select').length).toBe(1);
  expect(named(posts,'category_select')[0]).toMatchObject({event_type:'custom',props:{view:'about'}});
  // 5. Privacy: minutes of observation, coordinates and search text never leave the browser.
  const sent=JSON.stringify(posts);
  expect(sent).not.toContain('Lompoc');
  expect(sent).not.toMatch(/38\.3553|-87\.5675|34\.6391|-120\.4579|America\/Los_Angeles|Princeton/);
  // The event names must satisfy the collector's own name pattern, or they are silently renamed 'event'.
  for(const post of posts.filter(p=>p.event_type==='custom'))expect(post.event_name).toMatch(/^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/);
});

test('Do Not Track suppresses every request, including the page view',async({page})=>{
  const posts=await boot(page,{doNotTrack:true});
  await page.click('[data-view="about"]');
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(0);
});
