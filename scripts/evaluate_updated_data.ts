import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

type Case={name:string;group:string;question:string;all:RegExp[];source?:RegExp;none?:RegExp[]};
const cases:Case[]=[
  {name:'leadership fees',group:'fees',question:'What are the tuition and total fees for BSB50420?',all:[/12,500/,/14,000/],source:/diploma-of-leadership-and-management/},
  {name:'carpentry fees',group:'fees',question:'How much does CPC30220 cost, including all listed fees?',all:[/20,000/,/22,000/],source:/cpc30220/},
  {name:'glazing fees',group:'fees',question:'What are the fees for MSF30422?',all:[/16,000/,/19,500/],source:/msf30422/},
  {name:'IT fees',group:'fees',question:'What are the tuition fees and total fees for ICT60220?',all:[/30,000/,/32,000/],source:/advanced-diploma-of-information-technology/},
  {name:'kitchen management fees',group:'fees',question:'How much does SIT40521 cost?',all:[/21,500/,/23,500/],source:/sit40521/},
  {name:'painting duration',group:'courses',question:'How long does CPC30620 take and how many holiday weeks are included?',all:[/60\s*weeks/i,/10\s*weeks/i],source:/cpc30620/},
  {name:'carpentry duration',group:'courses',question:'What is the duration of CPC30220 and how many holiday weeks are included?',all:[/52\s*weeks/i,/4\s*weeks/i],source:/cpc30220/},
  {name:'leadership duration',group:'courses',question:'How long is BSB50420 including holiday breaks?',all:[/52\s*weeks/i,/8\s*weeks/i],source:/diploma-of-leadership-and-management/},
  {name:'kitchen package duration',group:'courses',question:'What are the two duration options for SIT40521, and when does the 24-week option apply?',all:[/70\s*weeks/i,/24[ -]weeks?/i,/SIT30821/i],source:/sit40521/},
  {name:'painting age and school',group:'courses',question:'What minimum age and school qualification are listed for CPC30620?',all:[/18/,/Year\s*12/i],source:/cpc30620/},
  {name:'carpentry workshop safety',group:'courses',question:'Can I enter CPC30220 practical workshop classes without PPE and safety boots?',all:[/PPE/i,/boots/i,/not|cannot|no\b|must|mandatory/i],source:/cpc30220/},
  {name:'details periodic update',group:'forms',question:'How often must current students complete the Change of Details Form?',all:[/6\s*months/i,/change/i],source:/change-of-details/},
  {name:'details changed information',group:'forms',question:'Do I need to complete the Change of Details Form when my details change, or can I wait six months?',all:[/when.*change|change.*occurs|whenever.*change/i],source:/change-of-details/},
  {name:'performance form rating choices',group:'forms',question:'List the rating choices in the Education Agent Performance Review Form.',all:[/Excellent/i,/Very Good/i,/Below Average/i,/legacy|2023|current version/i],source:/Education-Agent-Performance-Review-Form.pdf/},
  {name:'performance form identity fields',group:'forms',question:'Which agent identification and report-period fields appear on the Education Agent Performance Review Form?',all:[/name/i,/location/i,/report.*period/i],source:/Education-Agent-Performance-Review-Form.pdf/},
  {name:'performance form assessment areas',group:'forms',question:'Does the Education Agent Performance Review Form assess ESOS understanding and student satisfaction?',all:[/ESOS/i,/satisfaction/i],source:/Education-Agent-Performance-Review-Form.pdf/},
  {name:'performance form signatures',group:'forms',question:'Which compiled-by and reviewed-by signature fields are in the Education Agent Performance Review Form?',all:[/compiled/i,/reviewed/i,/signature/i,/date/i],source:/Education-Agent-Performance-Review-Form.pdf/},
  {name:'performance form version',group:'forms',question:'What version and initial document date are shown in the Education Agent Performance Review Form?',all:[/v?1\.0/i,/04\/09\/2023|4 September 2023|September 4,? 2023/i],source:/Education-Agent-Performance-Review-Form.pdf/},
  {name:'legacy agent form download',group:'forms',question:'Where can I download the Agent Review Form listed in Policies and Forms?',all:[/https:\/\/educert.net\/.*\/Agent-Review-Form.pdf/i,/legacy|current version|confirm|older/i],source:/policies-forms|Agent-Review-Form.pdf/},
  {name:'legacy annual agent review',group:'forms',question:'How often does the legacy Agent Review Form say it should be completed?',all:[/yearly|annually|every year|once.*year/i,/legacy|current|confirm|older/i],source:/Agent-Review-Form.pdf/},
  {name:'no fabricated agent scores',group:'forms',question:'What actual satisfaction rating did the agent Falcon Test Agency receive in the Education Agent Performance Review Form?',all:[/blank|no actual|not.*completed|does not.*rating|cannot|could not find|not.*provided|no.*data/i],none:[/Falcon Test Agency (received|was rated) (Excellent|Good)/i]},
  {name:'no fabricated contract decision',group:'forms',question:'According to the Agent Review Form, was Falcon Test Agency actually renewed or terminated?',all:[/blank|cannot|could not find|not.*completed|not.*provided|does not.*(decision|record)|no.*(decision|data|record)/i],none:[/^\s*(?:[-*]\s*)?Falcon Test Agency was (renewed|terminated)\b/im]},
  {name:'empty form page fields',group:'forms',question:'List the exact fields of the Application Leave Form on the Austra website. Do not substitute the deferral or cancellation form.',all:[/cannot|not.*(available|provided|found|contain)|could not|does not.*(list|include|provide)|no.*(fields|information)/i]},
];

