import test from 'node:test';
import assert from 'node:assert/strict';
import {createHealthMonitor} from '../server/health.js';
import {readChatStream} from '../src/chat-stream.js';
import {createEngine} from '../server/engine.js';
import {loadLocalCorpus} from '../server/retrieval.js';
import {planQuestion} from '../server/planner.js';
import {structuredAnswer} from '../server/facts.js';
test('Health status detects outage, deduplicates parallel probes and recovers',async()=>{
  let calls=0;let fail=true;let now=0;
  const monitor=createHealthMonitor({embeddings:async()=>{calls++;if(fail)throw new Error('Unavailable');}},60000,100,()=>now);
  const [a,b]=await Promise.all([monitor(),monitor()]);assert.equal(a.ready,false);assert.deepEqual(a,b);assert.equal(calls,1);
  fail=false;now=5001;assert.equal((await monitor()).ready,true);assert.equal(calls,2);
});
test('Hanging service probes terminate and do not report ready',async()=>{
  const health=await createHealthMonitor({deepseek:async()=>new Promise(()=>{})},1,5)();
  assert.equal(health.ready,false);assert.equal(health.services.deepseek.ok,false);
});
test('Stream parser handles split UTF-8, multiple frames and missing completion',async()=>{
  const bytes=new TextEncoder().encode('{"type":"token","text":"café"}\n{"type":"done","answer":"café"}\n');
  const events:unknown[]=[];
  const response=new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}));
  await readChatStream(response,e=>events.push(e));assert.equal(events.length,2);
  await assert.rejects(readChatStream(new Response('{"type":"token","text":"partial"}\n'),()=>{}),/before the answer was complete/);
  await assert.rejects(readChatStream(new Response('{"type":"error","message":"Service failed"}\n'),()=>{}),/Service failed/);
});
test('Structured fees and stateful intakes use real corpus without any model calls',async()=>{
  const corpus=await loadLocalCorpus();let calls=0;
  const forbidden=async()=>{calls++;throw new Error('No model call should be needed');};
  const engine=createEngine({corpus,mode:'cloud',model:'mock',endpoint:'mock',embeddingModel:'mock',chat:{complete:forbidden},embed:forbidden,semantic:forbidden});
  const fees=await engine('SIT30821 tuition fees');assert.match(fees.answer,/17,500/);
  const sa=await engine('November intakes for MSF30422',[{role:'user',content:'I want to study in SA'}]);
  const vic=await engine('November intakes for MSF30422',[{role:'user',content:'I want to study in VIC'}]);
  assert.match(sa.answer,/16 November/);assert.match(vic.answer,/2 November/);assert.notEqual(sa.answer,vic.answer);assert.equal(calls,0);
});
test('A new unrelated price question must not inherit an earlier course fee',async()=>{
  const corpus=await loadLocalCorpus();
  const history=[{role:'user' as const,content:'How much does SIT30821 cost?'}];
  const plan=planQuestion('What is the Bitcoin price?',history,corpus);
  assert.equal(plan.course,null);assert.equal(structuredAnswer(plan,'What is the Bitcoin price?',history,corpus),null);
});
test('Inconsistent fee totals are not presented as validated structured amounts',async()=>{
  const corpus=await loadLocalCorpus();
  const altered=corpus.map(c=>c.course_code==='SIT30821'?{...c,content:c.content.replace('$17,500','$99,000')}:c);
  const plan=planQuestion('SIT30821 fees',[],altered);
  assert.equal(structuredAnswer(plan,'SIT30821 fees',[],altered),null);
});
test('Multiple requested months cannot silently collapse into the first month',async()=>{
  const corpus=await loadLocalCorpus();const question='November and December intake dates for MSF30422 in SA';
  const result=structuredAnswer(planQuestion(question,[],corpus),question,[],corpus);
  assert.equal(result?.kind,'clarification');assert.match(result!.answer,/one month/);
});
test('A nonexistent intake stream does not borrow dates from another duration',async()=>{
  const corpus=await loadLocalCorpus();const question='November intake dates for SIT40521 12 weeks in SA';
  const result=structuredAnswer(planQuestion(question,[],corpus),question,[],corpus);
  assert.match(result!.answer,/could not find a 12-week/);
});
test('A course code cannot reclassify another subject price as tuition',async()=>{
  const corpus=await loadLocalCorpus();const question='What is Bitcoin price for SIT30821?';
  assert.equal(structuredAnswer(planQuestion(question,[],corpus),question,[],corpus),null);
});
