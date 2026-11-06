-- Cloud-backed IMDS master tracker. This migration is intentionally idempotent:
-- the production database already contains these tables; this brings fresh environments
-- into the same shape without replacing or deleting any user data.
create table if not exists public.imds_master_parts (
  id uuid primary key default gen_random_uuid(),
  master_key text not null unique,
  project text,
  vendor_code text,
  main_pic_email text,
  company_name text,
  part_name text,
  part_no text,
  part_no_norm text,
  submission_plan date,
  imds_status text,
  imds_id_version text,
  part_status text,
  have_respond_email text,
  status_update text,
  md_id_version text,
  md_status_update_date date,
  comment text,
  lpop_confirmation text,
  cek text,
  md_system_records jsonb not null default '[]'::jsonb,
  md_system_updated_at timestamptz,
  extra_fields jsonb not null default '{}'::jsonb,
  manual_overrides text[] not null default '{}',
  source_file_name text,
  source_file_hash text,
  source_sheet text,
  source_row integer,
  last_imported_at timestamptz,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  supplier_promise_date date,
  supplier_promise_updated_at timestamptz
);

create index if not exists imds_master_part_no_norm_idx on public.imds_master_parts(part_no_norm);
create index if not exists imds_master_project_idx on public.imds_master_parts(project);
create index if not exists imds_master_status_idx on public.imds_master_parts(imds_status);
create index if not exists imds_master_supplier_idx on public.imds_master_parts(company_name);
create index if not exists imds_master_updated_idx on public.imds_master_parts(updated_at desc);
create index if not exists imds_master_supplier_promise_idx on public.imds_master_parts(supplier_promise_date) where supplier_promise_date is not null;

create table if not exists public.imds_master_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source_file_hash text not null,
  source_sheet text not null,
  total_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  skipped_rows integer not null default 0,
  uploaded_by uuid not null references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists imds_master_import_batches_created_idx on public.imds_master_import_batches(created_at desc);

create table if not exists public.imds_mds_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source_file_hash text not null,
  source_sheet text not null,
  total_rows integer not null default 0,
  matched_master_rows integer not null default 0,
  unmatched_part_numbers integer not null default 0,
  uploaded_by uuid not null references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists imds_mds_import_batches_created_idx on public.imds_mds_import_batches(created_at desc);

create table if not exists public.imds_mds_search_results (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.imds_mds_import_batches(id) on delete cascade,
  part_no text not null,
  part_no_norm text not null,
  md_supplier_code text,
  from_company text,
  result_data jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);
create index if not exists imds_mds_search_batch_idx on public.imds_mds_search_results(batch_id);
create index if not exists imds_mds_search_part_idx on public.imds_mds_search_results(part_no_norm, imported_at desc);

create table if not exists public.imds_tracker_followup_logs (
  id uuid primary key default gen_random_uuid(),
  supplier_code text,
  supplier_name text not null,
  recipient_email text not null,
  cc_emails text[] not null default '{}',
  subject text not null,
  message_body text not null,
  part_count integer not null default 0,
  attachment_name text,
  status text not null default 'PREPARED' check (status in ('PREPARED','SENT','FAILED')),
  provider_response jsonb not null default '{}'::jsonb,
  error_message text,
  sent_by uuid references auth.users(id),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists imds_tracker_followup_logs_created_idx on public.imds_tracker_followup_logs(created_at desc);
create index if not exists imds_tracker_followup_logs_supplier_idx on public.imds_tracker_followup_logs(supplier_code, created_at desc);

-- Keep existing manual edits protected from source refreshes. Internal workspace only.
alter table public.imds_master_parts enable row level security;
alter table public.imds_master_import_batches enable row level security;
alter table public.imds_mds_import_batches enable row level security;
alter table public.imds_mds_search_results enable row level security;
alter table public.imds_tracker_followup_logs enable row level security;

grant select, insert, update on public.imds_master_parts to authenticated;
grant select, insert on public.imds_master_import_batches to authenticated;
grant select, insert on public.imds_mds_import_batches to authenticated;
grant select, insert on public.imds_mds_search_results to authenticated;
grant select, insert, update on public.imds_tracker_followup_logs to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_master_parts' and policyname='imds_master_parts_read_internal') then
    create policy imds_master_parts_read_internal on public.imds_master_parts for select to authenticated
    using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_master_parts' and policyname='imds_master_parts_write_internal') then
    create policy imds_master_parts_write_internal on public.imds_master_parts for all to authenticated
    using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
    with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_master_import_batches' and policyname='imds_master_import_batches_read_internal') then
    create policy imds_master_import_batches_read_internal on public.imds_master_import_batches for select to authenticated
    using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_master_import_batches' and policyname='imds_master_import_batches_insert_internal') then
    create policy imds_master_import_batches_insert_internal on public.imds_master_import_batches for insert to authenticated
    with check (uploaded_by = auth.uid() and public.has_any_role(array['admin','preparer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_mds_import_batches' and policyname='imds_mds_import_batches_read_internal') then
    create policy imds_mds_import_batches_read_internal on public.imds_mds_import_batches for select to authenticated
    using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_mds_import_batches' and policyname='imds_mds_import_batches_insert_internal') then
    create policy imds_mds_import_batches_insert_internal on public.imds_mds_import_batches for insert to authenticated
    with check (uploaded_by = auth.uid() and public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_mds_search_results' and policyname='imds_mds_search_results_read_internal') then
    create policy imds_mds_search_results_read_internal on public.imds_mds_search_results for select to authenticated
    using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_mds_search_results' and policyname='imds_mds_search_results_insert_internal') then
    create policy imds_mds_search_results_insert_internal on public.imds_mds_search_results for insert to authenticated
    with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_tracker_followup_logs' and policyname='imds_tracker_followup_logs_read_internal') then
    create policy imds_tracker_followup_logs_read_internal on public.imds_tracker_followup_logs for select to authenticated
    using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='imds_tracker_followup_logs' and policyname='imds_tracker_followup_logs_write_internal') then
    create policy imds_tracker_followup_logs_write_internal on public.imds_tracker_followup_logs for all to authenticated
    using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
    with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='imds_master_parts_updated_at' and tgrelid='public.imds_master_parts'::regclass) then
    create trigger imds_master_parts_updated_at before update on public.imds_master_parts
    for each row execute procedure public.set_updated_at();
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='imds_master_parts') then
    alter publication supabase_realtime add table public.imds_master_parts;
  end if;
end $$;
