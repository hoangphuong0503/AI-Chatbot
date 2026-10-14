import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const docId='00000000-0000-4000-8000-000000000001';
const chunkId='00000000-0000-4000-8000-000000000002';
const replacementId='00000000-0000-4000-8000-000000000003';
const embedding=Array(1536).fill(0) as number[];embedding[0]=1;
const doc={id:docId,source_url:'https://austra.edu.au/example/',title:'Example Course',
  source_type:'html',category:'course',course_code:'SIT30821',content_hash:'v1',fetched_at:new Date().toISOString(),metadata:{}};
const chunk={id:chunkId,document_id:docId,chunk_index:0,content:'SIT30821 Commercial Cookery Tuition Fees $15,500 Total Course Fee $17,500',
  content_hash:'c1',token_count:30,section:'Fees',metadata:{},embedding,embedding_model:'text-embedding-3-small'};

test('Migration, hybrid ranking, access control, atomic replacement and snapshot activation',async()=>{
  const pg=new PGlite({extensions:{vector}});
  try{
    await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await pg.exec(await readFile('supabase/migrations/202610140001_knowledge.sql','utf8'));
    await pg.exec(await readFile('supabase/migrations/202610140002_semantic_candidates.sql','utf8'));
    await pg.exec(await readFile('supabase/migrations/202610140003_local_nomic.sql','utf8'));
    await pg.exec(await readFile('supabase/migrations/202610140005_safe_snapshot.sql','utf8'));
    await pg.exec(await readFile('supabase/migrations/202610140004_local_bge_m3.sql','utf8'));
    await pg.query('select public.replace_knowledge_document($1::jsonb,$2::jsonb)',[JSON.stringify(doc),JSON.stringify([chunk])]);
    const result=await pg.query<{content:string;course_code:string;score:number}>(
      'select * from public.hybrid_search($1,$2::extensions.vector,$3)', ['SIT30821 fees',JSON.stringify(embedding),'SIT30821']);
    assert.equal(result.rows.length,1);
    assert.match(result.rows[0].content,/17,500/);
    assert.ok(result.rows[0].score>0);
    assert.ok(result.rows[0].score>1/61,'Both keyword and semantic ranks must contribute');
    const semantic=await pg.query('select * from public.semantic_search($1::extensions.vector,$2,null,30,$3)',
      [JSON.stringify(embedding),'SIT30821','text-embedding-3-small']);
    assert.equal(semantic.rows.length,1);
    const mixedModel=await pg.query('select * from public.semantic_search($1::extensions.vector,$2,null,30,$3)',
      [JSON.stringify(embedding),'SIT30821','gemini-embedding-2']);
    assert.equal(mixedModel.rows.length,0,'Different embedding spaces must never be mixed');
    const wrongCourse=await pg.query('select * from public.hybrid_search($1,$2::extensions.vector,$3)',
      ['fees',JSON.stringify(embedding),'CPC30220']);
    assert.equal(wrongCourse.rows.length,0);
    await assert.rejects(pg.query('select public.replace_knowledge_document($1::jsonb,$2::jsonb)',[
      JSON.stringify({...doc,title:'Should roll back'}),JSON.stringify([{...chunk,embedding:[1,0]}])
    ]));
    const unchanged=await pg.query<{title:string}>('select title from documents where id=$1',[docId]);
    assert.equal(unchanged.rows[0].title,'Example Course');
    await pg.query('select public.replace_knowledge_document($1::jsonb,$2::jsonb)',[
      JSON.stringify(doc),JSON.stringify([{...chunk,id:replacementId,content_hash:'c2'}])]);
    const remaining=await pg.query<{id:string}>('select id from document_chunks');
    assert.deepEqual(remaining.rows.map(r=>r.id),[replacementId]);
    const access=await pg.query<{allowed:boolean}>("select has_function_privilege('anon','public.hybrid_search(text,extensions.vector,text,text[],integer,integer,text)','EXECUTE') as allowed");
    assert.equal(access.rows[0].allowed,false);
    await pg.exec('set role anon;');
    await assert.rejects(pg.query('select * from document_chunks'));
    await pg.exec('reset role;');
    await assert.rejects(pg.query('select public.activate_knowledge_snapshot($1::uuid[])',[[]]));
    await pg.query('select public.activate_knowledge_snapshot($1::uuid[])',[['00000000-0000-4000-8000-000000000099']]);
    const disabled=await pg.query('select * from public.hybrid_search($1,$2::extensions.vector)', ['fees',JSON.stringify(embedding)]);
    assert.equal(disabled.rows.length,0);
  } finally {await pg.close();}
});
