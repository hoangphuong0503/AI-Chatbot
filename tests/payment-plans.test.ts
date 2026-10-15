import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalCorpus} from '../server/retrieval.js';
import {planQuestion} from '../server/planner.js';
import {BM25Index} from '../server/bm25.js';

test('Named courses retain the college payment options for plan, instalment and monthly questions',async()=>{
  const corpus=await loadLocalCorpus();const index=new BM25Index(corpus);
  for(const [question,course] of [
    ['Does SIT30821 offer a payment plan?','SIT30821'],
    ['Can I pay CPC30620 fees in instalments?','CPC30620'],
    ['Can I pay BSB50420 monthly?','BSB50420'],
  ]){
    const plan=planQuestion(question,[],corpus);
    assert.equal(plan.course,course);
    assert.equal(plan.courseFilter,null);
    const hits=index.search(plan.query,{courseCode:plan.courseFilter,categories:plan.categories,limit:30});
    assert.ok(hits.some(h=>h.category==='college'&&/weekly.*fortnightly.*monthly/is.test(h.content)),question);
  }
  assert.equal(planQuestion('How much does SIT30821 cost?',[],corpus).courseFilter,'SIT30821');
});
