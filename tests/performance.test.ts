import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../server/engine.js';
import {loadLocalCorpus,canSkipRewrite} from '../server/retrieval.js';
import {planQuestion} from '../server/planner.js';
import {structuredAnswer} from '../server/facts.js';
import type {SearchHit} from '../server/types.js';

const question='List the rating choices in the Education Agent Performance Review Form.';
const source:SearchHit={id:'form-1',document_id:'form',chunk_index:0,content_hash:'hash',token_count:30,
  title:'Education Agent Performance Review Form',section:'Rating choices',content:'Rating choices: Excellent, Good.',
  source_url:'https://austra.edu.au/form.pdf',category:'form',course_code:null,page_start:1,page_end:1,metadata:{},score:1};
function fixture(generate:()=>Promise<string>){
  const counts={rerank:0,answer:0,embedding:0,vector:0};
  const engine=createEngine({corpus:[source],mode:'cloud',model:'mock',endpoint:'mock',embeddingModel:'mock',
    chat:{complete:async(messages)=>{
      if(messages[0].content.includes('relevance reranker')){counts.rerank++;return '{"ranked_indices":[0]}';}
      counts.answer++;return generate();
    }},embed:async()=>{counts.embedding++;return [1];},semantic:async()=>{counts.vector++;return [source];}});
  return {engine,counts};
}

test('Exact grounded answer repeats avoid all model calls and retain source provenance; all history isolates generation',async()=>{
  const {engine,counts}=fixture(async()=> 'The choices are Excellent and Good. [1]');
  const first=await engine(question);
  const tokens:string[]=[];
  const repeat=await engine(question,[],t=>tokens.push(t));
  assert.equal(repeat.retrieval_stats.answer_cache_hit,true);
  assert.equal(repeat.answer,first.answer);assert.deepEqual(repeat.sources,first.sources);
  assert.deepEqual(tokens,[first.answer]);assert.deepEqual(counts,{rerank:1,answer:1,embedding:1,vector:1});
  assert.equal(repeat.timings.answer_ms,0);
  const contextual=await engine(question,[{role:'user',content:'I am asking about a legacy template.'}]);
  assert.equal(contextual.retrieval_stats.answer_cache_hit,false);
  assert.equal(counts.answer,2,'Generation history cannot be dropped even for an explicit named form');
});

test('Uncertain answers and failed generations are never stored as completed answers',async()=>{
  for(const text of ['The provided source does not state the answer.',"I couldn't find the requested information.",'The date is not specified.']){
    const uncertain=fixture(async()=>text);
    await uncertain.engine(question);await uncertain.engine(question);
    assert.equal(uncertain.counts.answer,2);
  }
  let fails=true;
  const failed=fixture(async()=>{if(fails){fails=false;throw new Error('Truncated');}return 'Excellent and Good. [1]';});
  await assert.rejects(failed.engine(question),/Truncated/);
  const recovered=await failed.engine(question);
  assert.equal(recovered.retrieval_stats.answer_cache_hit,false);assert.equal(failed.counts.answer,2);
});

test('Cancelled generations cannot populate the completed answer cache',async()=>{
  const controller=new AbortController();let cancel=true;
  const {engine,counts}=fixture(async()=>{if(cancel){cancel=false;controller.abort();}return 'Excellent and Good. [1]';});
  await assert.rejects(engine(question,[],undefined,controller.signal),/abort/i);
  const next=await engine(question);
  assert.equal(next.retrieval_stats.answer_cache_hit,false);assert.equal(counts.answer,2);
});

test('Simple duration facts retain placement, holidays and both package variants without model calls',async()=>{
  const corpus=await loadLocalCorpus();
  const fail=async()=>{throw new Error('No API call expected');};
  const engine=createEngine({corpus,mode:'cloud',model:'mock',endpoint:'mock',embeddingModel:'mock',chat:{complete:fail},embed:fail,semantic:fail});
  const cookery=await engine('How long does SIT30821 take?');
  assert.equal(cookery.retrieval,'structured-duration');assert.match(cookery.answer,/52 weeks/);assert.match(cookery.answer,/192 hours/);
  const kitchen=await engine('What are the two duration options for SIT40521, and when does the 24-week option apply?');
  assert.match(kitchen.answer,/70 weeks/);assert.match(kitchen.answer,/24 weeks/);assert.match(kitchen.answer,/SIT30821 \+ SIT40521 package/);
  const followup=await engine('How long does that course take?',[{role:'user',content:'SIT30821 fees'}]);
  assert.match(followup.answer,/52 weeks/);
  for(const q of ['How long does the visa for SIT30821 last?','CPC30220 duration after RPL','CPC30220 duration in 2027','Compare duration of SIT30821 and CPC30620','What are the two duration options for SIT40521, and when does the 4-week option apply?']){
    assert.equal(structuredAnswer(planQuestion(q,[],corpus),q,[],corpus),null,q);
  }
});

