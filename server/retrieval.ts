import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChunkRecord, SearchHit } from './types.js';

const COURSE = /\b(?:SIT|CPC|AUR|ICT|BSB|MSF|MEM)\d{5}\b/gi;
const STOP = new Set('a an the is are of for to in and or what how can do does i my me please tell about'.split(' '));

export function courseFilter(query: string): string | null {
  const codes = [...new Set((query.match(COURSE) || []).map(c => c.toUpperCase()))];
  return codes.length === 1 ? codes[0] : null;
}
export function intakeState(query:string):string|null{
  const matches=[...new Set([...query.matchAll(/\b(VIC|NSW|SA|WA|Victoria|Melbourne|New South Wales|Sydney|South Australia|Adelaide|Western Australia|Perth)\b/gi)]
    .map(m=>({victoria:'VIC',melbourne:'VIC','new south wales':'NSW',sydney:'NSW','south australia':'SA',adelaide:'SA','western australia':'WA',perth:'WA'}[m[0].toLowerCase()]||m[0].toUpperCase())))];
  return matches.length===1?matches[0]:null;
}
export function intakeEligible(hit:ChunkRecord,code:string|null,state:string|null){
  return hit.category==='intake'&&(!code||hit.course_code===code)&&(!state||hit.metadata.state===state);
}
export function canSkipRewrite(question:string,history:{role:string;content:string}[],namedCourse:string|null):boolean{
  // References can depend on context even when an explicit course code is present.
  if(/\b(it|its|that|this|those|these|they|them|their|same|other|another|also|instead|former|latter|there)\b|\bwhat about\b|\bhow about\b/i.test(question))return false;
  if(namedCourse)return true;
  // Leave non-English questions to the English query rewriter.
  if(/[^\x00-\x7F]/.test(question))return false;
  const intent=/\b(fees?|tuition|cost|price|duration|requirements?|ielts|refund|policy|policies|campus|campuses|address|contact|courses?|intake)\b/i;
  const subject=/\b(austra|college|carpentry|painting|cookery|automotive|hospitality|leadership|management|refund|campus|campuses)\b/i;
  return intent.test(question)&&subject.test(question)&&(!history.length||!/^(and|but|also)\b/i.test(question.trim()));
}
// Resolve abbreviated qualification names only when the corpus has one matching course.
// Ambiguous names and comparisons remain unfiltered.
export function resolveNamedCourse(query:string,corpus:ChunkRecord[]):string|null {
  if(query.match(COURSE))return courseFilter(query);
  if(/\b(compare|versus|vs)\b/i.test(query))return null;
  const qualification=query.match(/\b(certificate\s+(?:iii|iv|ii|i)|advanced\s+diploma|graduate\s+diploma|diploma)\b/i)?.[0].toLowerCase();
  if(!qualification)return null;
  const generic=new Set('how much does cost costs fees fee tuition total course courses certificate iii iv ii i in of and the diploma advanced graduate for is what entry requirements when earliest latest intake intakes date dates schedule on at sa vic nsw wa adelaide melbourne sydney perth south australia western new wales victoria january february march april may june july august september october november december jan feb mar apr jun jul aug sep oct nov dec'.split(' '));
  const terms=[...new Set((query.toLowerCase().match(/[a-z]+/g)||[]).filter(t=>!generic.has(t)&&t.length>2))];
  if(!terms.length)return null;
  const codes=new Set(corpus.filter(c=>c.category==='course'&&c.course_code&&
    c.title.toLowerCase().includes(qualification)&&terms.every(t=>new RegExp(`\\b${t}\\b`,'i').test(c.title)))
    .map(c=>c.course_code!));
  return codes.size===1?[...codes][0]:null;
}
export function expandQuery(query: string): string {
  const substitutions: [RegExp,string][] = [
    [/\b(?:costs?|price|how much)\b/gi, ' tuition fees total fee '],
    [/\bhow long\b/gi, ' duration weeks '],
    [/học phí|hoc phi|chi phí|chi phi/gi, ' tuition fees total cost '],
    [/nhập học|nhap hoc|khai giảng|khai giang/gi, ' intake start dates '],
    [/đầu vào|dau vao|yêu cầu|yeu cau/gi, ' entry requirements '],
    [/tiếng anh|tieng anh/gi, ' English IELTS requirements '],
    [/nấu ăn|nau an|cookery/gi, ' commercial cookery '],
    [/hoàn tiền|hoan tien/gi, ' refund policy '],
    [/địa chỉ|dia chi/gi, ' campus address location '],
    [/bao lâu|bao lau|thời lượng|thoi luong/gi, ' duration weeks '],
  ];
  return substitutions.reduce((text,[pattern,replacement]) => text.replace(pattern,replacement),query);
}
export function categoryFilter(query: string): string[] | null {
  const text=expandQuery(query).toLowerCase();
  if (/\b(intake|start date|next start)\b/.test(text)) return ['intake'];
  if (/\b(refund|complaint|appeal|attendance|transfer policy)\b/.test(text)) return ['policy','college'];
  if (/\b(fees?|tuition|costs?|price|entry requirements|ielts|duration)\b/.test(text)) return ['course','college'];
  return null;
}
export async function loadLocalCorpus(): Promise<ChunkRecord[]> {
  return (await readFile(resolve('data/processed/chunks.jsonl'),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));
}
export function lexicalSearch(chunks: ChunkRecord[], query: string, limit=8): SearchHit[] {
  const expanded=expandQuery(query);
  const code=courseFilter(expanded);
  const categories=categoryFilter(expanded);
  let terms=[...new Set(expanded.toLowerCase().match(/[a-z0-9]+/g) || [])].filter(t=>!STOP.has(t) && t.length>1);
  // A course code narrows course-specific questions; intakes have multiple course codes per document.
  const exactCode=categories?.includes('intake') ? null : code;
  if(exactCode && terms.length>1) terms=terms.filter(t=>t.toUpperCase()!==exactCode);
  if (!terms.length) return [];
  const eligible=chunks.filter(c=>(!exactCode || c.course_code===exactCode) && (!categories || categories.includes(c.category)));
  const df=new Map(terms.map(t=>[t,eligible.filter(c=>c.content.toLowerCase().includes(t)).length]));
  return eligible.map(c=>{
    const text=c.content.toLowerCase();
    let score=0;
    for (const term of terms) {
      if (!text.includes(term)) continue;
      const idf=Math.log(1+(eligible.length+1)/((df.get(term)||0)+1));
      score+=idf;
      if (c.section.toLowerCase().includes(term)) score+=2*idf;
    }
    if (c.category==='blog') score*=0.7;
    return {...c,score};
  }).filter(c=>c.score>0).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id)).slice(0,limit);
}

export interface Citation { index: number; title: string; url: string; section: string; page_start: number|null; page_end: number|null }
export function citations(hits: SearchHit[]): Citation[] {
  return hits.map((h,i)=>({index:i+1,title:h.title,url:h.source_url,section:h.section,
    page_start:h.page_start,page_end:h.page_end}));
}
