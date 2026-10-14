import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {BM25Index,rrf} from '../server/bm25.js';
import {loadLocalCorpus,expandQuery} from '../server/retrieval.js';
import {createChat,rerank} from '../server/chat.js';
import {createEmbedder,validateVectors} from '../server/embeddings.js';
import {OLLAMA_EMBEDDING_MODEL} from '../server/config.js';
import type {ChunkRecord,SearchHit} from '../server/types.js';

function hit(id:string,content=id):SearchHit{return {id,document_id:'doc',chunk_index:0,content,content_hash:id,
  token_count:10,section:'Fees',page_start:null,page_end:null,source_url:'https://austra.edu.au/',title:'Austra',
  category:'course',course_code:'SIT30821',metadata:{},score:99};}

test('BM25 retrieves the real fee table and exact course scope',async()=>{
  const index=new BM25Index(await loadLocalCorpus());
  const matches=index.search('SIT30821 tuition fees',{courseCode:'SIT30821',categories:['course'],limit:5});
  assert.ok(matches.length);
  assert.match(matches[0].section,/Fees/);
  assert.match(matches[0].content,/17,500/);
  assert.ok(matches.every(m=>m.course_code==='SIT30821'));
  const cost=index.search(expandQuery('How much does SIT30821 cost?'),{courseCode:'SIT30821',categories:['course'],limit:5});
  assert.match(cost[0].section,/Fees/);
});
test('BM25 rewards relevant concise content over a long unrelated document',()=>{
  const short=hit('short','carpentry entry requirements');
  const long=hit('long','carpentry '+Array(500).fill('automotive').join(' '));
  const index=new BM25Index([short,long] as ChunkRecord[]);
  assert.equal(index.search('carpentry')[0].id,'short');
  assert.deepEqual(index.search('astronomy'),[]);
});
test('RRF merges by rank, de-duplicates, and preserves both branch contributions',()=>{
  const merged=rrf([hit('keyword-only'),hit('shared')],[hit('shared'),hit('vector-only')]);
  assert.equal(merged[0].id,'shared');
  assert.equal(merged.length,3);
  assert.equal(merged[0].metadata.bm25_rank,2);
  assert.equal(merged[0].metadata.vector_rank,1);
  assert.ok(merged[0].score>merged[1].score);
});
test('Reranker applies validated order and supports abstention',async()=>{
  const result=await rerank({complete:async()=>'{"ranked_indices":[1,0,1]}'},'fees',[hit('a'),hit('b')]);
  assert.deepEqual(result.map(h=>h.id),['b','a']);
  assert.deepEqual(await rerank({complete:async()=>'{"ranked_indices":[]}'},'unrelated',[hit('a')]),[]);
  await assert.rejects(rerank({complete:async()=>'{"ranked_indices":[999]}'},'fees',[hit('a')]));
  await assert.rejects(rerank({complete:async()=>'<not json>'},'fees',[hit('a')]));
});
test('Chat uses the requested model and Chat Completions; Gemini sends one request per chunk',async()=>{
  const seen:{url:string;body:Record<string,unknown>;auth:string|undefined}[]=[];
  const server=createServer(async(req,res)=>{
    const buffers=[];for await(const b of req)buffers.push(b);
    const body=JSON.parse(Buffer.concat(buffers).toString());
    seen.push({url:req.url!,body,auth:(req.headers.authorization || req.headers['x-goog-api-key']) as string});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/chat/completions')res.end(JSON.stringify({id:'mock',object:'chat.completion',created:1,model:'deepseek-v4-flash-0731',choices:[{index:0,message:{role:'assistant',content:'OK'},finish_reason:'stop'}]}));
    else if(req.url==='/api/embed'){
      const native=OLLAMA_EMBEDDING_MODEL==='bge-m3'?1024:768;
      res.end(JSON.stringify({embeddings:[[3,4,...Array(native-2).fill(0)],[4,3,...Array(native-2).fill(0)]]}));
    }
    else res.end(JSON.stringify({embeddings:[{values:[3,4]},{values:[4,3]}]}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try{
    assert.equal(await createChat({apiKey:'mock-chat-only',baseURL:base+'/v1',model:'deepseek-v4-flash-0731'}).complete([{role:'user',content:'ping'}]),'OK');
    assert.equal(seen[0].body.model,'deepseek-v4-flash-0731');
    assert.equal(seen[0].auth,'Bearer mock-chat-only');
    const vectors=await createEmbedder('mock-google-only',{provider:'gemini',model:'gemini-embedding-2',dimensions:2,geminiBaseURL:base,rpm:1000}).embed(['first document','second document'],'passage');
    assert.equal(vectors.length,2);
    assert.ok(Math.abs(Math.hypot(...vectors[0])-1)<1e-10);
    assert.equal(seen[1].auth,'mock-google-only');
    assert.equal((seen[1].body.requests as unknown[]).length,2);
    assert.match(seen[1].url,/gemini-embedding-2:batchEmbedContents/);
    const requests=seen[1].body.requests as {content:{parts:{text:string}[]}}[];
    assert.ok(requests[0].content.parts[0].text.includes('first document'));
    assert.ok(!requests[0].content.parts[0].text.includes('second document'));
    assert.match(requests[0].content.parts[0].text,/^title:/);
    const local=await createEmbedder('',{provider:'ollama',dimensions:1536,ollamaBaseURL:base}).embed(['first','second'],'query');
    assert.equal(local[0].length,1536);
    assert.ok(local[0].slice(1024).every(n=>n===0));
    assert.ok(Math.abs(local[0].reduce((sum,x,i)=>sum+x*local[1][i],0)-0.96)<1e-10,'Zero padding must preserve cosine similarity');
    assert.equal(seen[2].auth,undefined,'Local embedding requests must not carry cloud API keys');
    if(OLLAMA_EMBEDDING_MODEL==='bge-m3')assert.equal((seen[2].body.input as string[])[0],'first');
    else assert.match((seen[2].body.input as string[])[0],/^search_query:/);
    assert.throws(()=>validateVectors([[1,2]],2,2));
    assert.throws(()=>validateVectors([[0,0]],1,2));
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
