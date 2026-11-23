-- Fix "stack depth limit exceeded" (SQLSTATE 54001, shown by Storage as "database error, code: 54001").
--
-- Cause: current_app_role() ran as SECURITY INVOKER and read public.profiles, whose SELECT policy calls
-- has_any_role() -> current_app_role() again. With Supabase's auth.uid() (not leakproof) Postgres evaluates the
-- policy on every profiles row first, so as soon as there is more than one profile the call loops until the stack
-- is exhausted. Every policy that uses has_any_role() (Storage uploads for imports, evidence, settings, …) failed
-- for users other than the first account.
--
-- Fix: the role lookup runs as the function owner, so reading the caller's own role does not go through RLS.
-- It still returns ONLY the caller's role (auth.uid()), takes no input that can widen it, has a fixed search_path,
-- and is not executable by anon. has_any_role() stays SECURITY INVOKER and calls it.
-- Safe to run more than once.

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select p.role from public.profiles p where p.id = auth.uid() $$;

create or replace function public.has_any_role(roles public.app_role[])
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$ select coalesce(public.current_app_role() = any(roles), false) $$;

revoke all on function public.current_app_role() from public, anon;
revoke all on function public.has_any_role(public.app_role[]) from public, anon;
grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.has_any_role(public.app_role[]) to authenticated, service_role;

notify pgrst, 'reload schema';
