import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {readChatStream,type ChatEvent} from '../src/chat-stream.js';
const health=await(await fetch('http://127.0.0.1:3001/api/health')).json();
assert.equal(health.ready,true);assert.match(health.reranker,/^local-reranker:/);
const results=[];
for(const repeat of [false,true]){
  const start=performance.now();let first=0,tokens=0;let result:ChatEvent|undefined;
  const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question:'Does SIT30821 offer a payment plan?',stream:true}),signal:AbortSignal.timeout(120000)});
  assert.equal(response.status,200);
  await readChatStream(response,event=>{
    if(event.type==='token'){tokens++;if(!first)first=Math.round(performance.now()-start);}
    if(event.type==='done')result=event;
  });
  assert.ok(result);assert.match(result.answer||'',/weekly/i);assert.match(result.answer||'',/fortnightly/i);assert.match(result.answer||'',/monthly/i);
  assert.match(String(result.retrieval),/local-reranker:/);
  assert.equal((result as any).retrieval_stats.answer_cache_hit,repeat);
  results.push({repeat,first_token_ms:first,total_ms:Math.round(performance.now()-start),tokens,result});
}
await writeFile('data/test-results/reranker_runtime.json',JSON.stringify({passed:true,health,results},null,2));
console.log(JSON.stringify({passed:true,results:results.map(r=>({repeat:r.repeat,total_ms:r.total_ms,first_token_ms:r.first_token_ms,tokens:r.tokens}))}));
