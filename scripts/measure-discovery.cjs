/* Local lab comparison; source fixtures are deterministic, not live observing claims.
   npm run dev, then node scripts/measure-discovery.cjs. Optional WLU_BASELINE_HTML/CSS intercept
   the previous release documents; all scientific engines stay identical. */
const {chromium}=require('@playwright/test'),fs=require('node:fs');
const phase=process.env.WLU_MEASURE_PHASE||'after';
const iss={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-09-07T11:57:47.376864',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,NORAD_CAT_ID:25544,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
(async()=>{const browser=await chromium.launch({channel:process.env.CI?'chromium':'chrome'}),rows=[];
for(const width of [390,768,1280,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),requests=[];
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 page.on('request',r=>requests.push(r.url()));
 await page.addInitScript(()=>{window.lab={cls:0,lcp:0};new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)lab.cls+=e.value;}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())lab.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});});
 await page.clock.setFixedTime(new Date('2026-09-07T18:00Z'));
 await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));await page.route('**celestrak.org/**',r=>r.fulfill({json:[iss]}));await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{error:'offline'}}));
 if(process.env.WLU_BASELINE_HTML)await page.route('http://localhost:8787/',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.WLU_BASELINE_HTML,'utf8')}));
 if(process.env.WLU_BASELINE_CSS)await page.route('**/assets/brand/identity.css',r=>r.fulfill({contentType:'text/css',body:fs.readFileSync(process.env.WLU_BASELINE_CSS,'utf8')}));
 await page.goto('http://localhost:8787');await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);await page.waitForTimeout(500);
 const row=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth,firstUseful:(document.querySelector('.discovery-open')||document.querySelector('.weekly-open')).getBoundingClientRect().top,firstDetailed:document.querySelector('.event').getBoundingClientRect().top,...lab}));
 const metrics=await cdp.send('Performance.getMetrics');row.scriptMilliseconds=metrics.metrics.find(m=>m.name==='ScriptDuration').value*1000;row.initialRequests=requests.length;row.providerRequests=requests.filter(x=>/celestrak|open-meteo/.test(x)).length;row.previewFeedRequests=requests.filter(x=>/api\/launches|data\/overhead|data\/launches/.test(x)).length;
 await page.screenshot({path:`/tmp/wlu-phase3-${phase}-${width}.png`,fullPage:true});
 const capture=require('../tests/fixtures/overhead-incident-2026-09-08.json');await page.clock.setFixedTime(new Date('2026-09-09T01:18Z'));
 await page.evaluate(c=>{const a=__OVERHEAD_TEST__,s=a.state;s.nights=a.engine.nights(s.site,Date.now());s.results={0:[c.pass,...Array.from({length:6},(_,i)=>({...structuredClone(c.pass),id:'active-'+i,norad:String(90000+i),name:'Active spacecraft '+i,likely:false,provisional:true,groups:['visual']}))]};s.groups=new Set(['iss','stations','visual']);a.render();},capture);
 row.nowCollapsed=(await page.locator('#happening-now').boundingBox()).height;
 await page.screenshot({path:`/tmp/wlu-phase3-${phase}-now-${width}.png`});
 if(await page.locator('#happening-more').count())await page.locator('#happening-more summary').click();
 row.nowExpanded=(await page.locator('#happening-now').boundingBox()).height;
 rows.push(row);await page.close();
}
console.log(JSON.stringify(rows,null,2));fs.writeFileSync(`/tmp/wlu-phase3-${phase}-measurements.json`,JSON.stringify(rows,null,2));await browser.close();})().catch(e=>{console.error(e);process.exitCode=1});
