import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Markdown from 'react-markdown';
import {readChatStream} from './chat-stream';
import './style.css';

type Message={role:'user'|'assistant';content:string};
function displayAnswer(text:string){return text.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\](?!\()/g,'').replace(/ +([.,;:!?])/g,'$1');}
const prompts=[{label:'Find your course',description:'Qualifications & entry requirements',icon:'↗',question:'What courses can I study at Austra?'},{label:'Plan your budget',description:'Tuition & course fees',icon:'$',question:'How much does SIT30821 cost?'},{label:'Choose your campus',description:'Locations across Australia',icon:'⌖',question:'Where are the Austra campuses?'},{label:'Plan your intake',description:'Course start dates by state',icon:'◷',question:'What are the November intake dates for MSF30422 in SA?'}];

function App(){
  const [health,setHealth]=useState<{mode:string;ready:boolean;services?:Record<string,{ok:boolean;message?:string}>}|null>(null);
  const [messages,setMessages]=useState<Message[]>([]);
  const [input,setInput]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [failedQuestion,setFailedQuestion]=useState('');
  const [copied,setCopied]=useState<number|null>(null);
  const [elapsed,setElapsed]=useState(0);
  const [streaming,setStreaming]=useState('');
  const streamRef=useRef('');
  const abortRef=useRef<AbortController|null>(null);
  const autoScroll=useRef(true);
  const composer=useRef<HTMLTextAreaElement>(null);
  const end=useRef<HTMLDivElement>(null);
  const latest=useRef<HTMLElement>(null);
  useEffect(()=>{let mounted=true;const refresh=()=>fetch('/api/health').then(r=>r.json()).then(data=>{if(mounted)setHealth(data);}).catch(()=>{if(mounted)setHealth({mode:'cloud',ready:false});});void refresh();const timer=setInterval(refresh,30000);return()=>{mounted=false;clearInterval(timer);abortRef.current?.abort();};},[]);
  useEffect(()=>{if(!autoScroll.current)return;if(busy)end.current?.scrollIntoView({behavior:'auto'});else latest.current?.scrollIntoView({behavior:'smooth',block:'start'});},[messages,busy,streaming]);
  useEffect(()=>{if(!busy){setElapsed(0);return;}const timer=setInterval(()=>setElapsed(s=>s+1),1000);return()=>clearInterval(timer);},[busy]);
  useEffect(()=>{if(composer.current){composer.current.style.height='auto';composer.current.style.height=`${Math.min(composer.current.scrollHeight,140)}px`;}},[input]);
  async function copyAnswer(text:string,index:number){try{await navigator.clipboard.writeText(text);setCopied(index);setTimeout(()=>setCopied(null),2000);}catch{setError('Unable to copy. You can select and copy the answer manually.');}}
  async function send(text=input,retry=false){
    if(!text.trim() || busy||!health?.ready)return;
    const history=(retry?messages.slice(0,-1):messages).slice(-6).map(({role,content})=>({role,content}));
    autoScroll.current=true;
    if(!retry)setMessages(m=>[...m,{role:'user',content:text.trim()}]);setInput('');setBusy(true);setError('');setFailedQuestion('');setStreaming('');streamRef.current='';
    const controller=new AbortController();abortRef.current=controller;
    try{
      const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({question:text.trim(),history,stream:true})});
      if(!response.ok){const data=await response.json();throw new Error(data.error||'Request failed');}
      await readChatStream(response,event=>{
        if(event.type==='token'){streamRef.current+=event.text||'';setStreaming(displayAnswer(streamRef.current));}
        if(event.type==='done')setMessages(m=>[...m,{role:'assistant',content:displayAnswer(event.answer||'')}]);
      });
    }catch(e){setError(controller.signal.aborted?'Response stopped. You can retry the question.':e instanceof Error?e.message:'Unable to send your question.');setFailedQuestion(text);}
    finally{setBusy(false);setStreaming('');streamRef.current='';abortRef.current=null;}
  }
  return <div className="shell">
    <aside><a className="brand" href="https://austra.edu.au/" target="_blank" rel="noreferrer"><span className="mark">a.</span><span>AUSTRA<span className="brand-sub">COLLEGE</span></span></a>
      <div className="aside-copy"><span className="eyebrow">YOUR NEXT CHAPTER</span><h1>Your future.<br/>One conversation<br/>away.</h1><p>A little guidance for your next big step. Meet Amy, your Austra study assistant.</p><div className="orbit" aria-hidden="true"><span>✦</span></div></div>
      <div className="campuses">ADELAIDE · MELBOURNE<br/>SYDNEY · PERTH</div><a className="admissions" href="mailto:admission@austra.edu.au">Contact admissions ↗</a>
    </aside>
    <main><header><div><span className="avatar">✦</span><div><strong>Amy <span className="assistant-tag">STUDY ASSISTANT</span></strong><span className="subtitle">Austra College</span></div></div><button className="reset" onClick={()=>{setMessages([]);setError('');setFailedQuestion('');composer.current?.focus();}} disabled={busy}><span aria-hidden="true">＋</span> New chat</button></header>
      <div className="mode-note" role="status"><span className={`status-dot ${health?.ready?'ready':''}`}/>{!health?'Checking service connections…':!health.ready?`Temporarily unavailable${health.services?' · '+Object.entries(health.services).filter(([,s])=>!s.ok).map(([name])=>name==='embeddings'?'Local embedding model':name==='deepseek'?'AI service':'Knowledge database').join(', '):' · Unable to reach the server'}. Retrying automatically…`:health.mode==='preview'?'Explore Austra information':'Here to help you explore your next step'}</div>
      <section className="conversation" aria-live="polite" onScroll={e=>{const el=e.currentTarget;autoScroll.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;}}>
        {!messages.length && <div className="welcome"><span className="welcome-icon">✦</span><span className="welcome-kicker">HELLO, I'M AMY</span><h2>What’s your next chapter?</h2><p>Let’s find your way forward. Ask me about studying<br className="desktop-break"/> at Austra, or start with something below.</p><div className="suggestions">{prompts.map(p=><button key={p.label} onClick={()=>send(p.question)} disabled={!health?.ready || busy}><span className="prompt-icon" aria-hidden="true">{p.icon}</span><span className="prompt-copy"><strong>{p.label}</strong><small>{p.description}</small></span><span className="prompt-arrow" aria-hidden="true">↗</span></button>)}</div><p className="welcome-hint">Have a course in mind? Include its name and your preferred campus.</p></div>}
        {messages.map((m,i)=><article ref={i===messages.length-1?latest:undefined} className={`message ${m.role}`} key={i}><span className="message-label">{m.role==='user'?'YOU':'✦  AMY'}</span><div className="bubble">{m.role==='assistant'?<Markdown>{m.content}</Markdown>:m.content}</div>{m.role==='assistant'&&<button className="copy-answer" onClick={()=>void copyAnswer(m.content,i)} aria-label="Copy answer">{copied===i?'✓ Copied':'Copy answer'}</button>}</article>)}
        {busy&&streaming&&<article className="message assistant streaming" aria-busy="true"><span className="message-label">✦ AMY</span><div className="bubble"><Markdown>{streaming}</Markdown></div></article>}
        {busy&&!streaming && <div className="thinking" role="status"><span className="thinking-icon">✦</span><div><strong>{elapsed<12?'Let me look into that…':'Thanks for waiting…'}</strong><small>{elapsed<12?'Finding the right information for you.':'Amy is still preparing your answer.'}</small></div><span className="dots"><i/><i/><i/></span></div>}{error && <div className="error" role="alert"><span>{error}</span>{failedQuestion&&<button onClick={()=>void send(failedQuestion,true)} disabled={busy||!health?.ready}>Try again ↗</button>}</div>}<div ref={end}/>
      </section>
      <footer><form onSubmit={e=>{e.preventDefault();void send();}}><textarea ref={composer} aria-label="Your question" value={input} onChange={e=>setInput(e.target.value)} maxLength={2000} rows={1} placeholder="Ask anything about studying at Austra…" onKeyDown={e=>{if(e.key==='Enter' && !e.shiftKey && !e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>{busy?<button type="button" onClick={()=>abortRef.current?.abort()} aria-label="Stop response">■</button>:<button type="submit" disabled={!input.trim() || !health?.ready} aria-label="Send question">↑</button>}</form><div className="composer-meta"><span>Enter to send · Shift + Enter for a new line</span><span>{input.length>1800?`${input.length}/2000`:''}</span></div><p>Amy can make mistakes. Confirm fees and intake availability with <a href="mailto:admission@austra.edu.au">admissions</a>.</p></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
