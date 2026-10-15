import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLocalCorpus} from '../server/retrieval.js';
import {planQuestion} from '../server/planner.js';
import {structuredAnswer} from '../server/facts.js';
import {BM25Index} from '../server/bm25.js';
import {evaluationCases} from './evaluation-cases.js';
const corpus=await loadLocalCorpus();
for(const c of evaluationCases)test(`Evaluation: ${c.name}`,()=>{
  const plan=planQuestion(c.question,c.history||[],corpus);
  assert.equal(plan.intent,c.intent);
  if(c.course!==undefined)assert.equal(plan.course,c.course);
  if(c.state!==undefined)assert.equal(plan.state,c.state);
  const facts=structuredAnswer(plan,c.question,c.history||[],corpus);
  if(c.structured){assert.ok(facts);for(const text of c.contains||[])assert.ok(facts.answer.toLowerCase().includes(text.toLowerCase()),facts.answer);for(const text of c.excludes||[])assert.ok(!facts.answer.includes(text),facts.answer);}
  if(c.intent==='policy'){
    assert.equal(plan.courseFilter,null,'College-wide policy must not inherit a course filter');
    assert.ok(new BM25Index(corpus).search(plan.query,{categories:plan.categories,courseCode:plan.courseFilter}).some(h=>h.category==='policy'),'Policy evidence must survive filtering');
  }
  if(c.name==='payment plan uses evidence'){
    assert.equal(plan.courseFilter,null,'College-wide payment evidence must survive an explicit course code');
    const hits=new BM25Index(corpus).search(plan.query,{categories:plan.categories,courseCode:plan.courseFilter,limit:30});
    assert.ok(hits.some(h=>h.category==='college'&&/weekly.*fortnightly.*monthly/is.test(h.content)), 'Retrieve the college payment options');
  }
});
