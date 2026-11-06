-- Let signed-in clients receive live row updates (RLS still applies to every subscriber).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gcat_error_items') then
    alter publication supabase_realtime add table public.gcat_error_items;
  end if;
end $$;
