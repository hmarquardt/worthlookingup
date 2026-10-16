// Only public application assets enter the deployment. Never upload the repository root.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(out))fs.rmSync(path.join(out,name),{recursive:true,force:true});
const files=['index.html','analytics-lite.js','preferences-transfer.js','_headers','_redirects','404.html'];
files.push(...fs.readdirSync(root).filter(f=>/^overhead-[\w-]+\.js$/.test(f)));
for(const file of files)fs.copyFileSync(path.join(root,file),path.join(out,file));
// The Pages Worker is staged from the repository root, and the launch engine it imports is staged at
// the same relative path so ./src/launches/launch-feed.mjs resolves inside the deployment as well as
// in the checkout. Wrangler bundles the import into dist/_worker.js during deploy.
fs.copyFileSync(path.join(root,'pages-worker.mjs'),path.join(out,'_worker.js'));
fs.mkdirSync(path.join(out,'src/launches'),{recursive:true});
// The Phase 5B/5C geometry modules are staged for the same reason: overhead-launch-explorer.js imports
// them by their repository-relative paths, so the browser must be able to fetch them from the deployment
// as ES modules. The geodesy module is the small one the launch calendar loads; the trajectory module
// carries the evidence gates and is loaded only when the historical panel is opened; the pad-index
// module validates the compact index. They are the same files the research fixtures and the profile
// generator import, never copies.
for (const module of ['launch-feed.mjs', 'launch-geodesy.mjs', 'launch-pad-index.mjs', 'launch-trajectory.mjs']) {
  fs.copyFileSync(path.join(root, 'src/launches', module), path.join(out, 'src/launches', module));
}
for(const dir of ['assets','vendor','data','docs'])fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
console.log('Static application staged in dist.');
