-- IMDS Intelligence Control Center — initial PostgreSQL schema
-- All final decisions remain human-approved. Do not weaken RLS for convenience.
create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','rule_author','rule_approver','preparer','reviewer','viewer','supplier');
create type public.import_status as enum ('STAGED','VALIDATING','COMMITTED','FAILED','ROLLED_BACK');
create type public.final_decision as enum ('PENDING','FINAL_OK','FINAL_NG');

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,email,display_name,role)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',''), 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.has_any_role(roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = any(roles), false)
$$;

create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_hash text not null,
  storage_path text,
  classification text not null check (classification in ('PROTECTED','INTERNAL','PUBLIC','CONFIDENTIAL','UNKNOWN')),
  processing_allowed boolean not null default false,
  source_version text,
  source_type text,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(file_hash)
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source_file_hash text not null,
  source_sheet text not null,
  header_row integer not null,
  total_rows integer not null default 0,
  committed_rows integer not null default 0,
  status public.import_status not null default 'STAGED',
  validation_errors jsonb,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid not null references auth.users(id),
  committed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists import_batches_uploader_idx on public.import_batches(uploaded_by, created_at desc);

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  source_sheet text not null,
  source_row integer not null,
  source_case_code text not null,
  row_data jsonb not null,
  normalized jsonb not null default '{}'::jsonb,
  validation_state text not null default 'PENDING',
  validation_messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(batch_id, source_sheet, source_row)
);
create index if not exists import_rows_batch_idx on public.import_rows(batch_id, source_row);

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  part_number text not null,
  supplier_code text,
  supplier_name text,
  part_name text,
  business_entity text,
  model_code text,
  source_document_id uuid references public.source_documents(id),
  source_sheet text,
  source_row integer,
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(part_number, supplier_code, business_entity)
);
create trigger parts_updated_at before update on public.parts for each row execute procedure public.set_updated_at();

