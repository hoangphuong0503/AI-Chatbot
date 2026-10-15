import {readFile,writeFile} from 'node:fs/promises';
import {createReranker} from '../server/reranker.js';
import type {SearchHit} from '../server/types.js';
import 'dotenv/config';

const before=JSON.parse(await readFile('data/test-results/reranker_llm.json','utf8'));
// Return all finite scores for inspection, then apply the app's default threshold.
const ranker=createReranker({complete:async()=>{throw new Error('No cloud call expected');}},
  {...process.env,RERANKER_PROVIDER:'local',LOCAL_RERANKER_MIN_SCORE:'-1000'});
const results=[];
try{
  const start=performance.now();await ranker.check();const warmup_ms=Math.round(performance.now()-start);
  for(const row of before.results.filter((r:any)=>r.candidates.length)){
    const t=performance.now();const ranked=await ranker.rank(row.rerank_question,row.candidates,100);
    const scores=ranked.map(h=>({id:h.id,score:h.metadata.rerank_score,section:h.section,url:h.source_url}));
    const accepted=ranked.filter(h=>Number(h.metadata.rerank_score)>=-5).slice(0,8);
    results.push({name:row.name,question:row.question,baseline_rerank_ms:row.timings.rerank_ms,
      local_rerank_ms:Math.round(performance.now()-t),accepted:accepted.length,scores,
      baseline_selected_ids:row.candidates.filter((h:SearchHit)=>row.excerpts.includes(h.content)).map((h:SearchHit)=>h.id)});
    console.log(row.name,results.at(-1)!.local_rerank_ms+'ms',accepted.length+' accepted',scores[0]?.score);
  }
  await writeFile('data/test-results/reranker_replay.json',JSON.stringify({warmup_ms,model:ranker.id,
    method:'Identical recorded RRF candidates and question/context from the baseline; the local adapter removes LLM metadata labels; model resident; raw logits; threshold -5.',results},null,2));
}finally{ranker.close();}
