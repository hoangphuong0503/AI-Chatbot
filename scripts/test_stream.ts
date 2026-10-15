import assert from 'node:assert/strict';
import {readChatStream,type ChatEvent} from '../src/chat-stream.js';
import {mkdir,writeFile} from 'node:fs/promises';
const start=performance.now();let firstTokenMs=0;let tokens=0;let result:ChatEvent|undefined;
const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({question:'What are the IELTS requirements for CPC30220?',stream:true}),signal:AbortSignal.timeout(180000)});
assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/ndjson/);
await readChatStream(response,event=>{
  if(event.type==='token'){if(!firstTokenMs)firstTokenMs=Math.round(performance.now()-start);tokens++;}
  if(event.type==='done')result=event;
});
assert.ok(result);assert.ok(tokens>1,'Must stream model tokens rather than send one buffered answer');
assert.match(result.answer||'',/IELTS/i);assert.ok(firstTokenMs<performance.now()-start);
const report={passed:true,tokens,first_token_ms:firstTokenMs,total_ms:Math.round(performance.now()-start),result};
await mkdir('data/test-results',{recursive:true});await writeFile('data/test-results/streaming.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,tokens,first_token_ms:firstTokenMs,total_ms:report.total_ms,timings:result.timings}));
