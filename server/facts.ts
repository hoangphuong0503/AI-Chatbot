import type {ChunkRecord,SearchHit} from './types.js';
import type {QuestionPlan,History} from './planner.js';
type IntakeDate={day:number;month_label:string};
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthNumber(text:string){return months.findIndex(m=>new RegExp(`\\b${m.slice(0,3)}(?:${m.slice(3)})?\\b`,'i').test(text))+1;}
function latestMonth(question:string,history:History){return monthNumber(question)||(/\b(that|same|what about|how about|and in)\b/i.test(question)?[...history].reverse().filter(h=>h.role==='user').map(h=>monthNumber(h.content)).find(Boolean)||0:0);}
function hit(c:ChunkRecord):SearchHit{return {...c,score:1};}
export function structuredAnswer(plan:QuestionPlan,question:string,history:History,corpus:ChunkRecord[]):{answer:string;hits:SearchHit[];kind:string}|null{
  if(plan.intent==='intake'){
    if(!plan.course)return {answer:'Which course would you like intake dates for? Please provide its name or course code.',hits:[],kind:'clarification'};
    if(!plan.state||plan.multiState)return {answer:'Which campus or state should I check: SA (Adelaide), VIC (Melbourne), NSW (Sydney), or WA (Perth)?',hits:[],kind:'clarification'};
    const records=corpus.filter(c=>c.category==='intake'&&c.course_code===plan.course&&c.metadata.state===plan.state);
    if(!records.length)return {answer:`I could not find an intake schedule for ${plan.course} in ${plan.state}. Please confirm availability with admission@austra.edu.au.`,hits:[],kind:'intake'};
    // Multiple streams (e.g. 24-week vs 70-week) must be chosen explicitly.
    const variant=question.match(/\b(\d+)\s*(?:weeks?|w)\b/i)?.[1];
    const selected=variant?records.filter(c=>new RegExp(`\\b${variant}\\s*(?:W|weeks?)?\\b`,'i').test(c.section)):records;
    if(!selected.length)return {answer:`I could not find a ${variant}-week intake stream for ${plan.course} in ${plan.state}. Please confirm the course duration with admissions.`,hits:records.map(hit),kind:'clarification'};
    if(selected.length!==1)return {answer:`There are multiple intake streams for ${plan.course} in ${plan.state}. Which stream or course duration do you mean?`,hits:records.map(hit),kind:'clarification'};
    const dates=selected[0].metadata.intake_dates as IntakeDate[]|undefined;
    if(!dates?.length)return null;
    const requestedMonths=months.filter(m=>new RegExp(`\\b${m.slice(0,3)}(?:${m.slice(3)})?\\b`,'i').test(question));
    if(requestedMonths.length>1)return {answer:'Please ask for one month at a time so I can match the intake dates and their stated years accurately.',hits:selected.map(hit),kind:'clarification'};
    const month=latestMonth(question,history);
    const year=question.match(/\b(20\d{2})\b/)?.[1];
    const all=dates.map(d=>({...d,month:monthNumber(d.month_label),year:d.month_label.match(/20\d{2}/)?.[0]}));
    const matching=all.filter(d=>(!month||d.month===month)&&(!year||d.year===year));
    if(!matching.length){
      const unknownYear=year&&all.some(d=>(!month||d.month===month)&&!d.year);
      return {answer:unknownYear?`The ${plan.state} schedule for ${plan.course} lists dates without a year for that period, so I cannot confirm an intake in ${year}. Please confirm the year with admissions.`:`No ${month?months[month-1]+' ':''}${year?year+' ':''}intake is listed for ${plan.course} in ${plan.state} in this snapshot. Please check with admissions for updates.`,hits:selected.map(hit),kind:'intake'};
    }
    if(/\b(next|upcoming|after today|from now)\b/i.test(question)&&matching.some(d=>!d.year))return {answer:`Some dates for ${plan.course} in ${plan.state} omit the year, so I cannot reliably determine the next upcoming intake. Please confirm the year and current availability with admissions.`,hits:selected.map(hit),kind:'intake'};
    const earliest=/\b(earliest|first|soonest)\b/i.test(question);
    if(earliest&&!month&&!year&&matching.some(d=>!d.year))return {answer:`Please specify a month or year for ${plan.course} in ${plan.state}. Some schedule dates omit the year, so I cannot reliably order all intakes chronologically.`,hits:selected.map(hit),kind:'clarification'};
    const sorted=[...matching].sort((a,b)=>Number(a.year||0)-Number(b.year||0)||a.month-b.month||a.day-b.day);
    const format=(d:typeof sorted[number])=>`${d.day} ${months[d.month-1]}${d.year?' '+d.year:''}`;
    const list=earliest?sorted.slice(0,1):sorted;
    return {answer:`${earliest?'The earliest listed intake':'Listed intakes'}${month?' in '+months[month-1]:''} for **${plan.course}** in **${plan.state}** ${earliest?'is':'are'} **${list.map(format).join(', ')}**.${earliest&&sorted.length>1?' Other listed dates: '+sorted.slice(1).map(format).join(', ')+'.':''}${list.some(d=>!d.year)?' The source does not specify a year for these dates; please confirm it with admissions.':''} Intake dates do not guarantee available places. [1]`,hits:selected.map(hit),kind:'intake'};
  }
  // Complex fee scenarios and comparisons still use the cited answer pipeline.
  if(plan.intent!=='fees'||!plan.course||plan.explicitCodes.length>1||/\b(refund|discount|scholarship|installment|instalment|payment plan|compare|versus|domestic|international|additional|equipment|included|includes|inclusions|tool|visa|ielts|pte|toefl|living|rent|accommodation|transport|insurance|oshc|per week)\b/i.test(question))return null;
  const records=corpus.filter(c=>c.category==='course'&&c.course_code===plan.course&&/\bfees?\b/i.test(c.section));
  if(records.length!==1)return null;
  // A course code alone must not turn a different subject's price into course fees.
  // Keep this route conservative; unfamiliar qualifiers go through relevance checks.
  const allowed=new Set(('a an the what s how much does do is are it its this that course tuition fees fee total non application material price cost costs and for of in at to pay payment need tell show me please aud dollars distinguish from between breakdown break down '+records[0].title+' '+plan.course).toLowerCase().match(/[a-z0-9]+/g));
  if((question.toLowerCase().match(/[a-z0-9]+/g)||[]).some(word=>!allowed.has(word)))return null;
  const values:{label:string;amount:number}[]=[];
  for(const line of records[0].content.split('\n')){
    const match=line.match(/^([^|]+)\|\s*\$([\d,]+)(?:\.([\d]{2}))?(?:\s|$)/);
    if(match)values.push({label:match[1].trim(),amount:Number(match[2].replaceAll(',',''))+Number(match[3]||0)/100});
  }
  const tuition=values.find(v=>/^tuition fees?$/i.test(v.label));
  const total=values.find(v=>/^total (?:course )?fees?$/i.test(v.label));
  const components=values.filter(v=>v!==total);
  if(!tuition||!total||components.length<2||Math.abs(components.reduce((sum,v)=>sum+v.amount,0)-total.amount)>.01)return null;
  const money=(n:number)=>'$'+n.toLocaleString('en-AU',{maximumFractionDigits:2});
  return {answer:`The listed fees for **${plan.course}** are:\n\n${values.map(v=>`- **${v.label}:** ${money(v.amount)}`).join('\n')}\n\nThe total is ${money(total.amount)}, including tuition and the listed non-tuition charges. These are AUD amounts from the website snapshot; confirm current fees and material inclusions with admissions. [1]`,hits:records.map(hit),kind:'fees'};
}