test('Fast short-form instruction quotes the actual public source; ambiguous form requests retain the hybrid path',async()=>{
  const corpus=await loadLocalCorpus();
  const q='How often must current students complete the Change of Details Form?';
  const answer=structuredAnswer(planQuestion(q,[],corpus),q,[],corpus);
  assert.equal(answer?.kind,'form-instruction');assert.match(answer!.answer,/every 6 months or when a change occurs/);
  const unknown='How often must agents complete the Change of Details Form?';
  assert.equal(structuredAnswer(planQuestion(unknown,[],corpus),unknown,[],corpus),null);
  assert.equal(canSkipRewrite(question,[],null),true);
  assert.equal(canSkipRewrite('What are its rating choices?',[],null),false);
  assert.equal(canSkipRewrite('Học phí CPC30220 bao nhiêu?',[],'CPC30220'),false);
});

test('IELTS fast lookup preserves lower-score ELICOS conditions and offshore validity; personal eligibility stays hybrid',async()=>{
  const corpus=await loadLocalCorpus();const fail=async()=>{throw new Error('No API call expected');};
  const engine=createEngine({corpus,mode:'cloud',model:'mock',endpoint:'mock',embeddingModel:'mock',chat:{complete:fail},embed:fail,semantic:fail});
  const answer=await engine('What are the IELTS requirements for CPC30220?');
  assert.equal(answer.retrieval,'structured-english-requirements');
  for(const text of ['6.0','5.5','+15 weeks','5.0','+30 weeks','two years','offshore'])assert.ok(answer.answer.includes(text));
  assert.equal(answer.sources.length,2);
  for(const q of ['Can I enter CPC30220 with IELTS 5.0?','What are the IELTS requirements for CPC30220 in 2027?','Compare IELTS requirements for CPC30220 and BSB50420']){
    assert.equal(structuredAnswer(planQuestion(q,[],corpus),q,[],corpus),null,q);
  }
  const changed=corpus.map(c=>c.course_code==='CPC30220'?{...c,content:c.content.replace('+15 weeks','ask admissions')}:c);
  const q='What are the IELTS requirements for CPC30220?';
  assert.equal(structuredAnswer(planQuestion(q,[],changed),q,[],changed),null,'Unrecognized score conditions must use the full evidence pipeline');
});

test('Legacy status is preserved in streamed output and cached completion when the model omits it',async()=>{
  const legacy={...source,metadata:{review_flags:['legacy_2023_form_confirm_current_version_with_college']}};
  const text='The rating choices are Excellent and Good. [1]';let generated=0;
  const engine=createEngine({corpus:[legacy],mode:'cloud',model:'mock',endpoint:'mock',embeddingModel:'mock',
    chat:{complete:async()=>'{"ranked_indices":[0]}',stream:async(_messages,emit)=>{generated++;emit(text);return text;}},
    embed:async()=>[1],semantic:async()=>[legacy]});
  const tokens:string[]=[];const result=await engine(question,[],t=>tokens.push(t));
  assert.match(result.answer,/legacy blank form/);assert.equal(tokens.join(''),result.answer);
  const cached=await engine(question);assert.equal(cached.answer,result.answer);assert.equal(generated,1);
});

test('Signature field groups quote all labels and dates without inventing completed signatures',async()=>{
  const corpus=await loadLocalCorpus();const fail=async()=>{throw new Error('No API call expected');};
  const engine=createEngine({corpus,mode:'cloud',model:'mock',endpoint:'mock',embeddingModel:'mock',chat:{complete:fail},embed:fail,semantic:fail});
  const result=await engine('Which compiled-by and reviewed-by signature fields are in the Education Agent Performance Review Form?');
  assert.equal(result.retrieval,'structured-form-fields');
  assert.match(result.answer,/Compiled By.*Signature, Date/);assert.match(result.answer,/Reviewed By.*Signature, Date/);
  assert.match(result.answer,/legacy blank form/);assert.equal(result.sources[0].page_start,2);
  const q='What are the actual compiled-by signature fields of John in the Education Agent Performance Review Form?';
  assert.equal(structuredAnswer(planQuestion(q,[],corpus),q,[],corpus),null);
});
