import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const cases=[
  {name:'change_details',question:'How often must a current student complete the Change of Details Form?',pattern:/6 months/i,source:'/change-of-details-form/'},
  {name:'scanned_agent_form',question:'What rating options and assessment areas are on the Education Agent Performance Review Form?',pattern:/Excellent/i,source:'/Education-Agent-Performance-Review-Form.pdf'},
  {name:'legacy_directory',question:'Where can I download the Agent Review Form listed under Policies and Forms?',pattern:/legacy|older|current version|confirm/i,source:'/policies-forms/'},
];
const results=[];
try{
  for(const c of cases){
    const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:c.question}),signal:AbortSignal.timeout(180000)});
    const result=await response.json();
    results.push({name:c.name,...result});
    assert.equal(response.status,200);
    assert.match(result.answer,c.pattern);
    assert.ok(result.sources.some((s:{url:string})=>s.url.includes(c.source)),`${c.name}: missing new evidence`);
    console.log(`${c.name}: passed`);
  }
}finally{
  await mkdir('data/test-results',{recursive:true});
  await writeFile('data/test-results/source_updates.json',JSON.stringify(results,null,2));
}
