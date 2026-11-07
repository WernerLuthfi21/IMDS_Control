-- Access requests (supplier self-request, TMMIN staff registering staff), approval PIC list, and abuse throttling.
-- Additive only. Writes happen through server routes (service role, server-only); the browser never writes these tables.
create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('supplier','tmmin','password_help')),
  via text not null default 'PUBLIC' check (via in ('PUBLIC','STAFF')),
  full_name text not null check (char_length(full_name) between 2 and 80),
  company text check (char_length(company) <= 120),
  supplier_code text check (supplier_code ~ '^[A-Z0-9_-]{1,20}$'),
  email text not null check (char_length(email) <= 254),
  requested_role text,
  note text check (char_length(note) <= 300),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  contact_matched boolean not null default false,
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  granted_role text,
  notification_status text,
  created_at timestamptz not null default now()
);
create unique index if not exists access_requests_one_pending_per_email
  on public.access_requests (lower(email), kind) where status = 'PENDING';
create index if not exists access_requests_status_idx on public.access_requests (status, created_at desc);

alter table public.access_requests enable row level security;
create policy "access_requests_read_admin" on public.access_requests for select to authenticated
using (public.has_any_role(array['admin']::public.app_role[]));
create policy "access_requests_read_own_staff_requests" on public.access_requests for select to authenticated
using (requested_by = auth.uid());

create table if not exists public.approval_recipients (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists approval_recipients_email_uq on public.approval_recipients (lower(email));
alter table public.approval_recipients enable row level security;
create policy "approval_recipients_admin_all" on public.approval_recipients for all to authenticated
using (public.has_any_role(array['admin']::public.app_role[]))
with check (public.has_any_role(array['admin']::public.app_role[]));

-- Server-only rate-limit ledger (hashed keys, no raw IP/e-mail). No policies: only the service role can touch it.
create table if not exists public.security_throttle (
  id bigserial primary key,
  bucket text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists security_throttle_lookup on public.security_throttle (bucket, key_hash, created_at desc);
alter table public.security_throttle enable row level security;
