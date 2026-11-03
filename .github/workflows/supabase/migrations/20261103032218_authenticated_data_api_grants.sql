-- Supabase Data API access is now opt-in by default. Grant only authenticated access;
-- RLS remains enabled on every application table. No anonymous/public table grants.
alter table public.supplier_contacts enable row level security;
grant usage on schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from public;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all functions in schema public from anon;
revoke all on function public.handle_new_user() from authenticated;
revoke all on function public.set_updated_at() from authenticated;
revoke all on function public.guard_gcat_judgement_columns() from authenticated;
revoke all on function public.guard_supplier_precheck_review() from authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_any_role(public.app_role[]) to authenticated;
grant execute on function public.commit_import_batch(uuid) to authenticated;
grant execute on function public.approve_judgement(uuid,text,text) to authenticated;
grant execute on function public.bulk_prepare_gcat_items(uuid[],jsonb) to authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, public;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, public;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, public;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated;
