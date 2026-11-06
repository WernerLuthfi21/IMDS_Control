-- Controlled account requests and configurable administrator approval routing.
create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('SUPPLIER','TMMIN_STAFF')),
  requester_id uuid references auth.users(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  company_name text not null,
  target_name text not null,
  target_email text not null,
  requested_role public.app_role not null default 'supplier',
  supplier_code text,
  note text,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  provisioned_user_id uuid references auth.users(id),
  request_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_requests_email_normalized check (target_email = lower(trim(target_email)))
);
create index if not exists access_requests_queue_idx on public.access_requests(status, created_at desc);
create index if not exists access_requests_requester_idx on public.access_requests(requester_id, created_at desc);
create unique index if not exists access_requests_pending_email_idx
  on public.access_requests(lower(target_email)) where status = 'PENDING';

create trigger access_requests_updated_at before update on public.access_requests
for each row execute procedure public.set_updated_at();

create table if not exists public.access_approval_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email))),
  display_name text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger access_approval_recipients_updated_at before update on public.access_approval_recipients
for each row execute procedure public.set_updated_at();

alter table public.access_requests enable row level security;
alter table public.access_approval_recipients enable row level security;

grant select, insert, update on public.access_requests to authenticated;
grant select, insert, update, delete on public.access_approval_recipients to authenticated;

create policy "access_requests_read_own_or_admin" on public.access_requests
for select to authenticated using (
  requester_id = auth.uid() or public.has_any_role(array['admin']::public.app_role[])
);
create policy "access_requests_insert_internal_staff" on public.access_requests
for insert to authenticated with check (
  requester_id = auth.uid()
  and request_type = 'TMMIN_STAFF'
  and requested_role = 'viewer'
  and public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[])
);
create policy "access_requests_update_admin" on public.access_requests
for update to authenticated using (public.has_any_role(array['admin']::public.app_role[]))
with check (public.has_any_role(array['admin']::public.app_role[]));

create policy "access_recipients_admin_only" on public.access_approval_recipients
for all to authenticated using (public.has_any_role(array['admin']::public.app_role[]))
with check (public.has_any_role(array['admin']::public.app_role[]));

-- Public supplier intake is narrowly scoped to one fixed request type and cannot grant access.
-- The function stores a hash of the originating IP for rate limiting, never the raw address.
create or replace function public.submit_supplier_access_request(
  p_full_name text,
  p_company text,
  p_email text,
  p_supplier_code text default null,
  p_note text default null,
  p_ip text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip_hash text := encode(digest(coalesce(nullif(trim(p_ip), ''), 'unknown'), 'sha256'), 'hex');
  v_id uuid;
  v_name text := trim(regexp_replace(coalesce(p_full_name, ''), '\\s+', ' ', 'g'));
  v_company text := trim(regexp_replace(coalesce(p_company, ''), '\\s+', ' ', 'g'));
  v_code text := upper(trim(coalesce(p_supplier_code, '')));
  v_note text := left(trim(coalesce(p_note, '')), 1000);
begin
  if length(v_name) < 2 or length(v_name) > 100 then raise exception 'INVALID_NAME'; end if;
  if length(v_company) < 2 or length(v_company) > 120 then raise exception 'INVALID_COMPANY'; end if;
  if length(v_email) > 254 or v_email !~* '^[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}$' then raise exception 'INVALID_EMAIL'; end if;
  if v_code <> '' and v_code !~ '^[A-Z0-9_-]{1,20}$' then raise exception 'INVALID_SUPPLIER_CODE'; end if;
  if (select count(*) from public.access_requests where request_ip_hash = v_ip_hash and created_at > now() - interval '1 hour') >= 5 then raise exception 'RATE_LIMITED'; end if;
  if (select count(*) from public.access_requests where target_email = v_email and created_at > now() - interval '24 hours') >= 3 then raise exception 'RATE_LIMITED'; end if;
  if exists (select 1 from public.access_requests where target_email = v_email and status = 'PENDING') then raise exception 'REQUEST_ALREADY_PENDING'; end if;

  insert into public.access_requests(
    request_type, requester_name, requester_email, company_name,
    target_name, target_email, requested_role, supplier_code, note, request_ip_hash
  ) values (
    'SUPPLIER', v_name, v_email, v_company, v_name, v_email,
    'supplier'::public.app_role, nullif(v_code, ''), v_note, v_ip_hash
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_supplier_access_request(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_supplier_access_request(text,text,text,text,text,text) to anon, authenticated;
