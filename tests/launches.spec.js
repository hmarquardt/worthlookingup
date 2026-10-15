/* Rocket launch calendar in the browser: the shared feed is loaded only when the category is opened,
   schedules are shown with their real precision, countdowns never claim a liftoff, no card ever claims
   local visibility, and the satellite/celestial experience is unchanged.
   The feed is served from disk (a file:// page cannot fetch it), with the clock fixed for determinism. */
const {test,expect}=require('@playwright/test');
const path=require('path'),fs=require('fs');
test.use({channel:process.env.CI?'chromium':'chrome'});
test.setTimeout(180000);
const NOW=Date.parse('2026-10-08T18:00:00Z');
const ISS={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-10-08T06:00:00.000000',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',NORAD_CAT_ID:25544,ELEMENT_SET_NO:999,REV_AT_EPOCH:58451,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
const hourly={time:Array.from({length:240},(_,i)=>Math.floor(Date.parse('2026-10-08T00:00:00Z')/1000)+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:15,cloud_cover_low:5,cloud_cover_mid:5,cloud_cover_high:5,visibility:24000,precipitation:0,relative_humidity_2m:60,weather_code:0,temperature_2m:15}))hourly[key]=Array(240).fill(value);

function launch({id,name,net,precision,status='Go for Launch',statusKind='scheduled',pad={name:'Space Launch Complex 40',latitude:28.56194122,longitude:-80.57735736},site='Cape Canaveral SFS, FL, USA',timezone='America/New_York',info=[],webcast=[]}){
  return {id,slug:id,name,mission:name.split('| ').pop(),mission_type:'Communications',mission_description:'A scheduled flight used by the launch calendar regression.',orbit:'Low Earth Orbit',
   vehicle:'Falcon 9 Block 5',vehicle_family:'Falcon',provider:'SpaceX',provider_abbrev:'SpX',
   site:{name:site,timezone,country:'United States of America'},pad,status:{id:1,name:status,abbrev:'Go',kind:statusKind},
   net,precision,window:{start:null,end:null},last_updated:'2026-10-08T12:00:00.000Z',links:{ll2:'https://ll.thespacedevs.com/2.3.0/launches/'+id+'/',info,webcast},change:null};
}
const DEFAULT_LAUNCHES=[
  launch({id:'tonight-exact',name:'Falcon 9 Block 5 | Tonight Test Flight',net:'2026-10-09T02:00:00.000Z',precision:{kind:'second',exact:true,dated:true,countdown:true,name:'Second'},
    info:[{kind:'info',source:'spacex.com',title:'SpaceX',type:'Official Page',official:true,priority:10,url:'https://www.spacex.com/launches/test-flight'}],
    webcast:[{kind:'webcast',source:'x.com',title:'Test Flight Mission',type:'Official Webcast',official:true,priority:10,url:'https://x.com/i/broadcasts/testflight'}]}),
  launch({id:'past-exact',name:'Falcon 9 Block 5 | Passed Time Case',net:'2026-10-08T23:30:00.000Z',precision:{kind:'minute',exact:true,dated:true,countdown:true,name:'Minute'}}),
  launch({id:'date-only',name:'Electron | Published Date Only',net:'2026-10-11T00:00:00.000Z',precision:{kind:'day',exact:false,dated:true,countdown:false,name:'Day'},status:'To Be Determined',statusKind:'unconfirmed',pad:{name:'Rocket Lab LC-1B',latitude:-39.262,longitude:177.864},site:'Mahia Peninsula, New Zealand',timezone:'Pacific/Auckland'}),
  launch({id:'month-only',name:'GSLV Mk II | Month Announced Only',net:'2026-10-31T00:00:00.000Z',precision:{kind:'month',exact:false,dated:false,countdown:false,name:'Month'},status:'To Be Determined',statusKind:'unconfirmed',pad:null,site:'Satish Dhawan Space Centre, India',timezone:'Asia/Kolkata'}),
  launch({id:'quarter-only',name:'Vulcan VC6L | Quarter Announced Only',net:'2026-12-31T00:00:00.000Z',precision:{kind:'quarter',exact:false,dated:false,countdown:false,name:'Quarter 4',quarter:4},status:'To Be Determined',statusKind:'unconfirmed'}),
  launch({id:'held',name:'Falcon 9 Block 5 | On Hold Case',net:'2026-10-09T18:00:00.000Z',precision:{kind:'hour',exact:true,dated:true,countdown:true,name:'Hour'},status:'On Hold',statusKind:'hold'}),
  launch({id:'completed',name:'Falcon 9 Block 5 | Already Launched',net:'2026-10-08T10:00:00.000Z',precision:{kind:'second',exact:true,dated:true,countdown:true,name:'Second'},status:'Launch Successful',statusKind:'success'}),
  launch({id:'no-precision',name:'Unknown Vehicle | Unrecognised Precision',net:'2026-10-13T00:00:00.000Z',precision:{kind:'unknown',exact:false,dated:false,countdown:false,name:'Fuzzy'},status:'Under Review',statusKind:'unknown'})
];
function feedFor({generatedAt=NOW,stale=false,staleReason=null,launches=DEFAULT_LAUNCHES}={}){
  return {schema:'worthlookingup.launches/1',available:true,generated_at:new Date(generatedAt).toISOString(),refresh_interval_minutes:30,stale_after_minutes:180,stale,stale_reason:staleReason,
   source:{name:'Launch Library 2',publisher:'The Space Devs',api_version:'2.3.0',endpoint:'https://ll.thespacedevs.com/2.3.0/launches/',documentation:'https://thespacedevs.com/llapi',attribution:'Launch data: The Space Devs Launch Library 2',rights:'Free unauthenticated access is limited to 15 requests per hour.',rate_limit:{unauthenticated_requests_per_hour:15},retrieved_at:new Date(generatedAt).toISOString(),sha256:'a'.repeat(64),pages:1,upstream_count:8,upstream_records:8,announced_total:473,duplicates_removed:0},
   stats:{count:launches.length,by_status:{scheduled:1},by_precision:{},with_published_time:2,with_published_date:3,period_only:2,sites:3,providers:1,nearest_net:null,window_days:180,announced_total:473},
   launches};
}

