-- Faster Judgement page: the list needs only CAS, substance name and "Comment(last time)" from raw_source,
-- but used to download the whole raw_source (≈70 columns) for every row. This computed field lets the page
-- select just those three values (PostgREST computed field: `select=...,judge_facts`).
-- Read-only, SECURITY INVOKER (RLS of gcat_error_items still applies). Safe to run more than once.
create or replace function public.judge_facts(i public.gcat_error_items)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cas', i.raw_source->>'CAS No. [col 29]',
    'substance', i.raw_source->>'Substance Name [col 30]',
    'commentLast', (
      select e.value #>> '{}'
      from jsonb_each(coalesce(i.raw_source, '{}'::jsonb)) e
      where lower(regexp_replace(regexp_replace(e.key, '\s*\[col \d+\]\s*$', ''), '\s+', ' ', 'g')) in ('comment(last time)', 'comment (last time)')
        and coalesce(e.value #>> '{}', '') !~ '^\s*$'
      limit 1)
  )
$$;
revoke all on function public.judge_facts(public.gcat_error_items) from public, anon;
grant execute on function public.judge_facts(public.gcat_error_items) to authenticated, service_role;
notify pgrst, 'reload schema';
