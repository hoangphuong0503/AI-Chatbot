import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {readChatStream} from '../src/chat-stream.js';
const controller=new AbortController();
let gotToken=false,completed=false,interrupted=false;
const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
  body:JSON.stringify({question:'What are the IELTS requirements for CPC30220?',stream:true})});
assert.equal(response.status,200);
try{
  await readChatStream(response,event=>{
    if(event.type==='token'){gotToken=true;controller.abort();}
    if(event.type==='done')completed=true;
  });
}catch{interrupted=controller.signal.aborted;}
assert.ok(gotToken);assert.ok(interrupted);assert.equal(completed,false);
await mkdir('data/test-results',{recursive:true});
await writeFile('data/test-results/stream-abort.json',JSON.stringify({tested_at:new Date().toISOString(),passed:true,gotToken,interrupted,completed},null,2));
console.log('PASS: partial streamed response can be aborted without accepting a completed answer.');
