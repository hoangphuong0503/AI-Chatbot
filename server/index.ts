import express from 'express';
import {rateLimit} from 'express-rate-limit';
import {createClient} from '@supabase/supabase-js';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {EMBEDDING_MODEL,EMBEDDING_PROVIDER,OLLAMA_EMBEDDING_MODEL,requireChatConfig,requireCloudConfig} from './config.js';
import {createEmbedder,validateVectors} from './embeddings.js';
import {loadLocalCorpus} from './retrieval.js';
import {createChat} from './chat.js';
import {createEngine} from './engine.js';
import {createHealthMonitor} from './health.js';
import type {History} from './planner.js';
import type {SearchHit} from './types.js';

const mode=process.env.APP_MODE||'preview';
if(!['preview','local-chat','cloud'].includes(mode))throw new Error('Invalid APP_MODE');
const cloud=mode==='cloud'?requireCloudConfig():null;
const chatConfig=mode!=='preview'?requireChatConfig():null;
const chat=chatConfig?createChat(chatConfig):null;
const embedding=cloud?createEmbedder(cloud.embeddingApiKey):null;
const db=cloud?createClient(cloud.url,cloud.secret,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const corpus=await loadLocalCorpus();
const localIds=[...new Set(corpus.map(c=>c.document_id))];
async function checkSnapshot(signal:AbortSignal){
  if(!db)return;
  const remote=await db.from('documents').select('id,content_hash').eq('searchable',true).abortSignal(signal);
  const hashes=new Map((await readFile(resolve('data/processed/documents.jsonl'),'utf8')).trim().split(/\r?\n/).map(line=>{
    const d=JSON.parse(line);return [d.id,d.content_hash] as [string,string];
  }));
  if(remote.error||remote.data?.length!==localIds.length||remote.data.some(d=>hashes.get(d.id)!==d.content_hash))throw new Error('Snapshot mismatch');
  const count=await db.from('document_chunks').select('id',{count:'exact',head:true}).eq('embedding_model',EMBEDDING_MODEL).in('document_id',localIds).abortSignal(signal);
  if(count.error||count.count!==corpus.length)throw new Error('Chunk/model inventory mismatch');
}
const probes:Record<string,(signal:AbortSignal)=>Promise<void>>={};
if(db)probes.supabase=checkSnapshot;
if(chat)probes.deepseek=async signal=>{await chat.complete([{role:'user',content:'Reply with exactly OK.'}],128,signal);};
if(embedding)probes.embeddings=async signal=>{
  if(EMBEDDING_PROVIDER==='ollama'){
    const response=await fetch(`${process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434'}/api/embed`,{
      method:'POST',headers:{'Content-Type':'application/json'},signal,
      body:JSON.stringify({model:OLLAMA_EMBEDDING_MODEL,input:'Austra course information',truncate:false,keep_alive:'10m'})});
    if(!response.ok)throw new Error('Embedding model unavailable');
    const data=await response.json() as {embeddings:number[][]};
    validateVectors(data.embeddings,1,OLLAMA_EMBEDDING_MODEL==='bge-m3'?1024:768);
  }else await embedding.embed(['Austra course information'],'query');
};
const checkHealth=createHealthMonitor(probes);
const answer=createEngine({corpus,mode,model:chatConfig?.model||'',endpoint:chatConfig?.baseURL||'',embeddingModel:EMBEDDING_MODEL,chat,
  embed:async query=>(await embedding!.embed([query],'query'))[0],
  semantic:async(vector,course,categories,count)=>{
    const result=await db!.rpc('semantic_search',{p_embedding:vector,p_course_code:course,p_categories:categories,p_match_count:count,p_embedding_model:EMBEDDING_MODEL});
    if(result.error)throw new Error('Supabase vector search failed');return result.data as SearchHit[];
  }});
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));
app.get('/api/health',async(_req,res)=>{
  const status=await checkHealth();
  res.status(status.ready?200:503).json({mode,...status,local_chunks:corpus.length,cloud_configured:Boolean(cloud),chat_model:chatConfig?.model||null,
    retrieval:mode==='cloud'?'BM25 + vector → RRF → DeepSeek reranker':mode==='local-chat'?'BM25 → DeepSeek reranker':'BM25 source preview'});
});
app.use('/api/chat',rateLimit({windowMs:60_000,limit:15,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:'Too many questions. Please try again in a minute.'}}));
app.post('/api/chat',async(req,res)=>{
  const {question,history:rawHistory,stream=false}=req.body||{};
  if(typeof question!=='string'||!question.trim()||question.length>2000){res.status(400).json({error:'Your question must contain between 1 and 2,000 characters.'});return;}
  if(typeof stream!=='boolean'){res.status(400).json({error:'Invalid stream option.'});return;}
  if(rawHistory!==undefined&&(!Array.isArray(rawHistory)||rawHistory.length>6||rawHistory.some((m:unknown)=>{
    if(!m||typeof m!=='object')return true;const v=m as {role?:unknown;content?:unknown};
    return !['user','assistant'].includes(String(v.role))||typeof v.content!=='string'||v.content.length>6000;
  }))){res.status(400).json({error:'Invalid conversation history.'});return;}
  const history=(rawHistory||[]) as History;
  const controller=new AbortController();
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  let heartbeat:ReturnType<typeof setInterval>|undefined;
  const write=(value:unknown)=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n');};
  try{
    if(stream){
      res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
      write({type:'status',text:'Finding the right information…'});
      heartbeat=setInterval(()=>{if(!res.destroyed)res.write('\n');},10000);heartbeat.unref();
    }
    const result=await answer(question.trim(),history,stream?text=>write({type:'token',text}):undefined,controller.signal);
    // Operational telemetry contains no questions, history, credentials or source text.
    console.info(JSON.stringify({event:'chat_completed',strategy:result.retrieval,cache_hit:result.retrieval_stats.cache_hit,timings:result.timings}));
    if(stream){write({type:'done',...result});res.end();}else res.json(result);
  }catch(error){
    if(controller.signal.aborted)return;
    const e=error as {name?:string;status?:number};
    console.error(JSON.stringify({event:'chat_failed',type:e.name||'Error',status:e.status||null}));
    const message='The assistant could not complete this answer. Please try again, or check the service status.';
    if(stream){write({type:'error',message});res.end();}else res.status(502).json({error:message});
  }finally{if(heartbeat)clearInterval(heartbeat);}
});
if(existsSync(resolve('dist/index.html'))){app.use(express.static(resolve('dist')));app.get('/',(_req,res)=>res.sendFile(resolve('dist/index.html')));}
app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:'Invalid request data.'});});
const port=Number(process.env.PORT||3001);
app.listen(port,'127.0.0.1',()=>console.log(`Austra ${mode} demo: http://127.0.0.1:${port}`));
