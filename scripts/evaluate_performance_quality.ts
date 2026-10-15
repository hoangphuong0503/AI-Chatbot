import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {evaluationCases} from '../tests/evaluation-cases.js';
import {updatedDataCases} from '../tests/updated-data-cases.js';

const cases=[
  ...evaluationCases.map(c=>({...c,group:c.intent})),
  ...updatedDataCases,
  {name:'carpentry instalments',group:'payments',question:'Can I pay CPC30620 fees in instalments?',all:[/weekly/i,/fortnightly/i,/monthly/i]},
  {name:'leadership monthly',group:'payments',question:'Can I pay BSB50420 monthly?',all:[/monthly/i]},
];
const health=await(await fetch('http://127.0.0.1:3001/api/health')).json();
assert.equal(health.ready,true,JSON.stringify(health));
const prior=process.argv.includes('--retry-failed')?JSON.parse(await readFile('data/test-results/performance_quality_after.json','utf8')):null;
const results:any[]=prior?cases.map(c=>prior.results.find((r:any)=>r.name===c.name)):[];
let writeQueue=Promise.resolve();
const jobs=new Set<Promise<void>>();
let previous=0;
async function run(c:typeof cases[number],index:number){
  const started=Date.now();let result:any;
  try{
    const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:c.question,history:'history' in c?c.history||[]:[]}),signal:AbortSignal.timeout(180000)});
    result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    if('contains' in c)for(const text of c.contains||[])assert.ok(result.answer.toLowerCase().includes(text.toLowerCase()),`Missing ${text}`);
    if('excludes' in c)for(const text of c.excludes||[])assert.ok(!result.answer.includes(text),`Unexpected ${text}`);
    if('all' in c)for(const pattern of c.all)assert.match(result.answer,pattern);
    if('none' in c)for(const pattern of c.none||[])assert.doesNotMatch(result.answer,pattern);
    if('source' in c&&c.source)assert.ok(result.sources.some((s:{url:string})=>c.source!.test(s.url)),'Expected source missing');
    if('structured' in c&&c.structured)assert.match(result.retrieval,/^structured-/);
    if('intent' in c&&c.intent==='policy')assert.ok(result.sources.some((s:{url:string})=>/policy|handbook|policies/i.test(s.url)),'Missing policy source');
    if(c.name==='unknown subject'||c.name==='unrelated price')assert.equal(result.sources.length,0);
    results[index]={name:c.name,group:c.group,question:c.question,passed:true,duration_ms:Date.now()-started,...result};
  }catch(error){results[index]={name:c.name,group:c.group,question:c.question,passed:false,duration_ms:Date.now()-started,
    error:error instanceof Error?error.message:'Failed',result};}
  if(prior){results[index].initial_attempt=prior.results.find((r:any)=>r.name===c.name);results[index].retested_at=new Date().toISOString();}
  console.log(`${results[index].passed?'PASS':'FAIL'} ${index+1}/${cases.length} ${c.name}`);
  writeQueue=writeQueue.then(async()=>{
    await mkdir('data/test-results',{recursive:true});
    const completed=results.filter(Boolean);
    await writeFile('data/test-results/performance_quality_after.json',JSON.stringify({tested_at:new Date().toISOString(),
      health,completed:completed.length,total:cases.length,passed:completed.every(r=>r.passed),results:completed},null,2));
  });
  await writeQueue;
}
for(const [i,c] of cases.entries()){
  if(prior&&results[i]?.passed)continue;
  // A shared launch interval keeps the entire suite below 15 requests/minute;
  // only two requests can be active, limiting load on the free model endpoint.
  if(jobs.size>=2)await Promise.race(jobs);
  const pause=Math.max(0,4500-(Date.now()-previous));if(pause)await new Promise(r=>setTimeout(r,pause));
  previous=Date.now();const job=run(c,i);jobs.add(job);void job.finally(()=>jobs.delete(job));
}
await Promise.all(jobs);await writeQueue;
const failed=results.filter(r=>!r.passed);
console.log(JSON.stringify({passed:results.length-failed.length,total:results.length,failures:failed.map(r=>({name:r.name,error:r.error}))}));
if(failed.length)process.exitCode=1;
