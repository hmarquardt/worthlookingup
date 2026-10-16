/* Historical ascent geometry in the browser (Phase 5B).

   The panel is a view of past flights only: it must load nothing until it is opened, it must show the
   published profile's own numbers and nothing else, a downgraded profile must keep its direction and
   lose its elevation, a tampered artifact must be refused outright, and a launch card may add the
   direction of its *pad* while still declaring local visibility unknown.

   These tests need real module loading, so the page is served over HTTP rather than file://. */
const {test,expect}=require('@playwright/test');
const path=require('path'),fs=require('fs'),http=require('http');
test.use({channel:process.env.CI?'chromium':'chrome'});
test.setTimeout(180000);

const NOW=Date.parse('2026-10-08T18:00:00Z');
const ISS={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-10-08T06:00:00.000000',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,EPHEMERIS_TYPE:0,CLASSIFICATION_TYPE:'U',NORAD_CAT_ID:25544,ELEMENT_SET_NO:999,REV_AT_EPOCH:58451,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
const hourly={time:Array.from({length:240},(_,i)=>Math.floor(Date.parse('2026-10-08T00:00:00Z')/1000)+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:10,cloud_cover_low:5,cloud_cover_mid:3,cloud_cover_high:2,visibility:24000,precipitation:0,relative_humidity_2m:60,weather_code:0,temperature_2m:15}))hourly[key]=Array(240).fill(value);

function launch({id,name,net,precision,pad,site='Vandenberg SFB, CA, USA',timezone='America/Los_Angeles'}){
  return {id,slug:id,name,mission:name.split('| ').pop(),mission_type:'Communications',mission_description:'A scheduled flight used by the ascent-geometry regression.',orbit:'Low Earth Orbit',
   vehicle:'Falcon 9 Block 5',vehicle_family:'Falcon',provider:'SpaceX',provider_abbrev:'SpX',
   site:{name:site,timezone,country:'United States of America'},pad,status:{id:1,name:'Go for Launch',abbrev:'Go',kind:'scheduled'},
   net,precision,window:{start:null,end:null},last_updated:'2026-10-08T12:00:00.000Z',links:{ll2:'https://ll.thespacedevs.com/2.3.0/launches/'+id+'/',info:[],webcast:[]},change:null};
}
// One flight from the pad the published profiles come from, one date-only flight from a different coast.
const UPCOMING=[
  launch({id:'vandenberg-exact',name:'Falcon 9 Block 5 | Vandenberg Case',net:'2026-10-09T06:30:00.000Z',
    precision:{kind:'second',exact:true,dated:true,countdown:true,name:'Second'},
    pad:{name:'Space Launch Complex 4E',latitude:34.632,longitude:-120.6106}}),
  launch({id:'cape-date-only',name:'Falcon 9 Block 5 | Cape Date Only',net:'2026-10-12T00:00:00.000Z',
    precision:{kind:'day',exact:false,dated:true,countdown:false,name:'Day'},
    pad:{name:'Space Launch Complex 40',latitude:28.56194122,longitude:-80.57735736},
    site:'Cape Canaveral SFS, FL, USA',timezone:'America/New_York'}),
];
const FEED={schema:'worthlookingup.launches/1',available:true,generated_at:new Date(NOW).toISOString(),refresh_interval_minutes:30,stale_after_minutes:180,stale:false,stale_reason:null,
 source:{name:'Launch Library 2',publisher:'The Space Devs',api_version:'2.3.0',endpoint:'https://ll.thespacedevs.com/2.3.0/launches/',documentation:'https://thespacedevs.com/llapi',attribution:'Launch data: The Space Devs Launch Library 2',rights:'Free unauthenticated access is limited to 15 requests per hour.',rate_limit:{unauthenticated_requests_per_hour:15},retrieved_at:new Date(NOW).toISOString(),sha256:'a'.repeat(64),pages:1,upstream_count:2,upstream_records:2,announced_total:473,duplicates_removed:0},
 stats:{count:2,by_status:{scheduled:2},by_precision:{},with_published_time:1,with_published_date:1,period_only:1,sites:2,providers:1,nearest_net:null,window_days:180,announced_total:473},
 launches:UPCOMING};


// A minimal static server: only the files the page and the geometry module actually need.
function serve(){
  const allow=/^(index\.html|overhead[\w-]*\.js|preferences-transfer\.js|analytics-lite\.js|assets\/[\w./-]+|vendor\/[\w./-]+|src\/launches\/[\w.-]+|data\/launches\/[\w.-]+|docs\/[\w.-]+|favicon\.ico)$/;
  const server=http.createServer((request,response)=>{
    const file=new URL(request.url,'http://local').pathname.slice(1);
    if(!allow.test(file)){response.writeHead(404);response.end();return;}
    const full=path.resolve(file);
    if(!fs.existsSync(full)||fs.statSync(full).isDirectory()){response.writeHead(404);response.end();return;}
    const type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':
      file.endsWith('.mjs')||file.endsWith('.js')?'application/javascript':file.endsWith('.svg')?'image/svg+xml':
      file.endsWith('.webp')?'image/webp':file.endsWith('.jpg')||file.endsWith('.jpeg')?'image/jpeg':file.endsWith('.png')?'image/png':'application/octet-stream';
    response.setHeader('Content-Type',type);
    response.end(fs.readFileSync(full));
  });
  return server;
}

