import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const results:any[]=[];
async function ask(question:string,history:{role:string;content:string}[]=[]){
  const start=performance.now();
  const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question,history}),signal:AbortSignal.timeout(180000)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
  results.push({...result,total_ms:Math.round(performance.now()-start)});
  console.log(JSON.stringify({question,...result.retrieval_stats,total_ms:results.at(-1).total_ms}));
  return result;
}
const question='How much does Certificate III Painting cost?';
const first=await ask(question);
assert.equal(first.retrieval_stats.cache_hit,false);assert.equal(first.retrieval_stats.rewrite_skipped,true);
const repeat=await ask(question,[{role:'user',content:question},{role:'assistant',content:first.answer}]);
assert.equal(repeat.retrieval_stats.cache_hit,true);
assert.deepEqual(repeat.sources,first.sources);
assert.match(repeat.answer,/22[,.]?500/);
const followup=await ask('How long does that course take?',[
  {role:'user',content:question},{role:'assistant',content:first.answer}]);
assert.equal(followup.retrieval_stats.cache_hit,false);assert.equal(followup.retrieval_stats.rewrite_skipped,false);
assert.ok(followup.sources.some((s:any)=>s.url.includes('cpc30620')));
await mkdir('data/test-results',{recursive:true});
await writeFile('data/test-results/retrieval-cache.json',JSON.stringify({tested_at:new Date().toISOString(),passed:true,results},null,2));
