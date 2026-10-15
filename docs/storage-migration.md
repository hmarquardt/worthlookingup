# Transfer from Overhead

Storage is origin-specific. Visiting worthlookingup.com cannot read your GitHub Pages settings.
No automatic transfer or deletion occurs. Caches should be downloaded afresh.

1. Open the original Overhead page in the browser/profile that holds your preferences.
2. To export without changing the original application, open browser developer tools and run the
   following inspected, self-contained snippet. It reads only five documented Overhead keys and
   downloads a local JSON file; it sends no network request and deletes nothing.
3. On Worth Looking Up, open Settings → Move your saved places & preferences → Import preferences.
   Import replaces only the included preferences on this device after validation. Export existing
   new-domain preferences first if you wish to preserve them. Imported state is applied on reload.

```js
(() => {
  const values = {};
  for (const key of ['site','sites','settings','favorites','theme']) {
    const raw = localStorage.getItem('overhead.' + key);
    if (raw !== null) values[key] = key === 'theme' ? raw : JSON.parse(raw);
  }
  const url = URL.createObjectURL(new Blob([
    JSON.stringify({schema:'worthlookingup.preferences/1',values},null,2)
  ], {type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download='overhead-preferences.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
})();
```

The UI also exports new-domain preferences in this format. Validation checks coordinates, timezone,
counts and setting values, limits files to 64 KB, ignores no unexpected top-level preference keys,
and rolls back writes on failure. Tracker identifiers, other Junk Drawer apps, API credentials and
IndexedDB records are never exported. The original page remains unchanged. A polished original-site
export UI can be considered separately; this migration deliberately preserves that deployment.
