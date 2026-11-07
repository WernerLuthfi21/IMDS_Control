-- A supplier chooses a password when requesting access. The auth user is created BANNED (cannot sign in) and linked here;
-- the password is only ever stored hashed by Supabase Auth, never in this table.
alter table public.access_requests add column if not exists user_id uuid references auth.users(id) on delete set null;
