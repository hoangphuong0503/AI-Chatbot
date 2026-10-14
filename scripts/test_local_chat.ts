import {createChat,rerank} from '../server/chat.js';
import {requireChatConfig} from '../server/config.js';
import {BM25Index} from '../server/bm25.js';
import {loadLocalCorpus} from '../server/retrieval.js';
import {writeFile,mkdir} from 'node:fs/promises';

const chat=createChat(requireChatConfig());
const bm25=new BM25Index(await loadLocalCorpus());
const question='How much does SIT30821 cost? Distinguish tuition fees from the total fee.';
const query=await chat.complete([{role:'system',content:'Translate into one concise English retrieval query. Preserve course codes. Output query only.'},
  {role:'user',content:question}],400);
const candidates=bm25.search(query,{courseCode:'SIT30821',categories:['course'],limit:20});
const hits=await rerank(chat,question,candidates,8);
const answer=await chat.complete([{role:'system',content:'Answer in English using only the supplied evidence. Cite [1], [2] etc. Distinguish tuition and total fees. If evidence is missing, say so.'},
  {role:'user',content:question+'\n\n'+hits.map((h,i)=>`[${i+1}] ${h.content}`).join('\n\n')+'\n\nWrite the final answer entirely in English.'}],2000);
const passed=hits.some(h=>h.section.endsWith('Fees')) && /15[,. ]?500/.test(answer) && /17[,. ]?500/.test(answer) && /\[\d+\]/.test(answer) && /tuition/i.test(answer);
const report={mode:'local-bm25+deepseek-reranker',tested_at:new Date().toISOString(),query,candidates:candidates.length,
  selected_sources:hits.map(h=>({section:h.section,url:h.source_url})),answer,passed,
  note:'No Supabase vector search or RRF performed in this local test.'};
await mkdir('data/test-results',{recursive:true});
await writeFile('data/test-results/local_chat.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!passed)process.exitCode=1;
