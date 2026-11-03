-- Keep helper functions callable by RLS, but do not grant them SECURITY DEFINER powers.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security invoker
set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.has_any_role(roles public.app_role[])
returns boolean
language sql
stable
security invoker
set search_path = public
as $$ select coalesce(public.current_app_role() = any(roles), false) $$;

revoke all on function public.current_app_role() from public, anon;
revoke all on function public.has_any_role(public.app_role[]) from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_any_role(public.app_role[]) to authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
