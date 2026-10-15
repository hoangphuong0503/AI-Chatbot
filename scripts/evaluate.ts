import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {evaluationCases} from '../tests/evaluation-cases.js';
const base='http://127.0.0.1:3001';
const health=await(await fetch(base+'/api/health')).json();
assert.equal(health.ready,true,JSON.stringify(health));
const results:Record<string,unknown>[]=[];
const reuseStructured=process.argv.includes('--reuse-structured');
const previousReport=reuseStructured?JSON.parse(await readFile('data/test-results/evaluation.json','utf8')):null;
let previous=0;
for(const c of evaluationCases){
  const prior=previousReport?.results.find((r:any)=>r.name===c.name&&r.passed);
  if(reuseStructured&&c.structured&&prior){results.push({...prior,reused_from:previousReport.tested_at});continue;}
  // Avoid the local 15/minute limiter and bursts at the shared model endpoint.
  const wait=Math.max(0,4300-(Date.now()-previous));if(wait)await new Promise(r=>setTimeout(r,wait));
  previous=Date.now();
  const started=Date.now();
  let result:any;
  try{
    const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:c.question,history:c.history||[]}),signal:AbortSignal.timeout(180000)});
    result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    for(const text of c.contains||[])assert.ok(result.answer.toLowerCase().includes(text.toLowerCase()),`Missing ${text}`);
    for(const text of c.excludes||[])assert.ok(!result.answer.includes(text),`Unexpected ${text}`);
    if(c.structured)assert.match(result.retrieval,/^structured-/);
    if(c.intent==='policy')assert.ok(result.sources.some((s:{url:string})=>/policy|handbook|policies/i.test(s.url)),'Missing policy source');
    if(c.name==='unknown subject'||c.name==='unrelated price')assert.equal(result.sources.length,0,'Unsupported topic must abstain');
    results.push({name:c.name,passed:true,total_ms:Date.now()-started,...result});
    console.log(`PASS ${results.length}/${evaluationCases.length} ${c.name} (${Date.now()-started} ms)`);
  }catch(error){
    results.push({name:c.name,passed:false,total_ms:Date.now()-started,error:error instanceof Error?error.message:'Failed',result});
    console.log(`FAIL ${results.length}/${evaluationCases.length} ${c.name}`);
  }
  await mkdir('data/test-results',{recursive:true});
  await writeFile('data/test-results/evaluation.json',JSON.stringify({tested_at:new Date().toISOString(),health,
    passed:results.every(r=>r.passed),completed:results.length,total:evaluationCases.length,results},null,2));
}
const failed=results.filter(r=>!r.passed);
console.log(JSON.stringify({passed:results.length-failed.length,total:results.length,failures:failed.map(r=>({name:r.name,error:r.error}))},null,2));
if(failed.length)process.exitCode=1;