create table if not exists public.gcat_cases (
  id uuid primary key default gen_random_uuid(),
  source_case_code text not null unique,
  part_id uuid references public.parts(id),
  business_entity text,
  company_name text,
  supplier_code text,
  delivery_part_no text,
  module_id text,
  workflow_status text not null default 'NEW',
  final_decision public.final_decision not null default 'PENDING',
  source_batch_id uuid references public.import_batches(id),
  source_sheet text,
  source_row integer,
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger gcat_cases_updated_at before update on public.gcat_cases for each row execute procedure public.set_updated_at();
create index if not exists gcat_cases_part_idx on public.gcat_cases(delivery_part_no);
create index if not exists gcat_cases_supplier_idx on public.gcat_cases(supplier_code);
create index if not exists gcat_cases_status_idx on public.gcat_cases(workflow_status);

create table if not exists public.gcat_error_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.gcat_cases(id) on delete cascade,
  source_record_key text not null unique,
  source_batch_id uuid references public.import_batches(id),
  source_sheet text,
  source_row integer,
  error_type_label text not null,
  approved_error_type_id text,
  delivery_part_no text,
  supplier_code text,
  cas_no text,
  substance_name text,
  judge_status text,
  last_comment text,
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists gcat_error_items_error_type_idx on public.gcat_error_items(error_type_label);
create index if not exists gcat_error_items_cas_idx on public.gcat_error_items(cas_no);

create table if not exists public.rule_definitions (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null unique,
  error_type_label text,
  title text not null,
  description text,
  status text not null default 'DRAFT',
  owner_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger rule_definitions_updated_at before update on public.rule_definitions for each row execute procedure public.set_updated_at();

create table if not exists public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.rule_definitions(id) on delete cascade,
  version text not null,
  source_version text,
  effective_from date,
  effective_to date,
  approval_status text not null default 'DRAFT',
  source_references jsonb not null default '[]'::jsonb,
  rule_payload jsonb not null default '{}'::jsonb,
  authored_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(rule_id,version)
);

create table if not exists public.judgement_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.gcat_cases(id) on delete cascade,
  error_type_label text not null,
  rule_id text not null,
  rule_status text not null,
  recommendation text not null,
  final_decision public.final_decision not null default 'PENDING',
  reason text not null,
  input_snapshot jsonb not null default '{}'::jsonb,
  evaluation_trace jsonb not null default '[]'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  manual_tasks jsonb not null default '[]'::jsonb,
  reviewer_override_reason text,
  prepared_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists judgement_runs_case_idx on public.judgement_runs(case_id, created_at desc);

create table if not exists public.verification_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.gcat_cases(id) on delete cascade,
  task_type text not null,
  title text not null,
  description text,
  assigned_to uuid references auth.users(id),
  external_party text,
  status text not null default 'OPEN',
  due_at timestamptz,
  completed_at timestamptz,
  evidence_requirements jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger verification_tasks_updated_at before update on public.verification_tasks for each row execute procedure public.set_updated_at();

create table if not exists public.confirmations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.gcat_cases(id) on delete cascade,
  task_id uuid references public.verification_tasks(id) on delete set null,
  party_type text not null check (party_type in ('SUPPLIER','PURCHASING','TMA','TMC','TMC_KM','OTHER')),
  request_text text not null,
  response_text text,
  response_at timestamptz,
  validated_by uuid references auth.users(id),
  status text not null default 'WAITING',
  source_reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.gcat_cases(id) on delete cascade,
  task_id uuid references public.verification_tasks(id) on delete set null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_hash text,
  source_document_id uuid references public.source_documents(id),
  source_page integer,
  source_sheet text,
  source_row integer,
  classification text not null default 'PROTECTED' check (classification in ('PROTECTED','INTERNAL','PUBLIC','CONFIDENTIAL','UNKNOWN')),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  judgement_run_id uuid not null references public.judgement_runs(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  decision text not null check (decision in ('FINAL_OK','FINAL_NG')),
  comment text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_entity_idx on public.audit_events(entity_type,entity_id,created_at desc);

create table if not exists public.reference_substances (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_version text,
  source_row integer,
  cas_original text,
  cas_normalized text,
  substance_name text,
  classification text,
  reason_code text,
  source_description text,
  reporting_threshold text,
  raw_record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists reference_substances_cas_idx on public.reference_substances(cas_normalized);

create table if not exists public.mass_tolerance_ranges (
  id uuid primary key default gen_random_uuid(),
  source_version text not null,
  source_row integer not null,
  min_raw text not null,
  max_raw text not null,
  tolerance_values jsonb not null,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique(source_version,source_row)
);

-- Basic RLS. No anonymous access. Roles are assigned by an administrator after account provisioning.
alter table public.profiles enable row level security;
alter table public.source_documents enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.parts enable row level security;
alter table public.gcat_cases enable row level security;
alter table public.gcat_error_items enable row level security;
alter table public.rule_definitions enable row level security;
alter table public.rule_versions enable row level security;
alter table public.judgement_runs enable row level security;
alter table public.verification_tasks enable row level security;
alter table public.confirmations enable row level security;
alter table public.evidence enable row level security;
alter table public.approvals enable row level security;
alter table public.audit_events enable row level security;
alter table public.reference_substances enable row level security;
alter table public.mass_tolerance_ranges enable row level security;

create policy "profiles_select_self_or_admin" on public.profiles for select to authenticated using (id=auth.uid() or public.has_any_role(array['admin']::public.app_role[]));
create policy "profiles_update_admin" on public.profiles for update to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));

create policy "source_documents_read_auth" on public.source_documents for select to authenticated using (public.has_any_role(array['admin','rule_author','rule_approver','preparer','reviewer','viewer']::public.app_role[]));
create policy "source_documents_insert_preparer" on public.source_documents for insert to authenticated with check (public.has_any_role(array['admin','preparer']::public.app_role[]) and classification <> 'CONFIDENTIAL' and processing_allowed = true);

create policy "import_batches_read_owner_or_admin" on public.import_batches for select to authenticated using (uploaded_by=auth.uid() or public.has_any_role(array['admin','reviewer']::public.app_role[]));
create policy "import_batches_insert_preparer" on public.import_batches for insert to authenticated with check (uploaded_by=auth.uid() and public.has_any_role(array['admin','preparer']::public.app_role[]));
create policy "import_batches_update_owner_or_admin" on public.import_batches for update to authenticated using (uploaded_by=auth.uid() or public.has_any_role(array['admin']::public.app_role[])) with check (uploaded_by=auth.uid() or public.has_any_role(array['admin']::public.app_role[]));
create policy "import_rows_read_owner_or_admin" on public.import_rows for select to authenticated using (exists(select 1 from public.import_batches b where b.id=batch_id and (b.uploaded_by=auth.uid() or public.has_any_role(array['admin','reviewer']::public.app_role[]))));
create policy "import_rows_insert_owner" on public.import_rows for insert to authenticated with check (exists(select 1 from public.import_batches b where b.id=batch_id and b.uploaded_by=auth.uid()));

create policy "parts_read_internal" on public.parts for select to authenticated using (public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]));
create policy "parts_write_preparer" on public.parts for all to authenticated using (public.has_any_role(array['admin','preparer']::public.app_role[])) with check (public.has_any_role(array['admin','preparer']::public.app_role[]));
create policy "cases_read_internal" on public.gcat_cases for select to authenticated using (public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]));
create policy "cases_write_preparer" on public.gcat_cases for all to authenticated using (public.has_any_role(array['admin','preparer']::public.app_role[])) with check (public.has_any_role(array['admin','preparer']::public.app_role[]));
create policy "items_read_internal" on public.gcat_error_items for select to authenticated using (public.has_any_role(array['admin','preparer','reviewer','viewer','rule_author','rule_approver']::public.app_role[]));
create policy "items_write_preparer" on public.gcat_error_items for all to authenticated using (public.has_any_role(array['admin','preparer']::public.app_role[])) with check (public.has_any_role(array['admin','preparer']::public.app_role[]));

