/* Overhead celestial worker: computes the observing plan off the main thread.
   The page falls back to the same code synchronously if workers are unavailable, so the answer never
   depends on the worker existing. */
importScripts('vendor/overhead/astronomy-2.1.19.min.js', 'overhead-astro.js', 'overhead-opportunities.js',
  'overhead-planets.js', 'overhead-meteors.js', 'overhead-comets.js', 'overhead-milkyway.js',
  'overhead-celestial-plan.js');
self.onmessage = event => {
  const { id, request } = event.data || {};
  try {
    // Two request kinds share this worker: the planning horizons, and the on-demand seasonal search that
    // looks a year ahead. Both come from the same engines, so there is no second calculation path.
    const result = request && request.kind === 'season'
      ? self.OverheadCelestialPlan.computeSeason(request)
      : self.OverheadCelestialPlan.compute(request);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });
  }
};
