// Retry complete strict checks during Cloudflare propagation; never accept a partial result.
export async function verifyUntilReady(check, {
  timeoutMs=120000, intervalMs=5000, now=Date.now,
  wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)), log=console.warn
}={}) {
  const deadline=now()+timeoutMs;
  let attempt=0;
  while(true) {
    try { return await check(); }
    catch(error) {
      const remaining=deadline-now();
      if(remaining<=0) throw error;
      log('Production not ready (attempt '+(++attempt)+'): '+error.message);
      await wait(Math.min(intervalMs,remaining));
    }
  }
}
