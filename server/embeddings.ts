import OpenAI from 'openai';
import {EMBEDDING_DIMENSIONS,EMBEDDING_MODEL,EMBEDDING_PROVIDER,OLLAMA_EMBEDDING_MODEL,embeddingInput} from './config.js';

export function validateVectors(vectors:number[][],count:number,dimensions=EMBEDDING_DIMENSIONS):number[][]{
  if(vectors.length!==count || vectors.some(v=>!Array.isArray(v) || v.length!==dimensions || v.some(n=>!Number.isFinite(n)))){
    throw new Error('Embedding count, dimensions or numeric values are invalid');
  }
  return vectors.map(v=>{
    const norm=Math.hypot(...v);if(norm===0)throw new Error('Zero embedding vector');
    return v.map(n=>n/norm);
  });
}

export function createEmbedder(apiKey:string,options:{provider?:string;model?:string;dimensions?:number;geminiBaseURL?:string;ollamaBaseURL?:string;rpm?:number}={}){
  const provider=options.provider || EMBEDDING_PROVIDER;
  const model=options.model || EMBEDDING_MODEL;
  const dimensions=options.dimensions || EMBEDDING_DIMENSIONS;
  const ai=provider==='openai'?new OpenAI({apiKey,timeout:120_000,maxRetries:3}):null;
  const rpm=options.rpm ?? Number(process.env.EMBEDDING_RPM || 60);
  if(!Number.isFinite(rpm) || rpm<=0)throw new Error('EMBEDDING_RPM must be a positive number');
  let nextRequest=0;
  return {async embed(texts:string[],purpose:'query'|'passage'):Promise<number[][]>{
    if(!texts.length)return [];
    const inputs=texts.map(t=>embeddingInput(t,purpose,provider));
    if(provider==='ollama'){
      const response=await fetch(`${options.ollamaBaseURL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/api/embed`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:OLLAMA_EMBEDDING_MODEL,input:inputs,truncate:false,keep_alive:'10m'}),signal:AbortSignal.timeout(180_000)});
      if(!response.ok)throw new Error(`Local Ollama embeddings failed (HTTP ${response.status}); ensure Ollama and ${OLLAMA_EMBEDDING_MODEL} are available.`);
      const data=await response.json() as {embeddings:number[][]};
      const nativeDimensions=OLLAMA_EMBEDDING_MODEL==='bge-m3'?1024:768;
      const native=validateVectors(data.embeddings,texts.length,nativeDimensions);
      if(dimensions<nativeDimensions)throw new Error('Configured vector storage is smaller than the embedding model dimensions');
      return native.map(v=>[...v,...Array(dimensions-nativeDimensions).fill(0)]);
    }
    const wait=Math.max(0,nextRequest-Date.now());
    if(wait)await new Promise(r=>setTimeout(r,wait));
    // Google counts individual EmbedContent requests inside a synchronous batch.
    nextRequest=Date.now()+(60_000/rpm)*(provider==='gemini'?texts.length:1);
    if(ai){
      const response=await ai.embeddings.create({model,dimensions,input:inputs});
      return validateVectors(response.data.sort((a,b)=>a.index-b.index).map(d=>d.embedding),texts.length,dimensions);
    }
    const base=options.geminiBaseURL || 'https://generativelanguage.googleapis.com/v1beta';
    const requests=inputs.map(text=>({model:`models/${model}`,content:{parts:[{text}]},outputDimensionality:dimensions}));
    // Each separate request produces one vector; never aggregate several chunks into one input Content.
    for(let attempt=0;attempt<4;attempt++){
      const response=await fetch(`${base}/models/${model}:batchEmbedContents`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
        body:JSON.stringify({requests}),signal:AbortSignal.timeout(120_000)});
      if(response.status===429 || response.status>=500){
        const detail=await response.json().catch(()=>({})) as {error?:{details?:Record<string,unknown>[]}};
        const quotas=(detail.error?.details || []).flatMap(d=>(d.violations as {quotaMetric?:string;quotaId?:string;quotaValue?:string}[] || []))
          .map(v=>({metric:v.quotaMetric,id:v.quotaId,limit:v.quotaValue}));
        if(quotas.some(q=>(q.id || '').includes('PerDay')) || attempt===3)throw new Error(`Gemini embeddings unavailable or quota exceeded (HTTP ${response.status}); quotas: ${JSON.stringify(quotas)}`);
        const retry=Number(response.headers.get('retry-after'));
        const info=(detail.error?.details || []).find(d=>typeof d.retryDelay==='string');
        const guidance=info?parseFloat(String(info.retryDelay))*1000:0;
        const cooldown=response.status===429?Math.max(60_000,guidance+1000,Number.isFinite(retry)?retry*1000:0):2000*2**attempt;
        console.warn(`Embedding service requested cooldown; retrying in ${Math.ceil(cooldown/1000)}s.`);
        await new Promise(r=>setTimeout(r,cooldown));
        nextRequest=Date.now()+(60_000/rpm)*texts.length;
        continue;
      }
      if(!response.ok)throw new Error(`Gemini embedding request failed (HTTP ${response.status}); verify key, model access and quota`);
      const data=await response.json() as {embeddings?:{values:number[]}[]};
      nextRequest=Math.max(nextRequest,Date.now()+(60_000/rpm)*texts.length);
      return validateVectors((data.embeddings || []).map(e=>e.values),texts.length,dimensions);
    }
    throw new Error('Embedding retry failed');
  }};
}
