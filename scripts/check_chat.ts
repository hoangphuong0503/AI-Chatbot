import {createChat} from '../server/chat.js';
import {requireChatConfig} from '../server/config.js';

try{
  const config=requireChatConfig();
  const response=await createChat(config).complete([{role:'user',content:'Reply with exactly OK.'}],512);
  console.log(JSON.stringify({model:config.model,endpoint:config.baseURL,chat_connected:true,response},null,2));
}catch{
  console.error('Chat check failed. Populate CHAT_API_KEY in .env and verify the model, endpoint and quota.');
  process.exitCode=1;
}
