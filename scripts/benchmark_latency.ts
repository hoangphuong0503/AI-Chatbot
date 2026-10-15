import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {readChatStream,type ChatEvent} from '../src/chat-stream.js';
const phase=process.argv.find(a=>a.startsWith('--phase='))?.split('=')[1]||'after';
const cases=[
  {name:'duration',question:'How long does SIT30821 take?',required:[/52\s*weeks/i,/192/]},
  {name:'IELTS',question:'What are the IELTS requirements for CPC30220?',required:[/6\.0/,/IELTS/i]},
  {name:'details form',question:'How often must current students complete the Change of Details Form?',required:[/6\s*months/i,/change/i]},
  {name:'agent ratings',question:'List the rating choices in the Education Agent Performance Review Form.',required:[/Excellent/i,/Below Average/i,/legacy|2023|current version/i]},
  {name:'payment plan',question:'Does SIT30821 offer a payment plan?',required:[/weekly/i,/fortnightly/i,/monthly/i]},
  {name:'refund',question:'What is the refund policy for SIT30821?',required:[/refund/i]},
];
const results:any[]=[];
let previous=0;
for(const c of cases){
  for(const warm of [false,true]){
    const pause=Math.max(0,4500-(Date.now()-previous));if(pause)await new Promise(r=>setTimeout(r,pause));
    previous=Date.now();const start=performance.now();let first=0;let tokens=0;let done:ChatEvent|undefined;
    const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:c.question,stream:true}),signal:AbortSignal.timeout(180000)});
    assert.equal(response.status,200);
    await readChatStream(response,event=>{
      if(event.type==='token'){if(!first)first=Math.round(performance.now()-start);tokens++;}
      if(event.type==='done')done=event;
    });
    assert.ok(done);for(const pattern of c.required)assert.match(done.answer||'',pattern);
    const result={name:c.name,question:c.question,warm,first_token_ms:first,total_ms:Math.round(performance.now()-start),tokens,...done};
    results.push(result);console.log(JSON.stringify({name:c.name,warm,first_token_ms:first,total_ms:result.total_ms}));
    await mkdir('data/test-results',{recursive:true});
    await writeFile(`data/test-results/latency_${phase}.json`,JSON.stringify({tested_at:new Date().toISOString(),phase,results},null,2));
  }
}
