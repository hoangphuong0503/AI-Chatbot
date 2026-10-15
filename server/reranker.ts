import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {rerank,type ChatCompleter} from './chat.js';
import type {SearchHit} from './types.js';

export type Rank=(question:string,hits:SearchHit[],limit?:number,signal?:AbortSignal)=>Promise<SearchHit[]>;
export interface Reranker {id:string;rank:Rank;check:(signal?:AbortSignal)=>Promise<void>;close:()=>void;runtime:{device:string|null}}
export function rerankerPython(env:NodeJS.ProcessEnv,platform:NodeJS.Platform=process.platform,exists:(path:string)=>boolean=existsSync){
  if(env.RERANKER_PYTHON?.trim())return env.RERANKER_PYTHON.trim();
  const local=resolve('.venv',...(platform==='win32'?['Scripts','python.exe']:['bin','python']));
  return exists(local)?local:platform==='win32'?'python':'python3';
}
export function localRelevanceQuery(input:string){
  // The cross-encoder scores a natural query, not the LLM's metadata labels.
  const match=input.match(/\nResolved course: ([^\n]+)\nRequested state: ([^\n]+)$/);
  if(!match)return input;
  let query=input.slice(0,match.index);
  for(const value of [match[1],match[2]])if(value!=='unspecified'&&!query.toLowerCase().includes(value.toLowerCase()))query+=` ${value}`;
  return query;
}
export function selectLocalHits(hits:SearchHit[],scores:number[],limit:number,minScore:number):SearchHit[]{
  if(scores.length!==hits.length||scores.some(s=>!Number.isFinite(s)))throw new Error('Invalid local reranker scores');
  return hits.map((hit,i)=>({hit,score:scores[i],i})).filter(h=>h.score>=minScore)
    .sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,Math.max(0,limit))
    .map(({hit,score},i)=>({...hit,metadata:{...hit.metadata,rerank_position:i+1,rerank_score:score}}));
}
export function createReranker(chat:ChatCompleter,env:NodeJS.ProcessEnv=process.env):Reranker{
  const provider=env.RERANKER_PROVIDER||'llm';
  if(provider==='llm')return {id:'llm-reranker',rank:(...args)=>rerank(chat,...args),check:async()=>{},close:()=>{},runtime:{device:null}};
  if(provider!=='local')throw new Error('RERANKER_PROVIDER must be local or llm');
  const model=env.LOCAL_RERANKER_MODEL||'BAAI/bge-reranker-v2-m3';
  const revision=env.LOCAL_RERANKER_REVISION||(model==='BAAI/bge-reranker-v2-m3'?'953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e':'main');
  const threshold=Number(env.LOCAL_RERANKER_MIN_SCORE||'-5');
  if(!Number.isFinite(threshold))throw new Error('Invalid LOCAL_RERANKER_MIN_SCORE');
  let child:ChildProcessWithoutNullStreams|undefined;
  let starting:Promise<void>|undefined;
  let serial=0;
  const runtime:{device:string|null}={device:null};
  const pending=new Map<number,{resolve:(scores:number[])=>void;reject:(error:Error)=>void}>();
  const fail=(error:Error)=>{for(const job of pending.values())job.reject(error);pending.clear();};
  const close=()=>{const process=child;child=undefined;starting=undefined;process?.kill();fail(new Error('Local reranker stopped'));};
  async function start(){
    if(starting)return starting;
    starting=new Promise<void>((ready,reject)=>{
      const worker=spawn(rerankerPython(env),[resolve('scripts/local_reranker.py')],{
        env:{...process.env,...env,PYTHONUNBUFFERED:'1',PYTHONIOENCODING:'utf-8'},windowsHide:true,stdio:'pipe'});
      child=worker;
      let booted=false;
      const timer=setTimeout(()=>{reject(new Error('Local reranker startup timed out'));close();},180000);
      const lines=createInterface({input:worker.stdout});
      lines.on('line',line=>{
        try{
          const message=JSON.parse(line);
          if(message.type==='ready'){runtime.device=message.device;booted=true;clearTimeout(timer);ready();return;}
          const job=pending.get(message.id);if(!job)return;pending.delete(message.id);
          if(message.error)job.reject(new Error('Local reranker inference failed'));
          else job.resolve(message.scores);
        }catch{fail(new Error('Invalid local reranker response'));}
      });
      // Dependency logs never contain requests. Keep stdout exclusively JSONL.
      worker.stderr.on('data',()=>{});
      worker.stdin.on('error',()=>fail(new Error('Local reranker input failed')));
      const stopped=()=>{
        clearTimeout(timer);lines.close();
        const error=new Error('Local reranker unavailable; check Python dependencies and model');
        if(child===worker){child=undefined;starting=undefined;fail(error);}
        if(!booted)reject(error);
      };
      worker.on('error',stopped);worker.on('exit',stopped);
    });
    return starting;
  }
  async function rank(question:string,hits:SearchHit[],limit=8,signal?:AbortSignal){
    if(!hits.length)return [];
    signal?.throwIfAborted();await start();signal?.throwIfAborted();
    const id=++serial;
    const scores=await new Promise<number[]>((accept,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);};
      const abort=()=>{cleanup();reject(signal?.reason||new Error('Aborted'));};
      const timer=setTimeout(()=>{cleanup();reject(new Error('Local reranker request timed out'));},60000);
      pending.set(id,{resolve:value=>{cleanup();accept(value);},reject:error=>{cleanup();reject(error);}});
      signal?.addEventListener('abort',abort,{once:true});
      child!.stdin.write(JSON.stringify({id,query:localRelevanceQuery(question),documents:hits.map(h=>h.content)})+'\n',error=>{
        if(error){cleanup();reject(new Error('Local reranker input failed'));}
      });
    });
    return selectLocalHits(hits,scores,limit,threshold);
  }
  // Lifecycle owner calls close on shutdown; no silent fallback to a cloud model.
  return {id:`local-reranker:${model}:${revision}:512-stride64-query2:${threshold}`,rank,check:async signal=>{
    await rank('course tuition fees',[{content:'The official course tuition is $15,500.',metadata:{}} as SearchHit],1,signal);
  },close,runtime};
}