async function boot(page,{artifact=null}={}){
  const server=serve();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push('pageerror: '+error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push('console: '+message.text());});
  page.on('request',request=>requests.push(request.url()));
  await page.route('**/api/analytics/**',route=>route.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',route=>route.fulfill({json:[ISS]}));
  await page.route('**api.open-meteo.com/**',route=>route.fulfill({json:{timezone:'America/Los_Angeles',hourly}}));
  await page.route('**/api/launches.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(FEED)}));
  await page.route('**/data/launches/trajectory-profiles.json',route=>{
    if(!artifact)return route.continue();
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(artifact)});
  });
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(origin+'/index.html');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
  return {errors,requests,origin,close:()=>{server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve));}};
}

const committedArtifact=()=>JSON.parse(fs.readFileSync(path.resolve('data/launches/trajectory-profiles.json'),'utf8'));
const openPanel=page=>page.evaluate(()=>window.OverheadLaunchExplorer.open({
  site:{name:'Test observer',lat:34.4,lon:-119.7,tz:'America/Los_Angeles'},
  observers:[{name:'Second site',lat:51.5,lon:-0.12,tz:'Europe/London'}],
  formatLocal:milliseconds=>new Date(milliseconds).toISOString().slice(11,16)+' UTC',
}));

test('the panel loads the module and the profile artifact only when it is opened, and shows both gates',async({page})=>{
  const harness=await boot(page);
  try{
    expect(harness.requests.filter(url=>/trajectory-profiles\.json|launch-trajectory\.mjs/.test(url))).toHaveLength(0);
    await openPanel(page);
    await expect(page.locator('#ascent-dialog')).toBeVisible();
    await expect(page.locator('#ascent-flight option')).toHaveCount(3);
    await expect(page.locator('#ascent-status')).toContainText('passed both anchoring gates');
    expect(harness.requests.filter(url=>/trajectory-profiles\.json/.test(url))).toHaveLength(1);
    expect(harness.requests.filter(url=>/launch-trajectory\.mjs/.test(url))).toHaveLength(1);

    await page.locator('#ascent-flight').selectOption('paz-2018-020');
    const body=page.locator('#ascent-body');
    await expect(body).toContainText('Paz');
    await expect(page.locator('#ascent-dialog')).toContainText('none of it predicts a future launch');
    await expect(body).toContainText('not a forecast');
    await expect(body.locator('svg.ascent-chart')).toBeVisible();
    await expect(body).toContainText('Which way it went');
    await expect(body).toContainText('vis-viva');
    await expect(body).toContainText('Orbital plane');
    await expect(body).toContainText('Above your horizon');
    expect(await body.locator('.ascent-steps tbody tr').count()).toBeGreaterThan(3);
    await expect(body).toContainText('the pad is, not where the rocket went');
    // No unsupported claim may appear anywhere in the panel.
    const panel=await body.innerText();
    expect(panel).toContain('Brightness, plume size, apparent size and the chance of seeing anything are not');
    expect(panel).not.toMatch(/\d+\s?% (chance|probability)/i);
    expect(panel).not.toMatch(/will be visible|should be visible|visible at your/i);
    expect(panel).not.toMatch(/brightness of|plume size of|magnitude -?\d/i);
    expect(harness.errors).toEqual([]);
  }finally{await harness.close();}
});

test('a downgraded profile keeps its direction and withholds elevation',async({page})=>{
  const downgraded=committedArtifact();
  const target=downgraded.profiles.find(profile=>profile.id==='formosat-5-2017-049');
  target.validation.terminal.passes=false;
  target.validation.terminal.failures=['altitude'];
  target.validation.permissions={direction:'sector',elevation:false,timedWindow:false,illumination:'observer-only',downgraded:true,reasons:['the terminal-state check failed in altitude']};
  const harness=await boot(page,{artifact:downgraded});
  try{
    await openPanel(page);
    await page.locator('#ascent-flight').selectOption('formosat-5-2017-049');
    const body=page.locator('#ascent-body');
    await expect(body.locator('svg.ascent-sector')).toBeVisible();
    await expect(body.locator('svg.ascent-chart')).toHaveCount(0);
    await expect(body.locator('.ascent-steps')).toHaveCount(0);
    await expect(body).toContainText('Which way it went');
    await expect(body).toContainText('elevation and timed window withheld');
    await expect(body).toContainText('did not pass both anchoring gates');
    await expect(page.locator('#ascent-status')).toContainText('direction-only');
    expect(harness.errors).toEqual([]);
  }finally{await harness.close();}
});