async function boot(page,{feed=feedFor({}),feedDelay=0,offlineFeed=false,endpoint=true}={}){
  const errors=[],requests=[];
  if(!page.__launchHarness){
    const harness={errors,requests,feed,feedDelay,offlineFeed,endpoint};
    page.__launchHarness=harness;
    page.on('pageerror',e=>harness.errors.push('pageerror: '+e.message));
    page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))harness.errors.push('console: '+m.text());});
    page.on('request',r=>harness.requests.push(r.url()));
    await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
    await page.route('**celestrak.org/**',r=>r.fulfill({json:[ISS]}));
    await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{timezone:'America/Chicago',hourly}}));
    await page.route('**/api/launches.json*',async route=>{
      const current=page.__launchHarness;
      if(current.feedDelay)await new Promise(resolve=>setTimeout(resolve,current.feedDelay));
      if(!current.endpoint){route.fulfill({status:404,body:'no endpoint here'});return;}
      if(current.offlineFeed){route.fulfill({status:503,body:'provider unavailable'});return;}
      route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(current.feed)});
    });
    await page.route('**/data/launches/*.json',route=>{
      const current=page.__launchHarness;
      if(current.offlineFeed){route.fulfill({status:404,body:'missing'});return;}
      route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(current.feed)});
    });
  }
  Object.assign(page.__launchHarness,{feed,feedDelay,offlineFeed,endpoint});
  errors.length=0;requests.length=0;
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto('file://'+path.resolve('index.html'));
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  return {errors,requests};
}
async function openLaunches(page){
  await page.getByRole('tab',{name:'ROCKET LAUNCHES'}).click();
  await page.waitForFunction(()=>['ready','error','unavailable'].includes(window.__OVERHEAD_TEST__.launches.status),null,{timeout:30000});
}

