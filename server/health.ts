export type ServiceCheck={ok:boolean;checked_at:string;latency_ms:number;message?:string};
export function createHealthMonitor(probes:Record<string,(signal:AbortSignal)=>Promise<void>>,ttlMs=60_000,timeoutMs=15_000,now=()=>Date.now()){
  let cached:{ready:boolean;services:Record<string,ServiceCheck>}|undefined;
  let expires=0;
  let pending:Promise<NonNullable<typeof cached>>|undefined;
  return async function check(){
    if(cached&&now()<expires)return cached;
    if(pending)return pending;
    pending=(async()=>{
      const entries=await Promise.all(Object.entries(probes).map(async([name,probe])=>{
        const start=performance.now();
        const controller=new AbortController();
        let timer:ReturnType<typeof setTimeout>;
        try{
          await Promise.race([probe(controller.signal),new Promise<never>((_,reject)=>{
            timer=setTimeout(()=>{controller.abort();reject(new Error('Service check timed out'));},timeoutMs);
          })]);
          return [name,{ok:true,checked_at:new Date().toISOString(),latency_ms:Math.round(performance.now()-start)}] as const;
        }catch{
          return [name,{ok:false,checked_at:new Date().toISOString(),latency_ms:Math.round(performance.now()-start),message:`${name} is unavailable. Check its connection, model and quota.`}] as const;
        }finally{clearTimeout(timer!);}
      }));
      const services=Object.fromEntries(entries) as Record<string,ServiceCheck>;
      cached={ready:Object.values(services).every(s=>s.ok),services};
      // Recover quickly after a failure without spamming healthy APIs.
      expires=now()+(cached.ready?ttlMs:5000);
      return cached;
    })();
    try{return await pending;}finally{pending=undefined;}
  };
}
