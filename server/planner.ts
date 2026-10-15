import {categoryFilter,courseFilter,expandQuery,intakeState,resolveNamedCourse} from './retrieval.js';
import type {ChunkRecord} from './types.js';
export type History={role:'user'|'assistant';content:string}[];
export type Intent='intake'|'fees'|'policy'|'duration'|'entry'|'campus'|'general';
export function detectIntent(text:string):Intent{
  const q=expandQuery(text);
  if(/\b(refund|complaint|appeal|attendance|policy|policies)\b/i.test(q))return 'policy';
  if(/\b(intakes?|start dates?|next start|commence|commencement)\b/i.test(q))return 'intake';
  if(/\b(fees?|tuition|costs?|price)\b/i.test(q))return 'fees';
  if(/\b(duration|how long|weeks)\b/i.test(q))return 'duration';
  if(/\b(ielts|entry requirements?|english requirements?)\b/i.test(q))return 'entry';
  if(/\b(campus|campuses|address|contact)\b/i.test(q))return 'campus';
  return 'general';
}
export function namedCourse(text:string,corpus:ChunkRecord[]):string|null{
  const found=resolveNamedCourse(text,corpus);if(found)return found;
  if(/\b(?:SIT|CPC|AUR|ICT|BSB|MSF|MEM)\d{5}\b/i.test(text))return null;
  // Only distinctive subject names are eligible for shorthand matching.
  const subjects=['carpentry','glass and glazing','glazing','commercial cookery','cookery','painting and decorating','painting','joinery','stonemasonry','roof plumbing','solid plastering','bricklaying','waterproofing','glass','engineering fabrication'];
  const matched=subjects.filter(s=>text.toLowerCase().includes(s));
  if(!matched.length)return null;
  const codes=new Set(corpus.filter(c=>c.category==='course'&&c.course_code&&matched.some(s=>c.title.toLowerCase().includes(s))).map(c=>c.course_code!));
  return codes.size===1?[...codes][0]:null;
}
export function planQuestion(question:string,history:History,corpus:ChunkRecord[]){
  const users=history.filter(h=>h.role==='user').map(h=>h.content);
  const contextual=/\b(it|its|that|this|those|these|they|them|their|same|other|another|also|instead|former|latter|there)\b|\b(?:what|how) about\b|^(and|but)\b/i.test(question.trim());
  let intent=detectIntent(question);
  if(intent==='general'&&(contextual||/^(?:in|and in)?\s*(?:SA|VIC|NSW|WA|Adelaide|Sydney|Perth|Melbourne)\??$/i.test(question.trim())))
    intent=[...users].reverse().map(detectIntent).find(i=>i!=='general')||'general';
  const explicitCodes=[...new Set((question.match(/\b(?:SIT|CPC|AUR|ICT|BSB|MSF|MEM)\d{5}\b/gi)||[]).map(c=>c.toUpperCase()))];
  const explicitCourse=explicitCodes.length>1?null:namedCourse(question,corpus);
  const inheritedCourse=explicitCodes.length>1?null:[...users].reverse().map(q=>namedCourse(q,corpus)).find(Boolean)||null;
  const slotOnly=/^(?:(?:what (?:are|is)|how much|how long)\s+)?(?:the\s+)?(?:fees?|tuition(?: fees)?|cost|duration|entry requirements|IELTS requirements)\??$/i.test(question.trim());
  const course=explicitCourse||((contextual||slotOnly)&&intent!=='general'&&intent!=='campus'&&intent!=='policy'?inheritedCourse:null);
  const explicitState=intakeState(question);
  const multiState=/\b(?:SA|VIC|NSW|WA|Adelaide|Melbourne|Sydney|Perth|South Australia|Victoria|New South Wales|Western Australia)\b/i.test(question)&&!explicitState;
  const inheritedState=[...users].reverse().map(intakeState).find(Boolean)||null;
  const state=intent==='intake'?(explicitState||(!multiState?inheritedState:null)):null;
  const usedHistory=Boolean((!explicitCourse&&course)||(!explicitState&&state)||detectIntent(question)!==intent);
  const text=`${expandQuery(question)}${course&&!question.toUpperCase().includes(course)?` ${course}`:''}${state?` State ${state}`:''}${intent==='intake'?' intake schedule':''}`;
  const categories=intent==='policy'?['policy','college']:intent==='intake'?['intake']:categoryFilter(text);
  const courseFilterCode=intent==='policy'||intent==='campus'?null:course;
  return {intent,course,state,categories,courseFilter:courseFilterCode,usedHistory,contextual,multiState,query:text,explicitCodes};
}
export type QuestionPlan=ReturnType<typeof planQuestion>;
