-- Respect Supabase safe-update checks and update only changed activation flags.
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
revoke all on function public.activate_knowledge_snapshot(uuid[]) from public,anon,authenticated;
grant execute on function public.activate_knowledge_snapshot(uuid[]) to service_role;
