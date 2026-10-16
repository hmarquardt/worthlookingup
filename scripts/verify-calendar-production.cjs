/* Independent production check: download real .ics files from https://worthlookingup.com/ with a
   real Chrome browser, inspect them, and record screenshots.
   Run: node scripts/verify-calendar-production.cjs [base-url] [output-dir] */
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const base=process.argv[2]||'https://worthlookingup.com/';
const out=process.argv[3]||'/tmp/wlu-prod-calendar';
fs.mkdirSync(out,{recursive:true});
const unfold=ics=>ics.split('\r\n').filter(line=>line!=='').reduce((list,line)=>{if(line.startsWith(' '))list[list.length-1]+=line.slice(1);else list.push(line);return list;},[]);
const props=(ics,name)=>unfold(ics).filter(line=>line===name||line.startsWith(name+':')||line.startsWith(name+';'));
const check=(ok,message)=>{if(!ok)throw Error('FAILED: '+message);console.log('ok   '+message);};
async function save(page,locator,file){
  const pending=page.waitForEvent('download',{timeout:60000});
  await locator.click();
  const download=await pending;
  const target=path.join(out,file);
  await download.saveAs(target);
  return {name:download.suggestedFilename(),text:fs.readFileSync(target,'utf8')};
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  const errors=[],bad=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)bad.push(response.status()+' '+response.url());});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__OVERHEAD_TEST__&&!__OVERHEAD_TEST__.state.busy,null,{timeout:90000});
  const release=await page.evaluate(()=>document.querySelector('[data-deploy-version]').dataset.deployVersion);
  console.log('deployed release',release);
  check(release==='2026.10.15.6','the deployed release is the one built here');
  check(await page.locator('#observing-plan').isHidden(),'the observing plan is hidden while nothing is selected');

  // 1. Single event from the discovery guide.
  await page.locator('#discovery-build').click();
  await page.waitForTimeout(6000);
  const card=page.locator('.discovery-event [data-calendar-add]').first();
  await card.waitFor({timeout:60000});
  const single=await save(page,card,'discovery-event.ics');
  check(/^worth-looking-up-[\w-]+-\d{8}\.ics$/.test(single.name),'the download filename is descriptive and safe: '+single.name);
  check(!/[^\r]\n/.test(single.text),'the file uses CRLF line endings only');
  check(single.text.split('\r\n').every(line=>Buffer.byteLength(line,'utf8')<=75),'every line is folded to 75 octets or fewer');
  const lines=unfold(single.text);
  check(lines[0]==='BEGIN:VCALENDAR'&&lines[lines.length-1]==='END:VCALENDAR','VCALENDAR wraps the file');
  check(props(single.text,'BEGIN:VEVENT').length===1,'exactly one VEVENT');
  check(/^UID:wlu-[\w-]+@worthlookingup\.com$/.test(props(single.text,'UID')[0]),'the UID is product-owned: '+props(single.text,'UID')[0]);
  check(/^DTSTAMP:\d{8}T\d{6}Z$/.test(props(single.text,'DTSTAMP')[0]),'DTSTAMP is a UTC instant');
  check(/^DTSTART:\d{8}T\d{6}Z$/.test(props(single.text,'DTSTART')[0]),'DTSTART is a UTC instant');
  check(props(single.text,'URL')[0]==='URL:https://worthlookingup.com/','the entry links back to Worth Looking Up');
  check(!/overhead\.|localStorage|38\.35|-87\.5/.test(single.text),'no browser state or coordinates are exported');
  console.log('note '+props(single.text,'SUMMARY')[0]);

  // 2. Launch calendar: an exact schedule, a date-only schedule, and a refused broad period.
  await page.getByRole('tab',{name:'ROCKET LAUNCHES'}).click();
  await page.waitForFunction(()=>['ready','error','unavailable'].includes(__OVERHEAD_TEST__.launches.status),null,{timeout:60000});
  await page.locator('[data-horizon="week"]').click();
  await page.waitForTimeout(1500);
  const exact=page.locator('.launch-card [data-calendar-add]').first();
  if(await exact.count()){
    const launch=await save(page,exact,'launch-exact.ics');
    check(props(launch.text,'STATUS')[0]==='STATUS:TENTATIVE','a published target time is tentative');
    const description=unfold(launch.text).find(line=>line.startsWith('DESCRIPTION:'));
    check(/published target time/.test(description)&&/not a confirmed liftoff/.test(description),'the description says the time is a target, not a liftoff');
    check(/Local visibility: unknown/.test(description),'local visibility is stated as unknown');
    check(!/will be visible|probability|chance of/i.test(description),'no visibility claim or probability');
    check(props(launch.text,'DTEND').length===0,'a target time has no fabricated end');
  }else console.log('note no dated launch is on the calendar right now; the refusal rule still applies');
  check(await page.locator('[data-launch-period] [data-calendar-add]').count()===0,'period-only schedules offer no calendar action');
  console.log('note period-only schedules in this window: '+await page.locator('[data-launch-period]').count());
  await page.screenshot({path:path.join(out,'launches-1280.png'),fullPage:false});

  // 3. Observing plan: several selections, one file, then remove and clear.
  await page.getByRole('tab',{name:'SATELLITES'}).click();
  await page.waitForTimeout(800);
  await page.locator('.discovery-event [data-plan-toggle]').first().click();
  await page.locator('#discovery-coming summary').first().click();
  const second=page.locator('#discovery-upcoming [data-plan-toggle]').first();
  if(await second.count())await second.click();
  await page.waitForTimeout(500);
  const selected=await page.evaluate(()=>__OVERHEAD_TEST__.observingPlan.size);
  check(selected>=1,'the observing plan holds '+selected+' selection(s)');
  check(await page.locator('#plan-count').textContent()==='· '+selected+(selected===1?' event':' events'),'the plan shows a compact count indicator');
  await page.screenshot({path:path.join(out,'plan-1280-dark.png'),fullPage:false});
  const plan=await save(page,page.locator('#plan-download'),'observing-plan.ics');
  check(props(plan.text,'BEGIN:VEVENT').length===selected,'one VEVENT per selection');
  check(new Set(props(plan.text,'UID')).size===selected,'every selection has its own stable UID');
  check(props(plan.text,'BEGIN:VCALENDAR').length===1,'the plan is one calendar in one file');
  await page.locator('#plan-list [data-plan-remove]').first().click();
  await page.waitForTimeout(300);
  check(await page.evaluate(()=>__OVERHEAD_TEST__.observingPlan.size)===selected-1,'removing one selection keeps the others');
  await page.locator('#plan-clear').click();
  await page.waitForTimeout(300);
  check(await page.evaluate(()=>__OVERHEAD_TEST__.observingPlan.size)===0,'clearing empties the plan');
  check(await page.locator('#observing-plan').isHidden(),'the plan panel hides itself when empty');
  check(await page.evaluate(()=>!Object.keys(localStorage).includes('overhead.plan')),'the plan writes no preference key');

  // 4. Mobile layout, keyboard reachability and both themes.
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(400);
  check(await page.evaluate(()=>document.documentElement.scrollWidth)<=390,'no horizontal overflow on a 390px phone');
  const addBox=await page.locator('.discovery-event [data-calendar-add]').first().boundingBox();
  check(addBox.height>=40,'the calendar control is a comfortable tap target on a phone ('+Math.round(addBox.height)+'px)');
  await page.locator('.discovery-event [data-plan-toggle]').first().click();
  await page.waitForTimeout(400);
  const removeBox=await page.locator('#plan-list [data-plan-remove]').first().boundingBox();
  check(removeBox.height>=40,'the plan remove control is a comfortable tap target on a phone ('+Math.round(removeBox.height)+'px)');
  await page.screenshot({path:path.join(out,'plan-390-dark.png'),fullPage:false});
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Use light theme'}).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(await page.evaluate(()=>document.documentElement.scrollWidth)<=390,'no horizontal overflow in the light theme on a phone');
  await page.screenshot({path:path.join(out,'plan-390-light.png'),fullPage:false});
  await page.keyboard.press('Tab');
  const add=page.locator('.discovery-event [data-calendar-add]').first();
  await add.focus();
  check(await add.evaluate(element=>getComputedStyle(element).outlineStyle)==='solid','the calendar control shows a visible focus outline');
  await page.locator('#plan-clear').click();
  await browser.close();
  check(errors.length===0,'no page errors: '+(errors.join('; ')||'none'));
  console.log('note HTTP error responses observed: '+(bad.join(', ')||'none'));
  console.log('PASS: production calendar export and observing plan verified at '+base+'; artefacts in '+out);
})().catch(error=>{console.error(error.message);process.exit(1);});
