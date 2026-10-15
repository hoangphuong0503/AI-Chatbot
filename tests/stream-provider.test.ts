import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {createChat} from '../server/chat.js';
test('Upstream streaming emits content chunks and rejects truncated completion',async()=>{
  let truncated=false,missingStop=false;
  const server=createServer(async(req,res)=>{
    for await(const _ of req){};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const frame=(content:string|null,finish:string|null)=>`data: ${JSON.stringify({id:'mock',object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta:content?{content}:{},finish_reason:finish}]})}\n\n`;
    res.write(frame('Hello ',null));res.write(frame('world',null));
    res.end((missingStop?'':frame(null,truncated?'length':'stop'))+'data: [DONE]\n\n');
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{
    const chat=createChat({apiKey:'mock',baseURL:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,model:'deepseek-v4-flash-0731'});
    const tokens:string[]=[];
    assert.equal(await chat.stream!([{role:'user',content:'Hello'}],s=>tokens.push(s)),'Hello world');
    assert.deepEqual(tokens,['Hello ','world']);
    truncated=true;await assert.rejects(chat.stream!([{role:'user',content:'Hello'}],()=>{}),/truncated/);
    truncated=false;missingStop=true;
    await assert.rejects(chat.stream!([{role:'user',content:'Hello'}],()=>{}),/before completion/);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
