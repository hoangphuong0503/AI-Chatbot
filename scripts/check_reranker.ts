import assert from 'node:assert/strict';
import {createReranker} from '../server/reranker.js';
import {createChat} from '../server/chat.js';
import {requireChatConfig} from '../server/config.js';
import type {SearchHit} from '../server/types.js';
const chat=process.env.RERANKER_PROVIDER==='local'?{complete:async()=>{throw new Error('Local reranker must not call a chat API');}}:createChat(requireChatConfig());
const ranker=createReranker(chat);
try{
  const started=performance.now();await ranker.check();
  const hits=[{id:'fee',content:'Certificate III in Commercial Cookery SIT30821 tuition fees are $15,500.',metadata:{}},
    {id:'unrelated',content:'Astronomers study distant galaxies and black holes.',metadata:{}}] as SearchHit[];
  const ranked=await ranker.rank('What are the tuition fees for SIT30821?',hits);
  assert.equal(ranked[0]?.id,'fee');
  console.log(JSON.stringify({reranker:ranker.id,device:ranker.runtime.device,ready:true,startup_and_check_ms:Math.round(performance.now()-started)},null,2));
}finally{ranker.close();}
