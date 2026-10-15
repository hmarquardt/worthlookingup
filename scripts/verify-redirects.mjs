import assert from 'node:assert/strict';

// Walk explicitly: automatic following hides host failures, query loss and downgrade hops.
export async function verifyRedirectChain(start, expected, fetcher = fetch) {
  let url = new URL(start);
  const destination = new URL(expected), seen = new Set(), chain = [];
  for (let hop = 0; hop <= 4; hop++) {
    assert.ok(!seen.has(url.href), 'Redirect loop at '+url.href);
    seen.add(url.href);
    const response = await fetcher(url, {redirect:'manual', signal:AbortSignal.timeout(30000)});
    const location = response.headers.get('location');
    chain.push({url:url.href, status:response.status, location});
    await response.body?.cancel();
    if (response.status === 200) {
      assert.equal(url.href, destination.href, 'Wrong final canonical URL');
      assert.ok(chain.length > 1, 'Expected a permanent redirect from '+start);
      return chain;
    }
    assert.ok([301,308].includes(response.status), 'Expected permanent redirect at '+url.href);
    assert.ok(location, 'Missing redirect Location');
    const next = new URL(location,url);
    assert.equal(next.protocol,'https:', 'Redirect must use HTTPS');
    assert.ok(['www.worthlookingup.com','worthlookingup.com'].includes(next.hostname), 'Unexpected redirect host');
    assert.equal(next.search,destination.search, 'Redirect lost or changed query parameters');
    const normalizedPath = url.pathname === '/overhead.html' ? '/' : url.pathname;
    // Cloudflare's HTTPS edge upgrade can precede the application's legacy-path redirect.
    const allowedPaths = url.protocol === 'http:' ? [url.pathname,normalizedPath] : [normalizedPath];
    assert.ok(allowedPaths.includes(next.pathname), 'Unexpected path change');
    if (url.protocol === 'https:') assert.equal(next.origin,'https://worthlookingup.com', 'HTTPS redirect must canonicalize host');
    url = next;
  }
  assert.fail('Too many redirect hops from '+start);
}

export async function verifyProductionRedirects(fetcher = fetch) {
  const query='?verify=1&value=a%2Fb&value=two&empty=';
  const chains=[];
  for (const protocol of ['https:','http:']) {
    for (const host of ['www.worthlookingup.com','worthlookingup.com']) {
      for (const path of ['/','/docs/privacy.md','/overhead.html']) {
        if (protocol === 'https:' && host === 'worthlookingup.com' && path !== '/overhead.html') continue;
        const expected='https://worthlookingup.com'+(path === '/overhead.html' ? '/' : path)+query;
        chains.push(await verifyRedirectChain(protocol+'//'+host+path+query,expected,fetcher));
      }
    }
  }
  return chains;
}