// 1. The launch feed is not requested until the reader opens the category: the satellite page keeps
//    its existing network profile, and the launch calendar then shows real published schedules.
test('launch feed is loaded on demand and rendered with its published precision',async({page})=>{
  const {errors,requests}=await boot(page);
  await expect(page.locator('.event').first()).toBeVisible();
  expect(requests.filter(url=>url.includes('launches.json')||url.includes('data/launches')).length).toBe(0);
  await openLaunches(page);
  expect(requests.some(url=>url.includes('launches.json')||url.includes('data/launches'))).toBe(true);
  await expect(page.locator('#celestial')).toBeVisible();
  await expect(page.locator('#celestial-eyebrow')).toHaveText('ROCKET LAUNCHES');
  await expect(page.locator('#celestial-score-label')).toHaveText('LAUNCHES IN WINDOW');
  const tonight=page.locator('[data-launch="tonight-exact"]');
  await expect(tonight).toHaveCount(1);
  await expect(tonight).toContainText('Falcon 9 Block 5 | Tonight Test Flight');
  await expect(tonight).toContainText('Cape Canaveral SFS, FL, USA');
  await expect(tonight).toContainText('Space Launch Complex 40');
  // 02:00Z on 16 October is 21:00 in Princeton (America/Chicago, UTC-5) and 22:00 at the pad.
  await expect(tonight).toContainText('Thu, Oct 8, 9:00 PM your time');
  await expect(tonight).toContainText('America/Chicago');
  await expect(tonight).toContainText('Thu, Oct 8, 10:00 PM at the pad');
  await expect(tonight).toContainText('provider published a time, accurate to the second');
  await expect(tonight.locator('[data-countdown]')).toHaveText('T\u221208:00:00');
  await expect(tonight).toContainText('Go for Launch');
  await expect(tonight.getByRole('link',{name:/Official: SpaceX for/})).toHaveAttribute('href','https://www.spacex.com/launches/test-flight');
  await expect(tonight.getByRole('link',{name:/Official: Test Flight Mission for/})).toHaveAttribute('rel','noopener');
  await expect(tonight.getByRole('link',{name:/Provider schedule record for/})).toHaveAttribute('href',/thespacedevs\.com/);
  await expect(page.locator('#celestial-freshness-body')).toContainText('Launch Library 2');
  await expect(page.locator('#celestial-freshness-body')).toContainText('15 requests per hour');
  expect(errors).toEqual([]);
});


// 2. Approximate schedules never become dates, and a period-only launch is never placed on a night.
test('approximate schedules are labelled as periods and excluded from date windows',async({page})=>{
  const {errors}=await boot(page);
  await openLaunches(page);
  await expect(page.locator('[data-launch="month-only"]')).toHaveCount(0);
  await expect(page.locator('[data-launch="date-only"]')).toHaveCount(0);
  await expect(page.locator('[data-launch="completed"]')).toHaveCount(0);
  const more=page.locator('#celestial-more');
  await expect(more).toBeVisible();
  await expect(more).toContainText('Announced with a period, not a date');
  await expect(more).toContainText('GSLV Mk II | Month Announced Only');
  await expect(more).toContainText('October 2026 (month announced, no day published)');
  await expect(more).toContainText('Vulcan VC6L | Quarter Announced Only');
  await expect(more).toContainText('Q4 2026 (quarter announced, no day published)');
  await expect(more).toContainText('Unknown Vehicle | Unrecognised Precision');
  await expect(more).toContainText('no date published yet');
  await expect(more).toContainText('473 launches are announced in total');
  // The seven-day window adds the published-only date, with no time invented for it.
  await page.getByRole('radio',{name:'NEXT 7 DAYS'}).click();
  const dateOnly=page.locator('[data-launch="date-only"]');
  await expect(dateOnly).toHaveCount(1);
  await expect(dateOnly).toContainText('11 October 2026 (UTC date; no time published)');
  await expect(dateOnly.locator('.launch-countdown')).toHaveText(/UTC date; no time published/);
  await expect(dateOnly).toHaveAttribute('data-date-only','true');
  await expect(dateOnly).toContainText('To Be Determined');
  await expect(page.locator('[data-launch="held"]')).toHaveCount(1);
  await expect(page.locator('[data-launch="held"]')).toContainText('On Hold');
  await expect(page.locator('[data-launch="held"]')).toContainText('on hold');
  // The ninety-day window adds the quarter-only launch as a period, never as a date.
  await page.getByRole('radio',{name:'NEXT 90 DAYS'}).click();
  await expect(page.locator('[data-launch="quarter-only"]')).toHaveCount(0);
  await expect(page.locator('#celestial-more')).toContainText('Q4 2026');
  expect(errors).toEqual([]);
});

