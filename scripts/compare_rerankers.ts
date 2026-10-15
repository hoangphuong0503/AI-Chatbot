import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {evaluationCases} from '../tests/evaluation-cases.js';
import {updatedDataCases} from '../tests/updated-data-cases.js';
import {loadLocalCorpus} from '../server/retrieval.js';
import {createEngine} from '../server/engine.js';
import {createChat} from '../server/chat.js';
import {createReranker} from '../server/reranker.js';
import {createEmbedder} from '../server/embeddings.js';
import {EMBEDDING_MODEL,requireChatConfig,requireCloudConfig} from '../server/config.js';
import type {SearchHit} from '../server/types.js';

const phase=process.argv.includes('--local')?'local':'llm';
const corpus=await loadLocalCorpus();
const chatConfig=requireChatConfig(),cloud=requireCloudConfig();
const chat=createChat(chatConfig),embedding=createEmbedder(cloud.embeddingApiKey);
const db=createClient(cloud.url,cloud.secret,{auth:{persistSession:false,autoRefreshToken:false}});
const ranker=createReranker(chat,{...process.env,RERANKER_PROVIDER:phase});
const cases=[...evaluationCases,...updatedDataCases,
  {name:'painting instalments',question:'Can I pay CPC30620 fees in instalments?',all:[/weekly/i,/fortnightly/i,/monthly/i]},
  {name:'leadership monthly',question:'Can I pay BSB50420 monthly?',all:[/monthly/i]},
];
const results:any[]=[];
const started_at=new Date().toISOString();
let warmup_ms=0;
try{
  const start=performance.now();await ranker.check();warmup_ms=Math.round(performance.now()-start);
  // Both embeddings and reranker resident; startup is reported separately.
  await embedding.embed(['Austra course information'],'query');
  for(const c of cases){
    let candidates:SearchHit[]=[],rerankQuestion='';let first=0;const started=performance.now();let result:any;
    const engine=createEngine({corpus,mode:'cloud',model:chatConfig.model,endpoint:chatConfig.baseURL,embeddingModel:EMBEDDING_MODEL,chat,
      reranker:{id:ranker.id,rank:async(q,h,limit,signal)=>{candidates=h;rerankQuestion=q;return ranker.rank(q,h,limit,signal);}},
      embed:async q=>(await embedding.embed([q],'query'))[0],semantic:async(vector,course,categories,count)=>{
        const response=await db.rpc('semantic_search',{p_embedding:vector,p_course_code:course,p_categories:categories,p_match_count:count,p_embedding_model:EMBEDDING_MODEL});
        if(response.error)throw new Error('Supabase vector search failed');return response.data as SearchHit[];
      }});
    let error='';
    try{
      result=await engine(c.question,'history' in c?c.history||[]:[],()=>{if(!first)first=performance.now()-started;},AbortSignal.timeout(180000));
      if('contains' in c)for(const text of c.contains||[])assert.ok(result.answer.toLowerCase().includes(text.toLowerCase()),`Missing ${text}`);
      if('excludes' in c)for(const text of c.excludes||[])assert.ok(!result.answer.includes(text),`Unexpected ${text}`);
      if('all' in c)for(const re of c.all)assert.match(result.answer,re);
      if('none' in c)for(const re of c.none||[])assert.doesNotMatch(result.answer,re);
      if('source' in c&&c.source)assert.ok(result.sources.some((s:{url:string})=>c.source!.test(s.url)),'Expected source missing');
      if('structured' in c&&c.structured)assert.match(result.retrieval,/^structured-/);
      if('intent' in c&&c.intent==='policy')assert.ok(result.sources.some((s:{url:string})=>/policy|handbook|policies/i.test(s.url)),'Missing policy source');
      if(c.name==='unknown subject'||c.name==='unrelated price')assert.equal(result.sources.length,0,'Unsupported topic must abstain');
    }catch(e){error=e instanceof Error?e.message:'Failed';}
    results.push({name:c.name,question:c.question,history:'history' in c?c.history||[]:[],passed:!error,error,
      duration_ms:Math.round(performance.now()-started),first_token_ms:Math.round(first),...result,
      rerank_question:rerankQuestion,candidate_ids:candidates.map(h=>h.id),candidates});
    console.log(`${error?'FAIL':'PASS'} ${phase} ${results.length}/${cases.length} ${c.name} ${results.at(-1).duration_ms}ms${error?' '+error.slice(0,100):''}`);
    await mkdir('data/test-results',{recursive:true});
    await writeFile(`data/test-results/reranker_${phase}.json`,JSON.stringify({started_at,updated_at:new Date().toISOString(),phase,
      model:ranker.id,chat_model:chatConfig.model,embedding_model:EMBEDDING_MODEL,
      snapshot:createHash('sha256').update(JSON.stringify(corpus.map(c=>[c.id,c.content_hash]))).digest('hex'),
      warmup_ms,cache:'New engine for every case; no retrieval/answer cache hits',completed:results.length,total:cases.length,results},null,2));
  }
}finally{ranker.close();}
console.log(JSON.stringify({phase,passed:results.filter(r=>r.passed).length,total:results.length,failures:results.filter(r=>!r.passed).map(r=>r.name)}));
if(results.some(r=>!r.passed))process.exitCode=1;
