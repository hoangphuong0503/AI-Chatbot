-- Run once in Supabase SQL Editor. Access is exclusively through the local backend.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema public, extensions to service_role;

create table if not exists public.documents (
  id uuid primary key,
  source_url text not null,
  title text not null,
  source_type text not null check (source_type in ('html', 'pdf')),
  category text not null,
  course_code text,
  content_hash text not null,
  fetched_at timestamptz,
  searchable boolean not null default true,
  review_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.document_chunks (
  id uuid primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null check (length(content) > 0),
  content_hash text not null,
  token_count integer not null check (token_count > 0 and token_count <= 650),
  section text not null,
  page_start integer,
  page_end integer,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(1536) not null,
  embedding_model text not null check (embedding_model = 'text-embedding-3-small'),
  fts tsvector generated always as (to_tsvector('english'::regconfig, content)) stored,
  unique(document_id, content_hash)
);
create index if not exists chunks_document_idx on public.document_chunks(document_id);
create index if not exists chunks_fts_idx on public.document_chunks using gin(fts);
create index if not exists chunks_vector_idx on public.document_chunks using hnsw(embedding extensions.vector_cosine_ops);
create index if not exists documents_course_idx on public.documents(course_code);

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
revoke all on public.documents, public.document_chunks from anon, authenticated;
grant all on public.documents, public.document_chunks to service_role;

-- Replaces a single document atomically, removing obsolete chunks on recrawl.
create or replace function public.replace_knowledge_document(p_document jsonb, p_chunks jsonb)
returns void language plpgsql security invoker
set search_path = public, extensions, pg_temp as $$
declare doc_id uuid := (p_document->>'id')::uuid;
begin
  if jsonb_array_length(p_chunks) = 0 then
    raise exception 'Cannot import a document without chunks';
  end if;
  if exists (select 1 from jsonb_array_elements(p_chunks) c where (c->>'document_id')::uuid is distinct from doc_id) then
    raise exception 'Chunk document_id mismatch';
  end if;
  insert into public.documents(id,source_url,title,source_type,category,course_code,content_hash,fetched_at,searchable,review_status,metadata)
  values(doc_id,p_document->>'source_url',p_document->>'title',p_document->>'source_type',p_document->>'category',
    p_document->>'course_code',p_document->>'content_hash',(p_document->>'fetched_at')::timestamptz,
    true,coalesce(p_document->>'review_status','pending'),coalesce(p_document->'metadata','{}'::jsonb))
  on conflict(id) do update set source_url=excluded.source_url,title=excluded.title,
    source_type=excluded.source_type,category=excluded.category,course_code=excluded.course_code,
    content_hash=excluded.content_hash,fetched_at=excluded.fetched_at,searchable=true,
    review_status=excluded.review_status,metadata=excluded.metadata,updated_at=now();
  delete from public.document_chunks where document_id = doc_id;
  insert into public.document_chunks(id,document_id,chunk_index,content,content_hash,token_count,section,page_start,page_end,metadata,embedding,embedding_model)
  select (c->>'id')::uuid,doc_id,(c->>'chunk_index')::integer,c->>'content',c->>'content_hash',
    (c->>'token_count')::integer,c->>'section',(c->>'page_start')::integer,(c->>'page_end')::integer,
    coalesce(c->'metadata','{}'::jsonb),(c->>'embedding')::extensions.vector,c->>'embedding_model'
  from jsonb_array_elements(p_chunks) c;
end;
$$;

-- Only run after the entire current corpus was imported successfully.
create or replace function public.activate_knowledge_snapshot(p_document_ids uuid[])
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if coalesce(array_length(p_document_ids,1),0) = 0 then
    raise exception 'Refusing an empty snapshot';
  end if;
  update public.documents set searchable = (id = any(p_document_ids))
  where searchable is distinct from (id = any(p_document_ids));
end;
$$;

create or replace function public.hybrid_search(
  p_query text, p_embedding extensions.vector(1536),
  p_course_code text default null, p_categories text[] default null,
  p_match_count integer default 8, p_candidate_count integer default 30,
  p_embedding_model text default 'text-embedding-3-small'
) returns table (
  id uuid, content text, section text, source_url text, title text,
  course_code text, category text, page_start integer, page_end integer,
  score double precision, semantic_similarity double precision, metadata jsonb
) language sql stable security invoker
set search_path = public, extensions, pg_temp as $$
with eligible as (
  select c.*,d.source_url,d.title,d.course_code,d.category,d.metadata as document_metadata
  from public.document_chunks c join public.documents d on d.id=c.document_id
  where d.searchable and c.embedding_model=p_embedding_model
    and (p_course_code is null or d.course_code=upper(p_course_code))
    and (p_categories is null or d.category=any(p_categories))
), keyword as (
  select e.id,row_number() over(order by ts_rank_cd(e.fts,q.query) desc,e.id) as rank
  from eligible e cross join (
    select regexp_replace(plainto_tsquery('english'::regconfig,p_query)::text,' & ',' | ','g')::tsquery as query
  ) q
  where e.fts @@ q.query
  order by ts_rank_cd(e.fts,q.query) desc,e.id
  limit greatest(1,least(p_candidate_count,100))
), semantic as (
  select e.id,row_number() over(order by e.embedding <=> p_embedding,e.id) as rank
  from eligible e order by e.embedding <=> p_embedding,e.id
  limit greatest(1,least(p_candidate_count,100))
), fused as (
  select coalesce(k.id,s.id) as id,
    coalesce(1.0/(60+k.rank),0.0)+coalesce(1.0/(60+s.rank),0.0) as rrf_score
  from keyword k full outer join semantic s on k.id=s.id
)
select e.id,e.content,e.section,e.source_url,e.title,e.course_code,e.category,e.page_start,e.page_end,
  f.rrf_score::double precision,(1-(e.embedding <=> p_embedding))::double precision,
  e.metadata || jsonb_build_object('document_review_flags',e.document_metadata->'review_flags')
from fused f join eligible e on e.id=f.id
order by f.rrf_score desc,e.id
limit greatest(1,least(p_match_count,20));
$$;

revoke all on function public.replace_knowledge_document(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.activate_knowledge_snapshot(uuid[]) from public,anon,authenticated;
revoke all on function public.hybrid_search(text,extensions.vector,text,text[],integer,integer,text) from public,anon,authenticated;
grant execute on function public.replace_knowledge_document(jsonb,jsonb) to service_role;
grant execute on function public.activate_knowledge_snapshot(uuid[]) to service_role;
grant execute on function public.hybrid_search(text,extensions.vector,text,text[],integer,integer,text) to service_role;
