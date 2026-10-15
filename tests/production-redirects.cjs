const assert=require('node:assert/strict');
(async()=>{
  const worker=(await import('../scripts/pages-worker.mjs')).default;
  const {verifyRedirectChain,verifyProductionRedirects}=await import('../scripts/verify-redirects.mjs');
  let served=0;
  const env={ASSETS:{fetch:async request=>{served++;return new Response('asset:'+new URL(request.url).pathname);}}};
  const query='?verify=1&value=a%2Fb&value=two&empty=';
  for(const host of ['worthlookingup.com','www.worthlookingup.com']){
    const response=await worker.fetch(new Request('https://'+host+'/overhead.html'+query),env);
    assert.equal(response.status,301);assert.equal(response.headers.get('location'),'https://worthlookingup.com/'+query);
  }
  const www=await worker.fetch(new Request('https://www.worthlookingup.com/docs/privacy.md'+query),env);
  assert.equal(www.headers.get('location'),'https://worthlookingup.com/docs/privacy.md'+query);
  for(const host of ['worthlookingup.com','preview.worthlookingup.pages.dev','localhost']){
    const request=new Request('https://'+host+'/assets/icons/favicon.svg'+query);
    const response=await worker.fetch(request,env);
    assert.equal(response.status,200);assert.equal(await response.text(),'asset:/assets/icons/favicon.svg');
  }
  assert.equal(served,3,'Redirects must not fetch assets; other requests must delegate');
  const fetcher=async url=>{
    url=new URL(url);
    // Real Cloudflare HTTP edge upgrades first without changing the host, path or query.
    if(url.protocol==='http:'){url.protocol='https:';return Response.redirect(url.href,301);}
    return worker.fetch(new Request(url),env);
  };
  const chains=await verifyProductionRedirects(fetcher);
  assert.equal(chains.length,10);assert.ok(chains.some(chain=>chain.length===3));
  const start='https://www.worthlookingup.com/overhead.html'+query, end='https://worthlookingup.com/'+query;
  for(const location of ['/'+query, 'http://worthlookingup.com/'+query,'https://example.com/'+query,
      'https://worthlookingup.com/','https://worthlookingup.com/wrong'+query,
      'https://worthlookingup.com/overhead.html'+query]){
    await assert.rejects(verifyRedirectChain(start,end,async()=>Response.redirect(new URL(location,start).href,301)));
  }
  await assert.rejects(verifyRedirectChain(start,end,async()=>Response.redirect(end,302)));
  await assert.rejects(verifyRedirectChain(start,end,async()=>new Response('www must not serve directly')));
  await assert.rejects(verifyRedirectChain(start,end,async()=>new Response(null,{status:301})));
  // A canonical self-redirect must fail instead of exhausting an unbounded fetch loop.
  await assert.rejects(verifyRedirectChain('https://worthlookingup.com/'+query,end,async url=>Response.redirect(url.href,301)),/loop/);
  console.log('PASS: canonical/legacy redirects, static delegation, HTTP upgrade chains, encoded/repeated/empty queries; verifier rejects bad hosts, paths, protocols, status, loops and missing Location.');
})().catch(error=>{console.error(error);process.exitCode=1;});
