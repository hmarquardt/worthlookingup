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
fs.copyFileSync(path.join(root,'src/launches/launch-feed.mjs'),path.join(out,'src/launches/launch-feed.mjs'));
// The Phase 5B geometry module is staged for the same reason: overhead-launch-explorer.js imports it by
// its repository-relative path, so the browser must be able to fetch it from the deployment as an ES
// module. It is the same file the research fixtures and the profile generator import, never a copy.
fs.copyFileSync(path.join(root,'src/launches/launch-trajectory.mjs'),path.join(out,'src/launches/launch-trajectory.mjs'));
for(const dir of ['assets','vendor','data','docs'])fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
console.log('Static application staged in dist.');
