const {readdirSync}=require('node:fs');
const {spawnSync}=require('node:child_process');
for(const file of readdirSync('tests').filter(f=>f.endsWith('.cjs')).sort()){
  const result=spawnSync(process.execPath,['tests/'+file],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
