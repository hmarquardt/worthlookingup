/* Explicit preference transfer only. Never copies caches or analytics identifiers. */
(function (root) {
  'use strict';
  const keys = ['site', 'sites', 'settings', 'favorites', 'theme'];
  function validate(input) {
    if (!input || input.schema !== 'worthlookingup.preferences/1' || !input.values ||
        Object.keys(input.values).some(key => !keys.includes(key))) throw Error('Unrecognized preference export.');
    const v = input.values;
    const site = s => {
      if (!s || typeof s.name !== 'string' || s.name.length > 200 || !Number.isFinite(s.lat) ||
          Math.abs(s.lat) > 90 || !Number.isFinite(s.lon) || Math.abs(s.lon) > 180 || typeof s.tz !== 'string') throw Error('Invalid observing location.');
      new Intl.DateTimeFormat('en', {timeZone: s.tz}).format();
      return {name:s.name, lat:s.lat, lon:s.lon, tz:s.tz};
    };
    const clean = {};
    if ('site' in v) clean.site = site(v.site);
    if ('sites' in v) {
      if (!Array.isArray(v.sites) || v.sites.length > 12) throw Error('At most 12 saved sites are supported.');
      clean.sites = v.sites.map(site);
    }
    if ('favorites' in v) {
      if (!Array.isArray(v.favorites) || v.favorites.length > 100 || v.favorites.some(x => typeof x !== 'string' || !/^\d{1,12}$/.test(x))) throw Error('Invalid spacecraft favorites.');
      clean.favorites = [...new Set(v.favorites)];
    }
    if ('theme' in v) {
      if (!['light','dark'].includes(v.theme)) throw Error('Invalid theme.');
      clean.theme = v.theme;
    }
    if ('settings' in v) {
      const s = v.settings;
      if (!s || ![10,20,30,45].includes(Number(s.minimum)) || !Number.isFinite(Number(s.score)) || Number(s.score)<0 || Number(s.score)>100 ||
          !['likely','great','all'].includes(s.show) || !['imperial','metric'].includes(s.units) || !['12','24'].includes(s.clock)) throw Error('Invalid observing settings.');
      clean.settings = {minimum:s.minimum,score:s.score,show:s.show,units:s.units,clock:s.clock};
    }
    return clean;
  }
  function snapshot(storage) {
    const values = {};
    for (const key of keys) {
      const raw = storage.getItem('overhead.' + key);
      if (raw !== null) values[key] = key === 'theme' ? raw : JSON.parse(raw);
    }
    return {schema:'worthlookingup.preferences/1', values};
  }
  function apply(input, storage) {
    const values = validate(input), previous = new Map(), changed = [];
    try {
      for (const [key,value] of Object.entries(values)) {
        const name = 'overhead.' + key;
        previous.set(name, storage.getItem(name));
        storage.setItem(name, key === 'theme' ? value : JSON.stringify(value));
        changed.push(name);
      }
    } catch (error) {
      for (const name of changed.reverse()) {
        const old = previous.get(name);
        if (old === null) storage.removeItem(name); else storage.setItem(name, old);
      }
      throw error;
    }
  }
  const api = {validate, snapshot, apply};
  if (typeof module === 'object') module.exports = api;
  if (!root.document) return;
  root.document.addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('preferences-status');
    document.getElementById('preferences-export').onclick = () => {
      try {
        const file = snapshot(localStorage);
        validate(file);
        const url = URL.createObjectURL(new Blob([JSON.stringify(file,null,2)], {type:'application/json'}));
        const a = document.createElement('a'); a.href=url; a.download='worthlookingup-preferences.json'; a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        status.textContent='Export downloaded. It includes your saved coordinates; keep it private.';
      } catch (error) { status.textContent='Export failed: '+error.message; }
    };
    document.getElementById('preferences-import').onchange = async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 65536) throw Error('Export exceeds 64 KB.');
        const input = JSON.parse(await file.text()); validate(input);
        apply(input,localStorage);
        status.textContent='Preferences imported. Reloading…'; location.reload();
      } catch (error) { status.textContent='Import failed: '+error.message; }
      event.target.value='';
    };
  });
})(typeof window === 'object' ? window : globalThis);