const retry=process.argv.includes('--retry-failed');
const prior=retry?JSON.parse(await readFile('data/test-results/updated_data_evaluation.json','utf8')):null;
const results:any[]=prior?prior.results.filter((r:any)=>r.passed):[];
const health=await(await fetch('http://127.0.0.1:3001/api/health')).json();
assert.equal(health.ready,true,JSON.stringify(health));
let previous=0;
for(const c of cases){
  if(retry&&results.some(r=>r.name===c.name))continue;
  const pause=Math.max(0,4500-(Date.now()-previous));
  if(pause)await new Promise(r=>setTimeout(r,pause));
  previous=Date.now();
  const start=Date.now();let result:any;
  try{
    const response=await fetch('http://127.0.0.1:3001/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:c.question}),signal:AbortSignal.timeout(180000)});
    result=await response.json();assert.equal(response.status,200);
    for(const pattern of c.all)assert.match(result.answer,pattern);
    for(const pattern of c.none||[])assert.doesNotMatch(result.answer,pattern);
    if(c.source)assert.ok(result.sources.some((s:{url:string})=>c.source!.test(s.url)),'Expected source missing');
    results.push({name:c.name,group:c.group,question:c.question,passed:true,duration_ms:Date.now()-start,...result});
  }catch(error){results.push({name:c.name,group:c.group,question:c.question,passed:false,duration_ms:Date.now()-start,
    error:error instanceof Error?error.message:'Failed',result});}
  if(retry){results.at(-1).initial_attempt=prior.results.find((r:any)=>r.name===c.name);results.at(-1).retested_at=new Date().toISOString();}
  console.log(`${results.at(-1).passed?'PASS':'FAIL'} ${results.length}/${cases.length} ${c.name}`);
  await mkdir('data/test-results',{recursive:true});
  await writeFile('data/test-results/updated_data_evaluation.json',JSON.stringify({tested_at:new Date().toISOString(),
    health,completed:results.length,total:cases.length,passed:results.every(r=>r.passed),results},null,2));
}
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:cases.length,failures:results.filter(r=>!r.passed).map(r=>r.name)}));
if(results.some(r=>!r.passed))process.exitCode=1;
