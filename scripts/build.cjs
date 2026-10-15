// Only public application assets enter the deployment. Never upload the repository root.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist');
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(out))fs.rmSync(path.join(out,name),{recursive:true,force:true});
const files=['index.html','analytics-lite.js','preferences-transfer.js','_headers','_redirects','404.html'];
files.push(...fs.readdirSync(root).filter(f=>/^overhead-[\w-]+\.js$/.test(f)));
for(const file of files)fs.copyFileSync(path.join(root,file),path.join(out,file));
fs.copyFileSync(path.join(root,'scripts/pages-worker.mjs'),path.join(out,'_worker.js'));
for(const dir of ['assets','vendor','data','docs'])fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
console.log('Static application staged in dist.');
