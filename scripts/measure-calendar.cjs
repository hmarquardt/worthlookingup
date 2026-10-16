/* Measure the layout cost of the calendar controls: the first satellite row's document position with
   the new action row present and with it removed, at four widths, using the staged dist build. */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve('dist');
const types={'.html':'text/html','.js':'application/javascript','.json':'application/json','.svg':'image/svg+xml','.css':'text/css','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const ISS={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-10-08T06:00:00.000000',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,NORAD_CAT_ID:25544,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
const hourly={time:Array.from({length:240},(_,i)=>Math.floor(Date.parse('2026-10-08T00:00Z')/1000)+i*3600)};
for(const [key,value]of Object.entries({cloud_cover:15,visibility:24000,precipitation:0,weather_code:0,temperature_2m:15}))hourly[key]=Array(240).fill(value);
(async()=>{
  const server=http.createServer((req,res)=>{
    const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));
    const target=file===root+'/'?path.join(root,'index.html'):file;
    if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',types[path.extname(target)]||'text/plain');res.end(fs.readFileSync(target));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage();
  await page.clock.setFixedTime(new Date(Date.parse('2026-10-08T18:00Z')));
  await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',r=>r.fulfill({json:[ISS]}));
  await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{timezone:'America/Chicago',hourly}}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
  await page.locator('#discovery-build').click();
  await page.waitForTimeout(4000);
  for(const width of [390,768,1280,1440]){
    await page.setViewportSize({width,height:900});
    await page.waitForTimeout(200);
    const measured=await page.evaluate(viewportWidth=>{
      const row=document.querySelector('.event');
      const withActions=row?row.getBoundingClientRect().top+scrollY:null;
      const cards=[...document.querySelectorAll('.discovery-event')];
      const rowHeight=cards.length?cards[0].querySelector('.calendar-actions')?.getBoundingClientRect().height||0:0;
      const nodes=[...document.querySelectorAll('.calendar-actions,.calendar-note')];
      const stash=nodes.map(node=>({node,parent:node.parentNode,next:node.nextSibling}));
      stash.forEach(({node})=>node.remove());
      const withoutActions=row?row.getBoundingClientRect().top+scrollY:null;
      stash.reverse().forEach(({node,parent,next})=>parent.insertBefore(node,next));
      const guide=document.getElementById('discovery').getBoundingClientRect().height;
      return {withActions:Math.round(withActions),withoutActions:Math.round(withoutActions),rowHeight:Math.round(rowHeight),
        cards:cards.length,guideHeight:Math.round(guide),overflow:document.documentElement.scrollWidth-viewportWidth};
    },width);
    console.log(width,JSON.stringify(measured));
  }
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
})();