create policy "rules_read_auth" on public.rule_definitions for select to authenticated using (true);
create policy "rules_author_write" on public.rule_definitions for all to authenticated using (public.has_any_role(array['admin','rule_author']::public.app_role[])) with check (public.has_any_role(array['admin','rule_author']::public.app_role[]));
create policy "rule_versions_read_auth" on public.rule_versions for select to authenticated using (true);
create policy "rule_versions_author_insert" on public.rule_versions for insert to authenticated with check (public.has_any_role(array['admin','rule_author']::public.app_role[]));
create policy "rule_versions_approver_update" on public.rule_versions for update to authenticated using (public.has_any_role(array['admin','rule_approver']::public.app_role[])) with check (public.has_any_role(array['admin','rule_approver']::public.app_role[]));

create policy "judgement_runs_read_auth" on public.judgement_runs for select to authenticated using (true);
create policy "judgement_runs_insert_preparer" on public.judgement_runs for insert to authenticated with check (prepared_by=auth.uid() or prepared_by is null);
create policy "judgement_runs_update_reviewer" on public.judgement_runs for update to authenticated using (public.has_any_role(array['admin','reviewer']::public.app_role[])) with check (public.has_any_role(array['admin','reviewer']::public.app_role[]));

create policy "tasks_read_auth" on public.verification_tasks for select to authenticated using (true);
create policy "tasks_write_preparer" on public.verification_tasks for all to authenticated using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[])) with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
create policy "confirmations_read_auth" on public.confirmations for select to authenticated using (true);
create policy "confirmations_write_preparer" on public.confirmations for all to authenticated using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[])) with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
create policy "evidence_read_owner_or_reviewer" on public.evidence for select to authenticated using (uploaded_by=auth.uid() or public.has_any_role(array['admin','reviewer','rule_approver']::public.app_role[]));
create policy "evidence_insert_auth" on public.evidence for insert to authenticated with check (uploaded_by=auth.uid() and classification in ('PROTECTED','INTERNAL','PUBLIC') and public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
create policy "evidence_delete_admin" on public.evidence for delete to authenticated using (public.has_any_role(array['admin']::public.app_role[]));

create policy "approvals_read_auth" on public.approvals for select to authenticated using (true);
create policy "approvals_insert_reviewer" on public.approvals for insert to authenticated with check (reviewer_id=auth.uid() and public.has_any_role(array['admin','rule_approver','reviewer']::public.app_role[]));
create policy "audit_read_admin_reviewer" on public.audit_events for select to authenticated using (public.has_any_role(array['admin','reviewer','rule_approver']::public.app_role[]));
create policy "audit_insert_auth" on public.audit_events for insert to authenticated with check (actor_id is null or actor_id=auth.uid());

create policy "reference_read_auth" on public.reference_substances for select to authenticated using (true);
create policy "reference_admin_write" on public.reference_substances for all to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));
create policy "mass_ranges_read_auth" on public.mass_tolerance_ranges for select to authenticated using (true);
create policy "mass_ranges_admin_write" on public.mass_tolerance_ranges for all to authenticated using (public.has_any_role(array['admin']::public.app_role[])) with check (public.has_any_role(array['admin']::public.app_role[]));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('evidence-private','evidence-private',false,20971520,array['application/pdf','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;
create policy "evidence_bucket_read_owner_or_reviewer" on storage.objects for select to authenticated using (bucket_id='evidence-private' and ((storage.foldername(name))[1]=auth.uid()::text or public.has_any_role(array['admin','reviewer','rule_approver']::public.app_role[])));
create policy "evidence_bucket_upload_authenticated" on storage.objects for insert to authenticated with check (bucket_id='evidence-private' and (storage.foldername(name))[1]=auth.uid()::text and public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
create policy "evidence_bucket_delete_admin" on storage.objects for delete to authenticated using (bucket_id='evidence-private' and public.has_any_role(array['admin']::public.app_role[]));

-- Finalization is deliberately server-side, role-gated and restricted to owner-approved rules.
create or replace function public.approve_judgement(p_run_id uuid, p_decision text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.judgement_runs%rowtype;
  v_role public.app_role;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','reviewer','rule_approver') then
    raise exception 'Reviewer or rule approver role is required';
  end if;
  if p_decision not in ('FINAL_OK','FINAL_NG') then raise exception 'Invalid final decision'; end if;
  if length(trim(coalesce(p_comment,''))) < 8 then raise exception 'Reviewer comment is required'; end if;
  select * into v_run from public.judgement_runs where id = p_run_id for update;
  if not found then raise exception 'Judgement run not found'; end if;
  if v_run.final_decision <> 'PENDING' then raise exception 'Judgement is already finalized'; end if;
  if v_run.rule_status not in ('APPROVED','ACTIVE') then raise exception 'Rule version is not owner-approved for finalization'; end if;
  if p_decision = 'FINAL_OK' and v_run.recommendation <> 'RECOMMEND_OK' then raise exception 'Final OK requires a RECOMMEND_OK result'; end if;
  if p_decision = 'FINAL_NG' and v_run.recommendation <> 'RECOMMEND_NG' then raise exception 'Final NG requires a RECOMMEND_NG result'; end if;
  insert into public.approvals(judgement_run_id, reviewer_id, decision, comment)
  values(p_run_id, auth.uid(), p_decision, trim(p_comment));
  update public.judgement_runs set final_decision = p_decision::public.final_decision, approved_by = auth.uid(), approved_at = now()
  where id = p_run_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, metadata)
  values(auth.uid(), 'JUDGEMENT_FINALIZED', 'judgement_run', p_run_id, jsonb_build_object('decision',p_decision));
  return jsonb_build_object('id',p_run_id,'decision',p_decision,'approvedBy',auth.uid(),'approvedAt',now());
end;
$$;
revoke all on function public.approve_judgement(uuid,text,text) from public;
grant execute on function public.approve_judgement(uuid,text,text) to authenticated;

-- Private, short-lived bucket for direct-to-storage workbook uploads (avoids serverless body-size limits).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('import-staging','import-staging',false,20971520,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;
create policy "import_staging_insert_own_folder" on storage.objects for insert to authenticated
with check (bucket_id='import-staging' and (storage.foldername(name))[1]=auth.uid()::text and public.has_any_role(array['admin','preparer']::public.app_role[]));
create policy "import_staging_read_own_folder" on storage.objects for select to authenticated
using (bucket_id='import-staging' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "import_staging_delete_own_folder" on storage.objects for delete to authenticated
using (bucket_id='import-staging' and (storage.foldername(name))[1]=auth.uid()::text);

-- Single-transaction, idempotent commit of a staged workbook batch.
create or replace function public.commit_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.import_batches%rowtype;
  v_role public.app_role;
  v_case record;
  v_row public.import_rows%rowtype;
  v_part_id uuid;
  v_case_id uuid;
  v_cases integer := 0;
  v_items integer := 0;
  v_source_key text;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if v_role is null or v_role not in ('admin','preparer') then raise exception 'Preparer or admin role is required'; end if;
  select * into v_batch from public.import_batches where id=p_batch_id and uploaded_by=auth.uid() for update;
  if not found then raise exception 'Import batch not found or not owned by current user'; end if;
  if v_batch.status <> 'STAGED' then raise exception 'Only STAGED batches may be committed'; end if;
  if coalesce(v_batch.metadata->>'classification','UNKNOWN') not in ('PROTECTED','INTERNAL','PUBLIC') then raise exception 'Batch classification is not allowed'; end if;

  for v_case in
    select source_case_code,
           (array_agg(normalized order by source_row))[1] as normalized,
           (array_agg(source_sheet order by source_row))[1] as source_sheet,
           (array_agg(source_row order by source_row))[1] as source_row,
           (array_agg(row_data order by source_row))[1] as row_data
    from public.import_rows where batch_id=p_batch_id group by source_case_code
  loop
    v_part_id := null;
    if nullif(v_case.normalized->>'deliveryPartNo','') is not null then
      insert into public.parts(part_number,supplier_code,supplier_name,business_entity,source_sheet,source_row,raw_source)
      values(v_case.normalized->>'deliveryPartNo',nullif(v_case.normalized->>'supplierCode',''),nullif(v_case.normalized->>'companyName',''),nullif(v_case.normalized->>'businessEntity',''),v_case.source_sheet,v_case.source_row,v_case.row_data)
      on conflict (part_number,supplier_code,business_entity) do update set
        supplier_name=excluded.supplier_name,source_sheet=excluded.source_sheet,source_row=excluded.source_row,raw_source=excluded.raw_source,updated_at=now()
      returning id into v_part_id;
    end if;
    insert into public.gcat_cases(source_case_code,part_id,business_entity,company_name,supplier_code,delivery_part_no,module_id,source_batch_id,source_sheet,source_row,raw_source)
    values(v_case.source_case_code,v_part_id,nullif(v_case.normalized->>'businessEntity',''),nullif(v_case.normalized->>'companyName',''),nullif(v_case.normalized->>'supplierCode',''),nullif(v_case.normalized->>'deliveryPartNo',''),nullif(v_case.normalized->>'moduleId',''),p_batch_id,v_case.source_sheet,v_case.source_row,v_case.row_data)
    on conflict (source_case_code) do update set part_id=excluded.part_id,business_entity=excluded.business_entity,company_name=excluded.company_name,supplier_code=excluded.supplier_code,delivery_part_no=excluded.delivery_part_no,module_id=excluded.module_id,source_batch_id=excluded.source_batch_id,source_sheet=excluded.source_sheet,source_row=excluded.source_row,raw_source=excluded.raw_source,updated_at=now()
    returning id into v_case_id;
    v_cases := v_cases + 1;

    for v_row in select * from public.import_rows where batch_id=p_batch_id and source_case_code=v_case.source_case_code order by source_row loop
      v_source_key := v_batch.source_file_hash || ':' || v_row.source_sheet || ':' || v_row.source_row::text;
      insert into public.gcat_error_items(case_id,source_record_key,source_batch_id,source_sheet,source_row,error_type_label,delivery_part_no,supplier_code,cas_no,substance_name,judge_status,last_comment,raw_source)
      values(v_case_id,v_source_key,p_batch_id,v_row.source_sheet,v_row.source_row,coalesce(nullif(v_row.normalized->>'errorType',''),'(blank)'),nullif(v_row.normalized->>'deliveryPartNo',''),nullif(v_row.normalized->>'supplierCode',''),nullif(v_row.normalized->>'casNo',''),nullif(v_row.normalized->>'substanceName',''),nullif(v_row.normalized->>'judge',''),nullif(v_row.normalized->>'comment',''),v_row.row_data)
      on conflict (source_record_key) do update set case_id=excluded.case_id,source_batch_id=excluded.source_batch_id,error_type_label=excluded.error_type_label,delivery_part_no=excluded.delivery_part_no,supplier_code=excluded.supplier_code,cas_no=excluded.cas_no,substance_name=excluded.substance_name,judge_status=excluded.judge_status,last_comment=excluded.last_comment,raw_source=excluded.raw_source;
      v_items := v_items + 1;
    end loop;
  end loop;
  update public.import_batches set status='COMMITTED',committed_rows=v_items,committed_at=now() where id=p_batch_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'IMPORT_COMMITTED','import_batch',p_batch_id,jsonb_build_object('casesProcessed',v_cases,'itemsProcessed',v_items));
  return jsonb_build_object('batchId',p_batch_id,'casesProcessed',v_cases,'itemsProcessed',v_items,'status','COMMITTED');
end;
$$;
revoke all on function public.commit_import_batch(uuid) from public;
grant execute on function public.commit_import_batch(uuid) to authenticated;
