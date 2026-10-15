// Worth Looking Up Pages Worker (Pages advanced mode; staged as dist/_worker.js by scripts/build.cjs).
//
// Two responsibilities, nothing else:
//   1. Host canonicalization. Pages _redirects cannot match hostnames, so www and the legacy
//      /overhead.html path are normalized here with permanent redirects that preserve the query.
//   2. The launch schedule endpoint, GET /api/launches.json, which serves the normalized launch feed
//      from the edge cache, the optional LAUNCHES KV namespace, the committed feed, or a bounded
//      upstream refresh. Visitors never call the launch provider directly.
//
// The import below is the reason this file lives at the repository root rather than in scripts/: the
// specifier resolves identically here (./src/launches/launch-feed.mjs) and inside the deployment
// (dist/src/launches/launch-feed.mjs), so the deployed artifact and the tested source are the same
// code with no build-time rewriting. Wrangler bundles the import into dist/_worker.js at deploy time.
import {handleLaunchFeedRequest} from './src/launches/launch-feed.mjs';

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    const legacy = url.pathname === '/overhead.html';
    if (url.hostname === 'www.worthlookingup.com' || legacy ||
        (url.hostname === 'worthlookingup.com' && url.protocol !== 'https:')) {
      url.protocol = 'https:';
      url.hostname = 'worthlookingup.com';
      url.port = '';
      if (legacy) url.pathname = '/';
      return Response.redirect(url.href, 301);
    }
    if (url.pathname === '/api/launches.json') return handleLaunchFeedRequest(request, env);
    return env.ASSETS.fetch(request);
  }
};
