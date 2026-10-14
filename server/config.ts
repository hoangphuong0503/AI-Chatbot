import 'dotenv/config';

export const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || 'ollama';
export const OLLAMA_EMBEDDING_MODEL=process.env.OLLAMA_EMBEDDING_MODEL || 'bge-m3';
export const EMBEDDING_MODEL = EMBEDDING_PROVIDER === 'ollama' ? `${OLLAMA_EMBEDDING_MODEL}-padded-1536` : EMBEDDING_PROVIDER === 'gemini' ? 'gemini-embedding-2' : 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
function required(env: NodeJS.ProcessEnv, names: string[]) {
  const missing = names.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing backend environment variables: ${missing.join(', ')}`);
}
export function requireChatConfig(env: NodeJS.ProcessEnv = process.env) {
  required(env,['CHAT_API_KEY']);
  return { apiKey: env.CHAT_API_KEY!, baseURL: env.CHAT_API_BASE_URL || 'https://discovery-api.intern-ai.org.cn/v1',
    model: env.CHAT_MODEL || 'deepseek-v4-flash-0731' };
}
export function requireCloudConfig(env: NodeJS.ProcessEnv = process.env) {
  required(env,['SUPABASE_URL','SUPABASE_SECRET_KEY']);
  if(env.SUPABASE_SECRET_KEY!.startsWith('sb_publishable_')){
    throw new Error('SUPABASE_SECRET_KEY contains a publishable key. Use the backend secret key starting with sb_secret_.');
  }
  return {url:env.SUPABASE_URL!,secret:env.SUPABASE_SECRET_KEY!,...requireEmbeddingConfig(env)};
}
export function requireEmbeddingConfig(env: NodeJS.ProcessEnv = process.env) {
  if(!['gemini','openai','ollama'].includes(EMBEDDING_PROVIDER))throw new Error('EMBEDDING_PROVIDER must be gemini, openai or ollama');
  if (EMBEDDING_PROVIDER==='openai') required(env,['OPENAI_API_KEY']);
  if (EMBEDDING_PROVIDER==='gemini') required(env,['GEMINI_API_KEY']);
  return {
    embeddingApiKey: EMBEDDING_PROVIDER==='ollama' ? '' : EMBEDDING_PROVIDER==='gemini' ? env.GEMINI_API_KEY! : env.OPENAI_API_KEY!,
  };
}
export function embeddingInput(text: string, purpose: 'query' | 'passage',provider=EMBEDDING_PROVIDER): string {
  if(provider==='ollama')return OLLAMA_EMBEDDING_MODEL==='bge-m3'?text:`${purpose==='query'?'search_query':'search_document'}: ${text}`;
  if(provider!=='gemini') return text;
  return purpose==='query' ? `task: search result | query: ${text}` : `title: ${text.split('\n')[0]} | text: ${text}`;
}
