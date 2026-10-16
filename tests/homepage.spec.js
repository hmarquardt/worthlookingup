const {test,expect}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');
const iss={OBJECT_NAME:'ISS (ZARYA)',OBJECT_ID:'1998-067A',EPOCH:'2026-09-07T11:57:47.376864',MEAN_MOTION:15.49018229,ECCENTRICITY:.00049836,INCLINATION:51.6306,RA_OF_ASC_NODE:252.7093,ARG_OF_PERICENTER:115.8922,MEAN_ANOMALY:244.258,NORAD_CAT_ID:25544,BSTAR:.00010434666,MEAN_MOTION_DOT:.00005306,MEAN_MOTION_DDOT:0};
async function boot(page,{images=true}={}){
 await page.clock.setFixedTime(new Date('2026-09-07T18:00Z'));
 await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
 await page.route('**celestrak.org/**',r=>r.fulfill({json:[iss]}));
 await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{error:'unavailable'}}));
 if(!images)await page.route('**/earth-at-night*',r=>r.abort());
 await page.goto('file://'+path.resolve('index.html'));
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
 await expect(page.locator('.weekly-open')).toBeVisible();
}
test('photographic discovery exposes real opportunities, every category and both themes at all widths',async({page})=>{
 await boot(page);
 const evidence=[];
 for(const width of [390,768,1280,1440]){
  await page.setViewportSize({width,height:900});
  for(const theme of ['dark','light']){
   await page.evaluate(t=>document.querySelector('[data-theme-choice="'+t+'"]').click(),theme);
   await expect(page.locator('.weekly-open')).toContainText('ISS');
   await expect(page.locator('#weekly-card')).toContainText('Cloud forecast unavailable');
   const geometry=await page.evaluate(()=>{
    const r=s=>document.querySelector(s).getBoundingClientRect();
    const location=r('#location-open'),settings=r('#settings-open');
    return {width:innerWidth,scroll:document.documentElement.scrollWidth,hero:r('.sky-intro').height,highlight:r('.discovery-open').top,overlap:location.right>settings.left&&location.bottom>settings.top&&settings.bottom>location.top};
   });
   expect(geometry.scroll).toBe(geometry.width);expect(geometry.overlap).toBe(false);
   expect(geometry.highlight).toBeLessThan(600);
   if(width===390)expect(geometry.hero).toBeLessThan(240);
   for(const tab of await page.locator('#categories [role=tab]').all()){
    const box=await tab.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
   }
   const img=page.locator('.sky-intro img');expect(await img.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
   expect(await img.evaluate(e=>e.currentSrc)).toMatch(/earth-at-night-\d+\.webp/);
   await page.screenshot({path:`/tmp/wlu-final-${theme}-${width}.png`,fullPage:true});evidence.push({...geometry,theme});
  }
 }
 fs.writeFileSync('/tmp/wlu-responsive.json',JSON.stringify(evidence,null,2));
 await page.evaluate(()=>window.scrollTo(0,0));await page.keyboard.press('Tab');
 await expect(page.locator('.skip-link')).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.locator('#categories')).toBeFocused();
 const tabs=page.locator('#categories [role=tab]');await tabs.first().focus();await page.keyboard.press('ArrowRight');
 await expect(tabs.nth(1)).toBeFocused();await tabs.first().click();
 await page.locator('#location-open').click();await expect(page.locator('#location-dialog')).toBeVisible();await page.keyboard.press('Escape');
 await page.locator('.weekly-open').click();await expect(page.locator('#event-dialog')).toBeVisible();await page.keyboard.press('Escape');
});
test('failed photographs preserve the hero action, geometry and calculated event',async({page})=>{
 await page.setViewportSize({width:390,height:900});await boot(page,{images:false});
 await expect(page.locator('.sky-intro h2')).toHaveText('Some nights deservean audience.');
 await expect(page.getByRole('link',{name:'Explore your sky'})).toBeVisible();
 expect(await page.locator('.sky-intro').evaluate(e=>getComputedStyle(e).backgroundImage)).toContain('night-sky.svg');
 expect((await page.locator('.sky-intro').boundingBox()).height).toBeLessThan(240);
 await page.getByRole('link',{name:'Explore your sky'}).click();await expect(page.locator('#categories')).toBeFocused();
 await expect(page.locator('.weekly-open')).toContainText('ISS');
});
test('every responsive photograph is local, staged, and covered by source provenance',async()=>{
 const provenance=JSON.parse(fs.readFileSync('assets/provenance.json'));
 const photo=provenance.assets.find(x=>x.creator.includes('Mastracchio'));
 expect(photo.license_url).toBe('https://www.nasa.gov/nasa-brand-center/images-and-media/');
 for(const file of photo.paths){expect(fs.existsSync('assets/'+file)).toBe(true);expect(fs.readFileSync('dist/assets/'+file)).toEqual(fs.readFileSync('assets/'+file));}
});
