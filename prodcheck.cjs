const { chromium } = require('playwright');
const BASE='https://worthlookingup.com';
(async()=>{
 const browser=await chromium.launch({channel:'chrome'});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push('pageerror: '+e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push('console: '+m.text());});
 await page.goto(BASE+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!window.__OVERHEAD_TEST__.state.busy,null,{timeout:60000});
 console.log('release:',await page.evaluate(()=>document.querySelector('[data-deploy-version]').dataset.deployVersion));
 await page.locator('[data-category="milkyway"]').click();
 await page.waitForFunction(()=>{const c=window.__OVERHEAD_TEST__.celestial;return c.status==='ready'&&!c.busy;},null,{timeout:90000});
 await page.locator('#session-open').click();
 await page.waitForFunction(()=>!!document.querySelector('[data-session-root]'),null,{timeout:60000});
 console.log('1 builder open, points offered:',await page.locator('#milkyway-session [data-session="where"]').count());
 // 1. a future favourable night at Camp Cadiz, from the season search
 await page.locator('#milkyway-session [data-session="where"][data-value="camp-cadiz-campground"]').click();
 await page.locator('#milkyway-session [data-session="when"][data-value="favourable"]').click();
 await page.waitForFunction(()=>{const s=window.__OVERHEAD_TEST__.session;return s.when==='favourable'&&!!s.season&&s.date===s.season.favorable.day;},null,{timeout:120000});
 await page.waitForTimeout(1200);
 const seasonDate=await page.evaluate(()=>window.__OVERHEAD_TEST__.session.date);
 const text1=await page.locator('#milkyway-session').innerText();
 console.log('2a facts:',JSON.stringify((text1.match(/Observing window[^\n]*\n[^\n]*/)||[''])[0]),'| date label:',(text1.match(/[A-Z][a-z]+, [A-Z][a-z]+ \d+, \d{4}/)||[''])[0]);
 console.log('2 favourable night:',seasonDate,'| window:',/Observing window/.test(text1),'| terrain:',/Terrain toward the core/.test(text1),'| weather:',(text1.match(/Weather is not available for this place|[^\n]*forecastable[^\n]*/)||[''])[0].slice(0,90));
 // 2. no window on 2026-10-20
 await page.evaluate(()=>window.__OVERHEAD_TEST__.applySessionDate('2026-10-20'));
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__.session.date==='2026-10-20');
 const text2=await page.locator('#milkyway-session').innerText();
 console.log('3 no-window:',/No qualifying Galactic-core window at this place on this date/.test(text2),
  '| save disabled:',await page.locator('#milkyway-session [data-session="save"]').isDisabled());
 // 3 + 5. own location, a date beyond the forecast
 await page.locator('#milkyway-session [data-session="where"][data-value="home"]').click();
 await page.evaluate(()=>window.__OVERHEAD_TEST__.applySessionDate('2027-04-13'));
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__.session.date==='2027-04-13');
 const text3=await page.locator('#milkyway-session').innerText();
 console.log('4 own location:',/My saved location/.test(text3),'| unverified:',/no public-access evidence/.test(text3),
  '| no invented terrain:',/Terrain horizon unavailable/.test(text3),
  '| forecast honest:',/Weather is not yet forecastable for this date\./.test(text3));
 // 6. calendar export from a point, captures the .ics
 await page.locator('#milkyway-session [data-session="where"][data-value="camp-cadiz-campground"]').click();
 await page.evaluate(()=>window.__OVERHEAD_TEST__.applySessionDate('2027-04-13'));
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__.session.date==='2027-04-13');
 const downloadPromise=page.waitForEvent('download',{timeout:30000});
 await page.locator('#milkyway-session [data-session="calendar"]').click();
 const download=await downloadPromise;
 const stream=await download.createReadStream();
 let ics='';for await(const chunk of stream)ics+=chunk.toString();
 console.log('5 calendar:',download.suggestedFilename(),'| DTSTART:',/DTSTART/.test(ics),'| LOCATION:',(ics.match(/LOCATION:[^\r\n]*/)||[''])[0],'| no drive:',!/drive time/i.test(ics));
 // 6. print sheet
 await page.evaluate(()=>{window.__PRINTED__=0;window.print=()=>{window.__PRINTED__++;};});
 await page.locator('#milkyway-session [data-session="print"]').click();
 await page.waitForFunction(()=>window.__PRINTED__===1,null,{timeout:20000});
 const sheet=await page.locator('#session-print').innerText();
 console.log('6 print:',/Milky Way photography session/.test(sheet),'| evidence:',/Official access evidence/.test(sheet),'| kit:',/Equipment/.test(sheet),'| unknowns:',/Unresolved/.test(sheet));
 // 4. save, reload, reopen
 await page.locator('#milkyway-session [data-session="save"]').click();
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__.session.saved.length>0,null,{timeout:20000});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!window.__OVERHEAD_TEST__.state.busy,null,{timeout:90000});
 await page.locator('[data-category="milkyway"]').click();
 await page.waitForFunction(()=>{const c=window.__OVERHEAD_TEST__.celestial;return c.status==='ready'&&!c.busy;},null,{timeout:90000});
 await page.locator('#session-open').click();
 await page.waitForFunction(()=>!!document.querySelector('[data-session-root]'),null,{timeout:60000});
 await page.locator('#milkyway-session [data-session="open"]').first().click();
 await page.waitForTimeout(500);
 const text4=await page.locator('#milkyway-session').innerText();
 console.log('7 reopened after reload:',/Opened a plan saved/.test(text4),'|',/Camp Cadiz Campground/.test(text4));
 // mobile, no overflow, six categories intact
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(400);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
 const categories=await page.locator('[data-category]').count();
 const factsFont=await page.locator('#milkyway-session .sx-fact dd').first().evaluate(node=>getComputedStyle(node).fontSize);
 console.log('8 mobile:',overflow,'px overflow | categories:',categories,'| fact size:',factsFont,'| errors:',errors.length?errors.slice(0,3):'none');
 await browser.close();
})().catch(e=>{console.log('FATAL',e.message);process.exit(1);});
