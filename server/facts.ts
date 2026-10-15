import type {ChunkRecord,SearchHit} from './types.js';
import type {QuestionPlan,History} from './planner.js';
type IntakeDate={day:number;month_label:string};
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthNumber(text:string){return months.findIndex(m=>new RegExp(`\\b${m.slice(0,3)}(?:${m.slice(3)})?\\b`,'i').test(text))+1;}
function latestMonth(question:string,history:History){return monthNumber(question)||(/\b(that|same|what about|how about|and in)\b/i.test(question)?[...history].reverse().filter(h=>h.role==='user').map(h=>monthNumber(h.content)).find(Boolean)||0:0);}
function hit(c:ChunkRecord):SearchHit{return {...c,score:1};}
export function structuredAnswer(plan:QuestionPlan,question:string,history:History,corpus:ChunkRecord[]):{answer:string;hits:SearchHit[];kind:string}|null{
  if(/\beducation agent performance review form\b/i.test(question)&&/\bsignature fields\b/i.test(question)&&/\b(?:compiled|reviewed)[ -]by\b/i.test(question)){
    const allowed=new Set('which what and are the compiled by reviewed signature fields in education agent performance review form list show me of'.split(' '));
    if((question.toLowerCase().match(/[a-z0-9]+/g)||[]).every(w=>allowed.has(w))){
      const pattern=/(Compiled By):\s*(Signature):\s*(Date)\s*(Reviewed By):\s*(Signature):\s*(?:SIGN\s*)?(Date)\b/i;
      const records=corpus.filter(c=>c.source_url.endsWith('/Education-Agent-Performance-Review-Form.pdf')&&pattern.test(c.content));
      const labels=records.length===1?records[0].content.match(pattern):null;
      if(labels)return {answer:`- **${labels[1]}:** ${labels[2]}, ${labels[3]}.\n- **${labels[4]}:** ${labels[5]}, ${labels[6]}. [1]`,hits:records.map(hit),kind:'form-fields'};
    }
  }
  if(plan.intent==='entry'&&plan.course&&plan.explicitCodes.length<=1&&/\bIELTS\b/i.test(question)){
    const allowed=new Set(('what are is the a an IELTS English entry minimum score scores requirement requirements for of in general academic this that course '+plan.course).toLowerCase().split(/\s+/));
    if((question.toLowerCase().match(/[a-z0-9]+/g)||[]).every(w=>allowed.has(w))){
      const tables=corpus.filter(c=>c.category==='course'&&c.course_code===plan.course&&c.metadata.kind==='table'&&/entry requirements/i.test(c.section)&&/IELTS.*\|.*ELICOS/i.test(c.content));
      const supporting=corpus.filter(c=>c.category==='course'&&c.course_code===plan.course&&/entry requirements/i.test(c.section)&&/Results older than .*\(for offshore applicants\)/i.test(c.content));
      if(tables.length===1&&supporting.length===1){
        const lines=tables[0].content.split('\n').slice(3).filter(Boolean).map(line=>line.split('|').map(s=>s.trim()));
        const header=lines[0]||[];const ielts=header.findIndex(s=>/^IELTS\b/i.test(s));const elicos=header.findIndex(s=>/^ELICOS\b/i.test(s));
        const rows=lines.slice(1);
        const valid=ielts>=0&&elicos>=0&&rows.length>0&&rows.every(r=>r.length===header.length&&/^\d\.\d$/.test(r[ielts])&&/^(?:n\/a|\+\d+\s+weeks)$/i.test(r[elicos]));
        const validity=supporting[0].content.match(/Results older than [^.\n]*?\(for offshore applicants\)/i)?.[0];
        if(valid&&validity)return {answer:`**${plan.course} — ${header[ielts]}**\n\n${rows.map(r=>`- **${r[ielts]}:** ${header[elicos]}: ${r[elicos]}`).join('\n')}\n\n[1]\n\n${validity}. [2]${/Evidence that/i.test(supporting[0].content)?' The course also lists alternative English-evidence pathways; confirm which applies to you with admissions. [2]':''}`,hits:[tables[0],supporting[0]].map(hit),kind:'english-requirements'};
      }
    }
  }
  if(plan.intent==='duration'&&plan.course&&plan.explicitCodes.length<=1){
    const records=corpus.filter(c=>c.category==='course'&&c.course_code===plan.course&&/(?:^|>)\s*Duration(?:\s*>|$)/i.test(c.section));
    const allowed=new Set(('how long does do is are it its this that the course qualification take takes last lasts duration length total full time weeks week holiday holidays breaks break included including and many what of for in option options two apply applies when '+(records[0]?.title||'')+' '+plan.course).toLowerCase().match(/[a-z0-9]+/g));
    // One source section only; unknown qualifiers, comparisons and special
    // circumstances retain the hybrid pipeline. Quote all options/conditions.
    const words=question.toLowerCase().match(/[a-z0-9]+/g)||[];
    // Numeric qualifiers must identify a stated course option, not a number of
    // holiday weeks, placement hours or classroom hours elsewhere in the text.
    const numbers=new Set(records.flatMap(r=>[...r.content.matchAll(/Option\s+\d+:[^.]*?\bis\s+(\d+)\s+weeks/gi)].map(m=>m[1])));
    if(records.length===1&&words.every(w=>allowed.has(w)||numbers.has(w))){
      const body=records[0].content.split('\n').slice(3).join('\n').trim();
      if(body&&/\b\d+\s*weeks?\b/i.test(body))return {answer:`**${plan.course} — listed duration**\n\n${body} [1]`,hits:records.map(hit),kind:'duration'};
    }
  }
  if(/\bhow often\b|\bfrequency\b/i.test(question)&&/\bchange of details form\b/i.test(question)){
    const allowed=new Set('how often what is the frequency must should do does a each current student students complete fill in out submit update their change of details form'.split(' '));
    if((question.toLowerCase().match(/[a-z0-9]+/g)||[]).every(w=>allowed.has(w))){
      const records=corpus.filter(c=>c.source_url.endsWith('/change-of-details-form/'));
      const quote=records.length===1?records[0].content.match(/page states:\s*"([^"]+)"/)?.[1]:null;
      if(quote)return {answer:`The Change of Details Form page states: "${quote}". [1]`,hits:records.map(hit),kind:'form-instruction'};
    }
  }
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
  const allowed=new Set(('a an the what s how much does do is are it its this that course tuition fees fee total non application material price cost costs and for of in at to pay payment need tell show me please aud dollars distinguish from between breakdown break down including all listed charges '+records[0].title+' '+plan.course).toLowerCase().match(/[a-z0-9]+/g));
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
