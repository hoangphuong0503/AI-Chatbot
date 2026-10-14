import OpenAI from 'openai';
import {createClient} from '@supabase/supabase-js';
import {requireChatConfig,requireCloudConfig} from '../server/config.js';

function safeError(error:unknown){
  const e=error as {status?:number;code?:string;message?:string};
  let message=e.message || 'Unknown error';
  for(const [name,value] of Object.entries(process.env)){
    if(/KEY|SECRET|TOKEN|PASSWORD/.test(name) && value && value.length>5)message=message.split(value).join('[redacted]');
  }
  return {status:e.status,code:e.code,message:message.slice(0,500)};
}
const config=requireCloudConfig();
const db=createClient(config.url,config.secret,{auth:{persistSession:false,autoRefreshToken:false}});
for(const table of ['documents','document_chunks']){
  const result=await db.from(table).select('id',{count:'exact',head:true});
  console.log(JSON.stringify({table,count:result.count,error:result.error?safeError(result.error):null}));
}
const vector=Array(1536).fill(0);vector[0]=1;
const rpc=await db.rpc('semantic_search',{p_embedding:vector,p_match_count:1});
console.log(JSON.stringify({semantic_rpc_available:!rpc.error,error:rpc.error?safeError(rpc.error):null}));
const chat=requireChatConfig();
const client=new OpenAI({apiKey:chat.apiKey,baseURL:chat.baseURL,timeout:60_000,maxRetries:0});
try{
  const response=await client.chat.completions.create({model:chat.model,messages:[{role:'user',content:'Reply with exactly OK.'}],max_tokens:512});
  console.log(JSON.stringify({chat_model:chat.model,finish_reason:response.choices[0]?.finish_reason,
    visible_response:response.choices[0]?.message.content,usage:response.usage}));
}catch(error){console.log(JSON.stringify({chat_error:safeError(error)}));}
try{
  const list=await client.models.list();
  console.log(JSON.stringify({requested_model_available:list.data.some(m=>m.id===chat.model),
    related_model_ids:list.data.filter(m=>/deepseek|embed/i.test(m.id)).map(m=>m.id)}));
}catch(error){console.log(JSON.stringify({model_list_error:safeError(error)}));}
