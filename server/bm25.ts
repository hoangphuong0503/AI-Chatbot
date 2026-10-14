import type {ChunkRecord,SearchHit} from './types.js';

const STOP=new Set('a an the is are was were of for to in and or what how can do does i my me please tell about with from at on it this that'.split(' '));
export function terms(text:string):string[]{
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(t=>t.length>1 && !STOP.has(t));
}
export class BM25Index {
  private lengths:number[]=[];
  private average=0;
  private postings=new Map<string,Map<number,number>>();
  constructor(private chunks:ChunkRecord[],private k1=1.5,private b=0.75){
    chunks.forEach((chunk,index)=>{
      const words=terms(chunk.content);this.lengths.push(words.length);
      const frequencies=new Map<string,number>();
      for(const word of words)frequencies.set(word,(frequencies.get(word)||0)+1);
      for(const [word,count] of frequencies){
        if(!this.postings.has(word))this.postings.set(word,new Map());
        this.postings.get(word)!.set(index,count);
      }
    });
    this.average=this.lengths.reduce((a,b)=>a+b,0)/Math.max(chunks.length,1);
  }
  search(query:string,options:{courseCode?:string|null;categories?:string[]|null;limit?:number}={}):SearchHit[]{
    const scores=new Map<number,number>();
    for(const word of new Set(terms(query))){
      const posting=this.postings.get(word);if(!posting)continue;
      const idf=Math.log(1+(this.chunks.length-posting.size+0.5)/(posting.size+0.5));
      for(const [index,tf] of posting){
        const chunk=this.chunks[index];
        if(options.courseCode && chunk.course_code!==options.courseCode)continue;
        if(options.categories && !options.categories.includes(chunk.category))continue;
        const score=idf*(tf*(this.k1+1))/(tf+this.k1*(1-this.b+this.b*this.lengths[index]/Math.max(this.average,1)));
        scores.set(index,(scores.get(index)||0)+score);
      }
    }
    return [...scores].map(([index,score])=>({...this.chunks[index],score}))
      .sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id)).slice(0,options.limit||30);
  }
}

export function rrf(keyword:SearchHit[],semantic:SearchHit[],limit=20,k=60):SearchHit[]{
  const merged=new Map<string,SearchHit>();
  for(const [label,list] of [['bm25',keyword],['vector',semantic]] as const){
    list.forEach((hit,position)=>{
      const current=merged.get(hit.id);
      merged.set(hit.id,{...hit,...current,semantic_similarity:hit.semantic_similarity??current?.semantic_similarity,
        score:(current?.score||0)+1/(k+position+1),
        metadata:{...hit.metadata,...current?.metadata,[`${label}_rank`]:position+1}});
    });
  }
  return [...merged.values()].sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id)).slice(0,limit);
}