// 3. A passed published time is never described as a liftoff, and no card claims local visibility.
test('the calendar never claims a liftoff or a local sighting',async({page})=>{
  const {errors}=await boot(page);
  await openLaunches(page);
  const passed=page.locator('[data-launch="past-exact"]');
  await expect(passed.locator('[data-countdown]')).toHaveText('T−05:30:00');
  // The published time passes while the night is under way: the card says so and never claims a liftoff.
  await page.clock.setFixedTime(new Date(NOW+6*3600000));
  await expect(passed.locator('.launch-countdown')).toHaveText(/Published time has passed/,{timeout:8000});
  await expect(passed).not.toContainText('liftoff');
  const body=await page.locator('#celestial-events').innerText();
  for(const claim of [/liftoff/i,/you will see/i,/should be visible/i,/visible from your/i,/probability of seeing/i,/bearing/i,/azimuth/i]){
    expect(claim.test(body),'the calendar must not contain '+claim).toBe(false);
  }
  await expect(page.locator('.launch-card .launch-status',{hasText:'Visibility unknown'}).first()).toBeVisible();
  const cards=page.locator('.launch-card');
  const count=await cards.count();
  expect(count).toBeGreaterThan(0);
  for(let index=0;index<count;index++){
    const card=cards.nth(index);
    await expect(card).toContainText('Visibility unknown');
    await expect(card).toContainText('Local visibility: unknown');
    await expect(card).toContainText('ascent trajectory');
  }
  await expect(page.locator('#celestial-status')).toContainText('not because it is visible from here');
  expect(errors).toEqual([]);
});

// 4. The countdown advances with the clock, and the honest stale warning appears when the feed ages.
test('countdowns advance and a stale feed warns explicitly',async({page})=>{
  const {errors}=await boot(page);
  await openLaunches(page);
  const countdown=page.locator('[data-launch="tonight-exact"] [data-countdown]');
  await expect(countdown).toHaveText('T\u221208:00:00');
  await page.clock.setFixedTime(new Date(NOW+3600000));
  await expect(countdown).toHaveText('T\u221207:00:00',{timeout:5000});
  await expect(page.locator('#celestial-freshness-body')).toContainText('The launch schedule was updated');
  await expect(page.locator('#celestial-freshness-body')).toContainText('from Launch Library 2');
  await page.clock.setFixedTime(new Date(NOW+400*60000));
  await page.evaluate(()=>__OVERHEAD_TEST__.renderLaunches());
  await expect(page.locator('#celestial-freshness-body')).toContainText('6 h 40 min old');
  await expect(page.locator('#celestial-freshness-body')).toContainText('may not reflect postponements or cancellations');
  expect(errors).toEqual([]);
});


