import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

import {updatedDataCases as cases} from '../tests/updated-data-cases.js';

const retry=process.argv.includes('--retry-failed');
const prior=retry?JSON.parse(await readFile('data/test-results/updated_data_evaluation.json','utf8')):null;
const results:any[]=prior?prior.results.filter((r:any)=>r.passed):[];
const health=await(await fetch('http://127.0.0.1:3001/api/health')).json();
assert.equal(health.ready,true,JSON.stringify(health));
let previous=0;
for(const c of cases){
  if(retry&&results.some(r=>r.name===c.name))continue;
  const pause=Math.max(0,4500-(Date.now()-previous));
  if(pause)await new Promise(r=>setTimeout(r,pause));
  previous=Date.now();
  const start=Date.now();let result:any;
  try{
    const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:c.question}),signal:AbortSignal.timeout(180000)});
    result=await response.json();assert.equal(response.status,200);
    for(const pattern of c.all)assert.match(result.answer,pattern);
    for(const pattern of c.none||[])assert.doesNotMatch(result.answer,pattern);
    if(c.source)assert.ok(result.sources.some((s:{url:string})=>c.source!.test(s.url)),'Expected source missing');
    results.push({name:c.name,group:c.group,question:c.question,passed:true,duration_ms:Date.now()-start,...result});
  }catch(error){results.push({name:c.name,group:c.group,question:c.question,passed:false,duration_ms:Date.now()-start,
    error:error instanceof Error?error.message:'Failed',result});}
  if(retry){results.at(-1).initial_attempt=prior.results.find((r:any)=>r.name===c.name);results.at(-1).retested_at=new Date().toISOString();}
  console.log(`${results.at(-1).passed?'PASS':'FAIL'} ${results.length}/${cases.length} ${c.name}`);
  await mkdir('data/test-results',{recursive:true});
  await writeFile('data/test-results/updated_data_evaluation.json',JSON.stringify({tested_at:new Date().toISOString(),
    health,completed:results.length,total:cases.length,passed:results.every(r=>r.passed),results},null,2));
}
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:cases.length,failures:results.filter(r=>!r.passed).map(r=>r.name)}));
if(results.some(r=>!r.passed))process.exitCode=1;
