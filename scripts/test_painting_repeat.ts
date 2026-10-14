import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const question='How much does Certificate III Painting cost?';
const results:any[]=[];
for(let i=0;i<3;i++){
  const history=i===2?[{role:'user',content:question},{role:'assistant',content:results[0].answer}]:[];
  const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question,history}),signal:AbortSignal.timeout(180000)});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  assert.match(result.retrieval_query,/CPC30620/);
  assert.match(result.answer,/20[,.]?500/);
  assert.match(result.answer,/22[,.]?500/);
  assert.ok(result.sources.some((s:any)=>s.url.includes('cpc30620')));
  results.push(result);
  console.log(`Painting repeat ${i+1}/3 passed (${history.length?'with history':'new chat'}).`);
}
await mkdir('data/test-results',{recursive:true});
await writeFile('data/test-results/painting-repeat.json',JSON.stringify({tested_at:new Date().toISOString(),passed:true,results},null,2));
