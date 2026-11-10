-- Shared, versioned settings for the IMDS Tracker (Directory contacts and follow-up configuration).
-- Additive only: one new table, no data is changed or removed.
create table if not exists public.imds_tracker_settings (
  key text primary key check (key in ('directory','followup_config')),
  value jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version >= 1),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.imds_tracker_settings enable row level security;
grant select, insert, update on public.imds_tracker_settings to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_tracker_settings' and policyname='imds_tracker_settings_read') then
    create policy imds_tracker_settings_read on public.imds_tracker_settings for select to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_tracker_settings' and policyname='imds_tracker_settings_insert') then
    create policy imds_tracker_settings_insert on public.imds_tracker_settings for insert to authenticated
      with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_tracker_settings' and policyname='imds_tracker_settings_update') then
    create policy imds_tracker_settings_update on public.imds_tracker_settings for update to authenticated
      using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
      with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
end $$;
