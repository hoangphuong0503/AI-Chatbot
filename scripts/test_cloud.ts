import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const base='http://127.0.0.1:3001';
const health=await (await fetch(base+'/api/health')).json();
assert.equal(health.mode,'cloud');
assert.equal(health.chat_model,'deepseek-v4-flash-0731');
const results:Record<string,unknown>[]=[];
async function ask(name:string,question:string,history:{role:string;content:string}[]=[]){
  const start=Date.now();
  const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question,history}),signal:AbortSignal.timeout(180_000)});
  const result=await response.json();
  assert.equal(response.status,200,JSON.stringify(result));
  if(!result.retrieval.startsWith('structured-'))assert.ok(result.retrieval_stats.vector_candidates>0,'Hybrid vector candidates must be present');
  results.push({name,question,duration_ms:Date.now()-start,...result});
  return result;
}
try{
  const firstQuestion='How much does SIT30821 cost? Distinguish tuition fees from the total fee.';
  const fees=await ask('cookery_fees',firstQuestion);
  assert.match(fees.answer,/15[,. ]?500/);assert.match(fees.answer,/17[,. ]?500/);
  assert.match(fees.answer,/\[\d+\]/);
  assert.ok(fees.sources.some((s:{url:string})=>s.url.includes('sit30821')));
  assert.equal(fees.retrieval,'structured-fees');
  const followup=await ask('followup_duration','How long does that course take?',[
    {role:'user',content:firstQuestion},{role:'assistant',content:fees.answer}]);
  assert.match(followup.answer,/52\s*weeks/i);
  const english=await ask('carpentry_english_requirements','What are the IELTS requirements for CPC30220?');
  assert.match(english.answer,/IELTS/i);assert.match(english.answer,/\[\d+\]/);
  const unknown=await ask('unrelated_topic','What is the Bitcoin price right now?');
  assert.equal(unknown.sources.length,0,'Unrelated topics should not receive unsupported answers');
  await mkdir('data/test-results',{recursive:true});
  await writeFile('data/test-results/cloud.json',JSON.stringify({tested_at:new Date().toISOString(),health,passed:true,results},null,2));
  console.log(JSON.stringify({passed:true,tests:results.map(r=>({name:r.name,duration_ms:r.duration_ms,
    answer:r.answer,retrieval_stats:r.retrieval_stats}))},null,2));
}catch(error){
  await mkdir('data/test-results',{recursive:true});
  await writeFile('data/test-results/cloud.json',JSON.stringify({tested_at:new Date().toISOString(),health,passed:false,
    error:error instanceof Error?error.message:'Test failed',results},null,2));
  console.error(error instanceof Error?error.message:'Test failed');process.exitCode=1;
}
