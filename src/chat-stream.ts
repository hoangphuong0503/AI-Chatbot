export type ChatEvent={type:'status'|'token'|'done'|'error';text?:string;message?:string;answer?:string;[key:string]:unknown};
export async function readChatStream(response:Response,onEvent:(event:ChatEvent)=>void){
  if(!response.body)throw new Error('The assistant returned an empty stream. Please try again.');
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let pending='';let completed=false;
  function consume(line:string){
    if(!line.trim())return;
    const event=JSON.parse(line) as ChatEvent;
    if(event.type==='error')throw new Error(event.message||'The response was interrupted. Please try again.');
    if(event.type==='done')completed=true;
    onEvent(event);
  }
  try{
    while(true){
      const {done,value}=await reader.read();
      pending+=decoder.decode(value,{stream:!done});
      let index:number;
      while((index=pending.indexOf('\n'))>=0){consume(pending.slice(0,index));pending=pending.slice(index+1);}
      if(done)break;
    }
    if(pending.trim())consume(pending);
    if(!completed)throw new Error('The connection ended before the answer was complete. Please try again.');
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
