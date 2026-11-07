-- Shared IMDS Tracker master data and MD System import history.
-- Additive migration: existing tracker and Judgement Register data are untouched.

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
  updated_at timestamptz not null default now()
);

create index if not exists imds_master_project_idx on public.imds_master_parts(project);
create index if not exists imds_master_supplier_idx on public.imds_master_parts(company_name);
create index if not exists imds_master_part_no_norm_idx on public.imds_master_parts(part_no_norm);
create index if not exists imds_master_status_idx on public.imds_master_parts(imds_status);
create index if not exists imds_master_updated_idx on public.imds_master_parts(updated_at desc);
drop trigger if exists imds_master_parts_updated_at on public.imds_master_parts;
create trigger imds_master_parts_updated_at before update on public.imds_master_parts
for each row execute procedure public.set_updated_at();

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
create index if not exists imds_master_import_batches_created_idx
on public.imds_master_import_batches(created_at desc);

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
create index if not exists imds_mds_import_batches_created_idx
on public.imds_mds_import_batches(created_at desc);

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
create index if not exists imds_mds_search_part_idx
on public.imds_mds_search_results(part_no_norm, imported_at desc);
create index if not exists imds_mds_search_batch_idx
on public.imds_mds_search_results(batch_id);

alter table public.imds_master_parts enable row level security;
alter table public.imds_master_import_batches enable row level security;
alter table public.imds_mds_import_batches enable row level security;
alter table public.imds_mds_search_results enable row level security;

drop policy if exists imds_master_parts_read_internal on public.imds_master_parts;
create policy imds_master_parts_read_internal on public.imds_master_parts
for select to authenticated
using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));

drop policy if exists imds_master_parts_write_internal on public.imds_master_parts;
create policy imds_master_parts_write_internal on public.imds_master_parts
for all to authenticated
using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));

drop policy if exists imds_master_import_batches_read_internal on public.imds_master_import_batches;
create policy imds_master_import_batches_read_internal on public.imds_master_import_batches
for select to authenticated
using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));

drop policy if exists imds_master_import_batches_insert_internal on public.imds_master_import_batches;
create policy imds_master_import_batches_insert_internal on public.imds_master_import_batches
for insert to authenticated
with check (uploaded_by = (select auth.uid()) and public.has_any_role(array['admin','preparer']::public.app_role[]));

drop policy if exists imds_mds_import_batches_read_internal on public.imds_mds_import_batches;
create policy imds_mds_import_batches_read_internal on public.imds_mds_import_batches
for select to authenticated
using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));

drop policy if exists imds_mds_import_batches_insert_internal on public.imds_mds_import_batches;
create policy imds_mds_import_batches_insert_internal on public.imds_mds_import_batches
for insert to authenticated
with check (uploaded_by = (select auth.uid()) and public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));

drop policy if exists imds_mds_search_results_read_internal on public.imds_mds_search_results;
create policy imds_mds_search_results_read_internal on public.imds_mds_search_results
for select to authenticated
using (public.has_any_role(array['admin','preparer','reviewer','viewer']::public.app_role[]));

drop policy if exists imds_mds_search_results_insert_internal on public.imds_mds_search_results;
create policy imds_mds_search_results_insert_internal on public.imds_mds_search_results
for insert to authenticated
with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));

-- Supabase tightened Data API exposure defaults in 2026; opt in explicitly.
grant usage on schema public to authenticated;
grant select, insert, update on table public.imds_master_parts to authenticated;
grant select, insert on table public.imds_master_import_batches to authenticated;
grant select, insert on table public.imds_mds_import_batches to authenticated;
grant select, insert on table public.imds_mds_search_results to authenticated;

-- Enable Postgres Changes for near-real-time tracker refresh where publication is available.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'imds_master_parts'
     ) then
    execute 'alter publication supabase_realtime add table public.imds_master_parts';
  end if;
end $$;
