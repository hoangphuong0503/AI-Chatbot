import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const questions=['Does SIT30821 offer a payment plan?','Can I pay CPC30620 fees in instalments?','Can I pay BSB50420 monthly?'];
const results=[];
for(const question of questions){
  const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question}),signal:AbortSignal.timeout(180000)});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.match(result.answer,/monthly/i);
  if(!question.includes('BSB50420')){assert.match(result.answer,/weekly/i);assert.match(result.answer,/fortnightly/i);}
  assert.ok(result.excerpts.some((text:string)=>/weekly.*fortnightly.*monthly/is.test(text)),'Must retrieve the actual college instalment options');
  results.push({question,passed:true,duration_ms:result.timings.total_ms,...result});
  await writeFile('data/test-results/payment_plans_retest.json',JSON.stringify({tested_at:new Date().toISOString(),results},null,2));
  console.log(`PASS payment plan: ${question}`);
}
const path='data/test-results/evaluation.json';
const report=JSON.parse(await readFile(path,'utf8'));
const index=report.results.findIndex((r:any)=>r.name==='payment plan uses evidence');
assert.ok(index>=0);
const before=report.results[index];
report.results[index]={...before,...results[0],total_ms:results[0].timings.total_ms,
  manual_review:'Initial run abstained despite college-wide payment evidence; fixed course filter and retested.',
  initial_attempt:before, retested_at:new Date().toISOString()};
await writeFile(path,JSON.stringify(report,null,2));
