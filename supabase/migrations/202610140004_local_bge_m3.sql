-- Adds BGE-M3 support after the existing local-model migration.
-- Native BGE-M3 vectors have 1024 dimensions. The app pads with 512 zeros
-- to preserve cosine similarity and use the existing vector(1536) column.
alter table public.document_chunks drop constraint if exists document_chunks_embedding_model_check;
alter table public.document_chunks add constraint document_chunks_embedding_model_check
  check(embedding_model in ('text-embedding-3-small','gemini-embedding-2','nomic-embed-text-padded-1536','bge-m3-padded-1536'));
