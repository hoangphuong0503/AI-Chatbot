-- Add the installed local embedding model; keep the existing vector(1536) column.
-- Native Nomic vectors have 768 dimensions. The app normalizes them and pads
-- with 768 zeros, preserving cosine similarity exactly. Gemini vectors stay separate.
alter table public.document_chunks drop constraint if exists document_chunks_embedding_model_check;
alter table public.document_chunks add constraint document_chunks_embedding_model_check
  check(embedding_model in ('text-embedding-3-small','gemini-embedding-2','nomic-embed-text-padded-1536'));
