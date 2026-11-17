-- The e-mail center logs every prepared/sent/failed supplier e-mail in imds_tracker_followup_logs.
-- That table was created outside the migrations folder on some environments. This makes it exist
-- everywhere with the columns the app uses. If it already exists, nothing changes.
create table if not exists public.imds_tracker_followup_logs (
  id uuid primary key default gen_random_uuid(),
  supplier_code text,
  supplier_name text,
  recipient_email text,
  cc_emails text[] not null default '{}',
  subject text,
  message_body text,
  part_count integer not null default 0,
  attachment_name text,
  status text not null default 'PREPARED',
  error_message text,
  provider_response jsonb,
  sent_by uuid references auth.users(id),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists imds_tracker_followup_logs_supplier_idx on public.imds_tracker_followup_logs(supplier_name, sent_at desc);

alter table public.imds_tracker_followup_logs enable row level security;
grant select, insert, update on public.imds_tracker_followup_logs to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_tracker_followup_logs' and policyname='imds_tracker_followup_logs_read') then
    create policy imds_tracker_followup_logs_read on public.imds_tracker_followup_logs for select to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_tracker_followup_logs' and policyname='imds_tracker_followup_logs_write') then
    create policy imds_tracker_followup_logs_write on public.imds_tracker_followup_logs for insert to authenticated
      with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_tracker_followup_logs' and policyname='imds_tracker_followup_logs_update') then
    create policy imds_tracker_followup_logs_update on public.imds_tracker_followup_logs for update to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
      with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
end $$;
