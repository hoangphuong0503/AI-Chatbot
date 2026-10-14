-- Apply after 202610140001_knowledge.sql. Keeps 1536-dimensional vectors.
-- BM25 and RRF now run in the local backend; this RPC returns vector candidates.
alter table public.document_chunks drop constraint if exists document_chunks_embedding_model_check;
alter table public.document_chunks add constraint document_chunks_embedding_model_check
  check(embedding_model in ('text-embedding-3-small','gemini-embedding-2'));

create or replace function public.semantic_search(
  p_embedding extensions.vector(1536), p_course_code text default null,
  p_categories text[] default null,p_match_count integer default 30,
  p_embedding_model text default 'gemini-embedding-2'
) returns table (
  id uuid, content text, section text, source_url text, title text,
  course_code text, category text, page_start integer, page_end integer,
  score double precision, semantic_similarity double precision, metadata jsonb
) language sql stable security invoker
set search_path=public,extensions,pg_temp as $$
select c.id,c.content,c.section,d.source_url,d.title,d.course_code,d.category,c.page_start,c.page_end,
  (1-(c.embedding <=> p_embedding))::double precision,
  (1-(c.embedding <=> p_embedding))::double precision,
  c.metadata || jsonb_build_object('document_review_flags',d.metadata->'review_flags')
from public.document_chunks c join public.documents d on d.id=c.document_id
where d.searchable and c.embedding_model=p_embedding_model
  and(p_course_code is null or d.course_code=upper(p_course_code))
  and(p_categories is null or d.category=any(p_categories))
order by c.embedding <=> p_embedding,c.id
limit greatest(1,least(p_match_count,100));
$$;
revoke all on function public.semantic_search(extensions.vector,text,text[],integer,text) from public,anon,authenticated;
grant execute on function public.semantic_search(extensions.vector,text,text[],integer,text) to service_role;
