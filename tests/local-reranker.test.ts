import test from 'node:test';
import assert from 'node:assert/strict';
import {createReranker,selectLocalHits,localRelevanceQuery,rerankerPython} from '../server/reranker.js';
import {createEngine} from '../server/engine.js';
import {loadLocalCorpus} from '../server/retrieval.js';
import type {SearchHit} from '../server/types.js';
import {createHealthMonitor} from '../server/health.js';
import {resolve} from 'node:path';

test('Python selection supports Mac/Linux venvs, Windows venvs and explicit overrides',()=>{
  assert.equal(rerankerPython({},'darwin',p=>p===resolve('.venv/bin/python')),resolve('.venv/bin/python'));
  assert.equal(rerankerPython({},'win32',p=>p===resolve('.venv/Scripts/python.exe')),resolve('.venv/Scripts/python.exe'));
  assert.equal(rerankerPython({},'darwin',()=>false),'python3');
  assert.equal(rerankerPython({},'linux',()=>false),'python3');
  assert.equal(rerankerPython({},'win32',()=>false),'python');
  assert.equal(rerankerPython({RERANKER_PYTHON:'/a folder/python'},'darwin',()=>false),'/a folder/python');
  assert.equal(rerankerPython({RERANKER_PYTHON:' '},'darwin',()=>false),'python3');
});

test('Cross-encoder validates scores, preserves provenance and rejects irrelevant candidates',()=>{
  const hits=[{id:'a',metadata:{original:'kept'}},{id:'b',metadata:{}},{id:'c',metadata:{}}] as SearchHit[];
  const ranked=selectLocalHits(hits,[-4,3,1],8,0);
  assert.deepEqual(ranked.map(h=>h.id),['b','c']);
  assert.equal(ranked[0].metadata.rerank_score,3);
  assert.equal(ranked[1].metadata.rerank_position,2);
  assert.equal(selectLocalHits(hits,[2,1,-1],1,0).length,1);
  assert.deepEqual(selectLocalHits(hits,[-1,-5,-9],8,0),[]);
  assert.equal(selectLocalHits(hits,[1,2,3],8,0)[2].metadata.original,'kept');
  assert.throws(()=>selectLocalHits(hits,[1],8,0));
  assert.throws(()=>selectLocalHits(hits,[NaN,2,3],8,0));
});

test('Reranker configuration rejects invalid providers and thresholds',()=>{
  const chat={complete:async()=>'{"ranked_indices":[]}'};
  assert.throws(()=>createReranker(chat,{RERANKER_PROVIDER:'invalid'}));
  assert.throws(()=>createReranker(chat,{RERANKER_PROVIDER:'local',LOCAL_RERANKER_MIN_SCORE:'NaN'}));
});

test('Local query adapter removes unknown slot labels and keeps resolved follow-up context',()=>{
  assert.equal(localRelevanceQuery('What is the refund policy?\nResolved course: unspecified\nRequested state: unspecified'),'What is the refund policy?');
  assert.equal(localRelevanceQuery('What about that course?\nResolved course: SIT30821\nRequested state: SA'),'What about that course? SIT30821 SA');
  assert.equal(localRelevanceQuery('SIT30821 entry requirements\nResolved course: SIT30821\nRequested state: unspecified'),'SIT30821 entry requirements');
});

test('First local model warmup has its own deadline without extending cloud probe deadlines',async()=>{
  const health=await createHealthMonitor({reranker:async()=>{await new Promise(r=>setTimeout(r,10));},
    cloud:async()=>new Promise(()=>{})},1,1,()=>Date.now(),{reranker:100})();
  assert.equal(health.services.reranker.ok,true);assert.equal(health.services.cloud.ok,false);
});

test('A local reranker outage fails the request without silently using a cloud reranker',async()=>{
  const corpus=await loadLocalCorpus();let chatCalls=0;
  const engine=createEngine({corpus,mode:'cloud',model:'test',embeddingModel:'test',endpoint:'test',
    chat:{complete:async()=>{chatCalls++;throw new Error('Unexpected chat call');}},embed:async()=>[1],semantic:async()=>[],
    reranker:{id:'local',rank:async()=>{throw new Error('Local reranker unavailable');}}});
  await assert.rejects(engine('Does SIT30821 offer a payment plan?'),/Local reranker unavailable/);
  assert.equal(chatCalls,0);
});
