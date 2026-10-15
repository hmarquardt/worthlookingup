// Pages _redirects cannot match hostnames. Keep canonicalization with the deployed artifact.
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
    return env.ASSETS.fetch(request);
  }
};