test('a launch card gains the direction of its pad, never of the rocket, and keeps visibility unknown',async({page})=>{
  const harness=await boot(page);
  try{
    await page.getByRole('tab',{name:'ROCKET LAUNCHES'}).click();
    await page.waitForFunction(()=>['ready','error','unavailable'].includes(window.__OVERHEAD_TEST__.launches.status),null,{timeout:30000});
    await page.locator('[data-horizon="extended"]').click();
    await expect(page.locator("[data-launch='vandenberg-exact']")).toBeVisible();

    const vandenberg=page.locator("[data-pad-geometry='vandenberg-exact']");
    await expect(vandenberg).toBeVisible();
    await expect(vandenberg).toContainText('Launch pad direction');
    await expect(vandenberg).toContainText("not the rocket's path");
    await expect(vandenberg).toContainText(/[NSEW]{1,3} \(\d+°\) at [\d,.]+ km, \d+° (above|below) your horizon/);
    await expect(vandenberg.locator('[data-ascent-open]')).toContainText('historical');

    // A date-only flight gains the same time-independent pad geometry and still declares its schedule
    // uncertainty: no lighting forecast may be invented for a timestamp it does not have.
    const cape=page.locator("[data-pad-geometry='cape-date-only']");
    await expect(cape).toBeVisible();
    await expect(cape).toContainText('Launch pad direction');
    const capeCard=await page.locator("[data-launch='cape-date-only']").innerText();
    expect(capeCard).toContain('No time is published for this flight');
    // A date-only flight keeps its scheduling uncertainty: no twilight category and no solar number may
    // be invented for a time the provider never published.
    expect(capeCard).not.toMatch(/(civil|nautical|astronomical) twilight|Sun is \d|solar elevation/i);

    for(const card of await page.locator('.launch-card').all())expect(await card.innerText()).toMatch(/visibility unknown/i);

    // The card's own link opens the historical panel through the normal user path.
    await vandenberg.locator('[data-ascent-open]').click();
    await expect(page.locator('#ascent-dialog')).toBeVisible();
    await expect(page.locator('#ascent-status')).toContainText('passed both anchoring gates');
    await page.keyboard.press('Escape');
    await expect(page.locator('#ascent-dialog')).not.toBeVisible();
    expect(harness.errors).toEqual([]);
  }finally{await harness.close();}
});

test('the panel is usable and honest at phone, tablet and desktop widths in both themes',async({page})=>{
  const harness=await boot(page);
  try{
    for(const width of [390,768,1280,1440]){
      await page.setViewportSize({width,height:1000});
      if(!await page.locator('#ascent-dialog').isVisible())await openPanel(page);
      await expect(page.locator('#ascent-flight')).toBeEnabled();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      // Labelled controls, a described chart and keyboard operation, at every width.
      await expect(page.getByLabel('Historical flight')).toBeVisible();
      await expect(page.getByLabel('Observing location')).toBeVisible();
      const chart=page.locator('#ascent-body svg.ascent-chart');
      await expect(chart).toHaveAttribute('role','img');
      expect((await chart.getAttribute('aria-label'))||'').toMatch(/Elevation above your horizon/);
      await page.getByLabel('Historical flight').focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');
      await expect(page.locator('#ascent-body')).toContainText('Which way it went');
      for(const theme of ['light','dark']){
        await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
        await page.waitForTimeout(80);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
        const colour=await page.evaluate(()=>{
          const chart=document.querySelector('#ascent-body svg.ascent-chart');
          return {text:getComputedStyle(chart).color,polyline:getComputedStyle(chart.querySelector('polyline')).stroke};
        });
        expect(colour.polyline).toBe(colour.text);
      }
    }
    await page.locator('#ascent-dialog .close').click();
    await expect(page.locator('#ascent-dialog')).not.toBeVisible();
    expect(harness.errors).toEqual([]);
  }finally{await harness.close();}
});

test('an artifact that awards itself an elevation its gates did not pass is refused outright',async({page})=>{
  const tampered=committedArtifact();
  tampered.profiles[0].validation.terminal.passes=false;
  tampered.profiles[0].validation.terminal.failures=['speed'];
  const harness=await boot(page,{artifact:tampered});
  try{
    await openPanel(page);
    await expect(page.locator('#ascent-body')).toContainText('could not be loaded');
    await expect(page.locator('#ascent-body')).toContainText('did not validate');
    await expect(page.locator('#ascent-body .ascent-panel')).toHaveCount(0);
  }finally{await harness.close();}
});

