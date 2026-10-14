import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_PROVIDER, requireCloudConfig } from '../server/config.js';
import {createEmbedder} from '../server/embeddings.js';
import type { ChunkRecord, DocumentRecord } from '../server/types.js';

async function jsonl<T>(path: string): Promise<T[]> {
  return (await readFile(resolve(path), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function main() {
  const docs = await jsonl<DocumentRecord>('data/processed/documents.jsonl');
  const chunks = await jsonl<ChunkRecord>('data/processed/chunks.jsonl');
  const ids = new Set(docs.map(d => d.id));
  if (new Set(chunks.map(c => c.id)).size !== chunks.length || chunks.some(c => !ids.has(c.document_id))) {
    throw new Error('Invalid prepared corpus: duplicates or missing document references');
  }
  const embedOnly=process.argv.includes('--embed-only');
  const activateOnly=process.argv.includes('--activate-only');
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ documents: docs.length, chunks: chunks.length,
      embedding_tokens: chunks.reduce((n,c) => n+c.token_count,0), model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS, cloud_writes: false, api_calls: false }, null, 2));
    return;
  }
  const config = requireCloudConfig();
  const ai = createEmbedder(config.embeddingApiKey);
  const db = createClient(config.url, config.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  // Validate migration access before spending embedding tokens.
  const probe = await db.from('document_chunks').select('id').limit(1);
  if (probe.error) throw new Error(`Run the migration first: ${probe.error.message}`);
  const cacheDir = resolve('data/embeddings');
  await mkdir(cacheDir, { recursive: true });
  const cachePath = resolve(cacheDir, 'cache.json');
  let cache: Record<string, number[]> = {};
  try { cache = JSON.parse(await readFile(cachePath, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const key = (c: ChunkRecord) => `${EMBEDDING_PROVIDER}:${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:retrieval-v1:${c.content_hash}`;
  const missing = chunks.filter(c => !cache[key(c)] || cache[key(c)].length !== EMBEDDING_DIMENSIONS);
  if(activateOnly && missing.length)throw new Error('Complete ingestion before activation-only mode.');
  console.log(`Embedding ${missing.length}/${chunks.length} chunks (cached vectors are reused).`);
  for (let offset=0; offset<missing.length; offset+=32) {
    const batch = missing.slice(offset, offset+32);
    const vectors=await ai.embed(batch.map(c=>c.content),'passage');
    vectors.forEach((vector,index)=>{cache[key(batch[index])]=vector;});
    await writeFile(cachePath+'.tmp', JSON.stringify(cache));
    await rename(cachePath+'.tmp', cachePath);
    console.log(`Embedded ${Math.min(offset+32,missing.length)}/${missing.length}`);
  }
  if(embedOnly){console.log('Document embeddings cached locally; cloud writes skipped.');return;}
  let imported=activateOnly?docs.length:0;
  for (const doc of activateOnly?[]:docs) {
    const { sections: _sections, ...record } = doc as DocumentRecord & { sections?: unknown };
    const rows = chunks.filter(c => c.document_id===doc.id).map(c => ({ ...c,
      embedding: cache[key(c)], embedding_model: EMBEDDING_MODEL }));
    const result = await db.rpc('replace_knowledge_document', { p_document: record, p_chunks: rows });
    if (result.error) throw new Error(`Import failed for ${doc.source_url}: ${result.error.message}`);
    console.log(`Imported ${++imported}/${docs.length}: ${doc.title}`);
  }
  const final = await db.rpc('activate_knowledge_snapshot', { p_document_ids: docs.map(d => d.id) });
  if (final.error) throw new Error(`Snapshot activation failed: ${final.error.message}`);
  const snapshot = createHash('sha256').update(chunks.map(c => c.id).join('\n')).digest('hex');
  await writeFile(resolve(cacheDir,'ingestion_report.json'), JSON.stringify({
    completed_at: new Date().toISOString(), documents: imported, chunks: chunks.length,
    model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, snapshot_hash: snapshot,
  },null,2));
  console.log('Supabase ingestion completed. Set APP_MODE=cloud to enable hybrid RAG.');
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
