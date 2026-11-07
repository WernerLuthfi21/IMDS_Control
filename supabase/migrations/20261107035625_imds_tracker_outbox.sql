-- Durable outbound queue for the shared IMDS Part List master.
-- App edits and MD System imports are saved to Supabase first. Power Automate mirrors them to Excel.
create table if not exists public.imds_tracker_outbox (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  row_count integer not null default 0 check (row_count >= 0),
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  provider_response jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists imds_tracker_outbox_status_idx
  on public.imds_tracker_outbox(status, created_at);
create index if not exists imds_tracker_outbox_created_idx
  on public.imds_tracker_outbox(created_at desc);

alter table public.imds_tracker_outbox enable row level security;
grant select, insert, update on public.imds_tracker_outbox to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'imds_tracker_outbox'
      and policyname = 'imds_tracker_outbox_read_internal'
  ) then
    create policy imds_tracker_outbox_read_internal
      on public.imds_tracker_outbox for select to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'imds_tracker_outbox'
      and policyname = 'imds_tracker_outbox_insert_internal'
  ) then
    create policy imds_tracker_outbox_insert_internal
      on public.imds_tracker_outbox for insert to authenticated
      with check (created_by = auth.uid() and public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'imds_tracker_outbox'
      and policyname = 'imds_tracker_outbox_update_internal'
  ) then
    create policy imds_tracker_outbox_update_internal
      on public.imds_tracker_outbox for update to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
      with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'imds_tracker_outbox_updated_at'
      and tgrelid = 'public.imds_tracker_outbox'::regclass
  ) then
    create trigger imds_tracker_outbox_updated_at
      before update on public.imds_tracker_outbox
      for each row execute procedure public.set_updated_at();
  end if;
end $$;