// 5. A missing feed is described as missing, and an empty schedule is described as an empty schedule.
//    Neither is ever presented as "nothing is launching".
test('missing and empty launch feeds degrade honestly',async({page})=>{
  // A response that is not a launch feed at all is refused rather than half-read.
  const foreign=await boot(page,{feed:{schema:'worthlookingup.launches/9',available:true,generated_at:new Date(NOW).toISOString(),launches:DEFAULT_LAUNCHES}});
  await page.getByRole('tab',{name:'ROCKET LAUNCHES'}).click();
  await page.waitForFunction(()=>__OVERHEAD_TEST__.launches.status==='error',null,{timeout:30000});
  await expect(page.locator('#celestial-events')).toContainText('The launch schedule could not be read');
  await expect(page.locator('#celestial-freshness-body')).toContainText('unexpected launch feed schema');
  await expect(page.locator('.launch-card')).toHaveCount(0);
  expect(foreign.errors).toEqual([]);

  // Nothing reachable at all: the calendar says the feed is missing, not empty.
  const missingErrors=(await boot(page,{offlineFeed:true})).errors;
  await openLaunches(page);
  await expect(page.locator('#celestial-events')).toContainText('The launch schedule could not be read');
  await expect(page.locator('#celestial-events')).toContainText('This is a missing feed, not an empty schedule');
  await expect(page.locator('.launch-card')).toHaveCount(0);
  await expect(page.locator('#celestial-freshness-body')).toContainText('not available');
  await expect(page.locator('#celestial-freshness-body')).toContainText('an empty calendar is never shown as a schedule');
  expect(missingErrors).toEqual([]);

  // A real but empty schedule is a real answer, and it says so without inventing anything.
  const emptyErrors=(await boot(page,{feed:feedFor({launches:[]})})).errors;
  await openLaunches(page);
  await expect(page.locator('#celestial-events')).toContainText('No launch has a published time or date in tonight');
  await expect(page.locator('#celestial-events')).toContainText('a quiet window is normal');
  await expect(page.locator('#celestial-more')).toContainText('Launch schedules are published by the provider, not calculated here');
  await expect(page.locator('#celestial-top-score')).toHaveText('0');
  expect(emptyErrors).toEqual([]);
});

// 6. Accessible controls, mobile layout, both themes, and the existing observing experience unchanged.
test('launch calendar is accessible, responsive and does not disturb the rest of the page',async({page})=>{
  const {errors}=await boot(page);
  await expect(page.locator('.event').first()).toBeVisible();
  const satelliteEvents=await page.locator('.event').count();
  // Keyboard navigation across the category tabs still works with the launch category present.
  const tabs=page.locator('#categories [role="tab"]');
  await expect(tabs).toHaveCount(5);
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>document.activeElement.dataset.category)).toBe('launches');
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>['ready','error','unavailable'].includes(__OVERHEAD_TEST__.launches.status),null,{timeout:30000});
  await expect(page.locator('#celestial')).toBeVisible();
  // The refresh control is keyboard reachable and reports its result in the live region.
  const refresh=page.locator('#launches-refresh');
  await refresh.focus();
  expect(await refresh.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(refresh).toBeEnabled({timeout:15000});
  await expect(page.locator('#celestial-status')).toContainText('Launch Library 2');
  // Every width in both themes stays inside the viewport with readable cards.
  for(const width of [390,768,1024,1440]){
    await page.setViewportSize({width,height:1000});
    await page.waitForTimeout(120);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('.launch-card').first()).toBeVisible();
    for(const theme of ['dark','light']){
      await page.locator('#settings-open').click();
      await page.getByRole('button',{name:theme==='light'?'Use light theme':'Use dark theme'}).click();
      await page.keyboard.press('Escape');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.locator('.launch-card').first()).toBeVisible();
      await page.screenshot({path:'/tmp/worthlookingup-launches-'+theme+'-'+width+'.png',fullPage:false});
    }
  }
  // Back on the satellite view the original experience is intact and unranked by launches.
  await page.getByRole('tab',{name:'SATELLITES'}).click();
  await expect(page.locator('#celestial')).toBeHidden();
  await expect(page.locator('.event')).toHaveCount(satelliteEvents);
  await expect(page.locator('.event').first()).toBeVisible();
  expect(await page.evaluate(()=>Object.keys(__OVERHEAD_TEST__.state.results).length>0)).toBe(true);
  expect(await page.evaluate(()=>JSON.stringify(__OVERHEAD_TEST__.launches.feed).includes('visibility'))).toBe(false);
  expect(errors).toEqual([]);
});

