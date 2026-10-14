import {createHash} from 'node:crypto';

export function retrievalCacheKey(scope:string,question:string,history:{role:string;content:string}[]){
  return createHash('sha256').update(JSON.stringify([scope,question.trim().replace(/\s+/g,' '),history])).digest('hex');
}

// In-memory LRU; no questions or conversation history are persisted to disk.
export class RetrievalCache<T>{
  private entries=new Map<string,{value:T;expires:number}>();
  constructor(private capacity=200,private ttlMs=10*60_000,private now=()=>Date.now()){}
  get(key:string):T|undefined{
    const entry=this.entries.get(key);
    if(!entry)return undefined;
    this.entries.delete(key);
    if(entry.expires<=this.now())return undefined;
    this.entries.set(key,entry);
    return structuredClone(entry.value);
  }
  set(key:string,value:T){
    this.entries.delete(key);
    this.entries.set(key,{value:structuredClone(value),expires:this.now()+this.ttlMs});
    while(this.entries.size>this.capacity)this.entries.delete(this.entries.keys().next().value!);
  }
}
