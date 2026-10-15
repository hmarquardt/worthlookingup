const {test,expect}=require('@playwright/test'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
test.use({channel:process.env.CI?'chromium':'chrome'});
test('HTTP artifact loads both workers, has no collection dependency, and transfers bounded preferences',async({page})=>{
  const root=path.resolve('dist');
  const types={'.html':'text/html','.js':'application/javascript','.json':'application/json','.svg':'image/svg+xml','.css':'text/css','.png':'image/png'};
  const missing=[],requests=[],errors=[];
  const server=http.createServer((req,res)=>{
    const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));
    const target=file===root+'/'?path.join(root,'index.html'):file;
    if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){missing.push(req.url);res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',types[path.extname(target)]||'text/plain');res.end(fs.readFileSync(target));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/analytics/**',r=>r.fulfill({status:204,body:''}));
  await page.route('**celestrak.org/**',r=>r.fulfill({json:[]}));
  await page.route('**api.open-meteo.com/**',r=>r.fulfill({json:{error:'Unavailable'}}));
  try{
    await page.goto('http://127.0.0.1:'+server.address().port+'/');
    await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy);
    const loaded=await page.evaluate(async()=>{
      const run=(file,message)=>new Promise((resolve,reject)=>{const worker=new Worker(file);const timer=setTimeout(()=>{worker.terminate();reject(Error('Worker timeout'));},15000);worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve(e.data);};worker.postMessage(message);});
      const orbital=await run('overhead-worker.js',{objects:[],site:__OVERHEAD_TEST__.state.site,windows:[],minimum:10});
      // Invalid request still exercises all celestial imports and returns the worker error protocol.
      const celestial=await run('overhead-celestial-worker.js',{id:'probe',request:{}});
      return {orbital,celestial};
    });
    expect(loaded.orbital).toBeTruthy();expect(loaded.celestial.id).toBe('probe');
    await expect(page.locator('.brand')).toHaveText('WORTH LOOKING UP');
    for(const width of [360,390,768,1440]){
      await page.setViewportSize({width,height:900});
      for(const theme of ['light','dark']){
        await page.evaluate(t=>document.querySelector('[data-theme-choice="'+t+'"]').click(),theme);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      }
    }
    await page.locator('#settings-open').click();await page.locator('.preferences-transfer summary').click();
    const exported=page.waitForEvent('download');await page.locator('#preferences-export').click();expect((await exported).suggestedFilename()).toBe('worthlookingup-preferences.json');
    await page.locator('#preferences-import').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"schema":"wrong","values":{}}')});
    await expect(page.locator('#preferences-status')).toContainText('Import failed');
    const values={site:{name:'Cape Town',lat:-33.9,lon:18.4,tz:'Africa/Johannesburg'},theme:'light',favorites:['25544']};
    await page.locator('#preferences-import').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schema:'worthlookingup.preferences/1',values}))});
    await page.waitForFunction(()=>window.__OVERHEAD_TEST__?.state.site.name==='Cape Town');
    expect(await page.evaluate(()=>__OVERHEAD_TEST__.state.favorites)).toEqual(['25544']);
    expect(missing).toEqual([]);expect(errors).toEqual([]);
    expect(requests.filter(url=>/hmarquardt\.github\.io\/junkdrawer|junkdrawer\.(com|pages\.dev)/i.test(url))).toEqual([]);
    await page.screenshot({path:'/private/tmp/worthlookingup-mobile.png',fullPage:true});
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
