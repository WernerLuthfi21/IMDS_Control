-- Judgement Register + supplier-side pre-check + controlled follow-up workflows.
-- The Excel master remains an import/export source; PostgreSQL is the editable operational register.

alter table public.profiles add column if not exists supplier_code text;

alter table public.gcat_error_items
  add column if not exists source_code text,
  add column if not exists source_year text,
  add column if not exists source_month text,
  add column if not exists source_status text,
  add column if not exists delivery_part_name text,
  add column if not exists assigned_person text,
  add column if not exists starting_date date,
  add column if not exists judgement_procedure text,
  add column if not exists judge text check (judge is null or judge in ('OK','NG')),
  add column if not exists ok_comment text,
  add column if not exists imds_reject_comment text,
  add column if not exists km_judge text check (km_judge is null or km_judge in ('OK','NG')),
  add column if not exists km_comment text,
  add column if not exists last_change_date timestamptz,
  add column if not exists source_first_seen_at timestamptz not null default now(),
  add column if not exists source_last_seen_at timestamptz not null default now(),
  add column if not exists source_hash text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists gcat_items_source_code_idx on public.gcat_error_items(source_code);
create index if not exists gcat_items_assigned_idx on public.gcat_error_items(assigned_person, starting_date);
create index if not exists gcat_items_judge_idx on public.gcat_error_items(judge, km_judge);
create index if not exists gcat_items_type_supplier_idx on public.gcat_error_items(error_type_label, supplier_code);
create trigger gcat_error_items_updated_at before update on public.gcat_error_items for each row execute procedure public.set_updated_at();

create table if not exists public.register_change_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.gcat_error_items(id) on delete cascade,
  actor_id uuid references auth.users(id),
  changed_columns text[] not null,
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists register_change_log_item_idx on public.register_change_log(item_id, created_at desc);

create table if not exists public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null,
  supplier_name text,
  contact_name text,
  email text not null,
  contact_role text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(supplier_code, email)
);
create index if not exists supplier_contacts_supplier_idx on public.supplier_contacts(supplier_code, active);
create trigger supplier_contacts_updated_at before update on public.supplier_contacts for each row execute procedure public.set_updated_at();

create table if not exists public.supplier_prechecks (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null,
  supplier_name text,
  delivery_part_no text not null,
  delivery_part_name text,
  mds_id text,
  mds_version text,
  mds_status text,
  preliminary_mds boolean,
  source_format text not null default 'MANUAL' check (source_format in ('MANUAL','XLSX','CSV','MDS_REPORT_PDF_ATTACHMENT')),
  attachment_path text,
  attachment_name text,
  submitted_by uuid references auth.users(id),
  workflow_status text not null default 'SUBMITTED' check (workflow_status in ('DRAFT','SUBMITTED','INTERNAL_REVIEW','NEED_SUPPLIER_ACTION','CLEARED_FOR_IMDS','REJECTED')),
  check_results jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists supplier_prechecks_supplier_idx on public.supplier_prechecks(supplier_code, created_at desc);
create index if not exists supplier_prechecks_part_idx on public.supplier_prechecks(delivery_part_no);
create trigger supplier_prechecks_updated_at before update on public.supplier_prechecks for each row execute procedure public.set_updated_at();

create table if not exists public.supplier_followups (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.gcat_error_items(id) on delete set null,
  supplier_code text not null,
  recipient_email text not null,
  cc_emails text[] not null default '{}',
  subject text not null,
  message_body text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','COMPOSED','SENT','CANCELLED')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  composed_at timestamptz,
  sent_at timestamptz
);
create index if not exists supplier_followups_supplier_idx on public.supplier_followups(supplier_code, created_at desc);

-- Do not allow a supplier account to read or change another supplier's submissions.
create policy "supplier_contacts_read_internal" on public.supplier_contacts for select to authenticated
using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
create policy "supplier_contacts_write_internal" on public.supplier_contacts for all to authenticated
using (public.has_any_role(array['admin','preparer']::public.app_role[]))
with check (public.has_any_role(array['admin','preparer']::public.app_role[]));

alter table public.supplier_prechecks enable row level security;
create policy "prechecks_read_internal_or_own_supplier" on public.supplier_prechecks for select to authenticated
using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]) or supplier_code=(select supplier_code from public.profiles where id=auth.uid()));
create policy "prechecks_insert_supplier_or_internal" on public.supplier_prechecks for insert to authenticated
with check ((public.has_any_role(array['admin','preparer']::public.app_role[])) or (public.has_any_role(array['supplier']::public.app_role[]) and supplier_code=(select supplier_code from public.profiles where id=auth.uid()) and submitted_by=auth.uid()));
create policy "prechecks_update_internal_or_own_draft" on public.supplier_prechecks for update to authenticated
using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]) or (public.has_any_role(array['supplier']::public.app_role[]) and supplier_code=(select supplier_code from public.profiles where id=auth.uid()) and workflow_status='DRAFT'))
with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]) or (public.has_any_role(array['supplier']::public.app_role[]) and supplier_code=(select supplier_code from public.profiles where id=auth.uid()) and workflow_status='DRAFT'));

alter table public.supplier_followups enable row level security;
create policy "followups_read_internal" on public.supplier_followups for select to authenticated
using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));
create policy "followups_write_internal" on public.supplier_followups for all to authenticated
using (public.has_any_role(array['admin','preparer']::public.app_role[]))
with check (public.has_any_role(array['admin','preparer']::public.app_role[]));

alter table public.register_change_log enable row level security;
create policy "register_log_read_reviewer_admin" on public.register_change_log for select to authenticated
using (public.has_any_role(array['admin','reviewer']::public.app_role[]));
create policy "register_log_insert_actor" on public.register_change_log for insert to authenticated
with check (actor_id=auth.uid() and public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));

-- Enforce TMA KM review permissions even if a client bypasses the page-level UI.
create or replace function public.guard_gcat_judgement_columns()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_role public.app_role;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if current_setting('app.gcat_import_batch', true) is not null then return new; end if;
  if (new.km_judge is distinct from old.km_judge or new.km_comment is distinct from old.km_comment)
     and coalesce(v_role,'viewer') not in ('admin','reviewer') then
    raise exception 'Only TMA reviewer or admin can update KM Judge and KM Comment';
  end if;
  if (new.assigned_person is distinct from old.assigned_person or new.starting_date is distinct from old.starting_date
      or new.judgement_procedure is distinct from old.judgement_procedure or new.judge is distinct from old.judge
      or new.ok_comment is distinct from old.ok_comment or new.imds_reject_comment is distinct from old.imds_reject_comment)
     and coalesce(v_role,'viewer') not in ('admin','preparer','reviewer') then
    raise exception 'Preparer, reviewer or admin role is required to update judgement fields';
  end if;
  if new.judge='OK' and nullif(trim(coalesce(new.ok_comment,'')),'') is null then
    raise exception 'OK requires the Record of changing to OK comment';
  end if;
  if new.judge='NG' and nullif(trim(coalesce(new.imds_reject_comment,'')),'') is null then
    raise exception 'NG requires an IMDS Reject comment';
  end if;
  return new;
end;
$$;
create trigger guard_gcat_judgement_columns before update on public.gcat_error_items for each row execute procedure public.guard_gcat_judgement_columns();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('supplier-precheck-private','supplier-precheck-private',false,20971520,array['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'])
on conflict (id) do nothing;
create policy "precheck_storage_upload_own_supplier" on storage.objects for insert to authenticated
with check (bucket_id='supplier-precheck-private' and (storage.foldername(name))[1]=auth.uid()::text and public.has_any_role(array['supplier','admin','preparer']::public.app_role[]));
create policy "precheck_storage_read_internal_or_owner" on storage.objects for select to authenticated
using (bucket_id='supplier-precheck-private' and ((storage.foldername(name))[1]=auth.uid()::text or public.has_any_role(array['admin','preparer','reviewer']::public.app_role[])));

-- Rebuild the import commit to use stable source code rather than the repeating daily sequence No.
-- Existing judgement fields are seeded on first import and never overwritten by a later daily refresh.
create or replace function public.commit_import_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_batch public.import_batches%rowtype;
  v_role public.app_role;
  v_case record;
  v_row public.import_rows%rowtype;
  v_part_id uuid;
  v_case_id uuid;
  v_cases integer:=0;
  v_items integer:=0;
  v_source_key text;
  v_rows jsonb;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if v_role is null or v_role not in ('admin','preparer') then raise exception 'Preparer or admin role is required'; end if;
  select * into v_batch from public.import_batches where id=p_batch_id and uploaded_by=auth.uid() for update;
  if not found then raise exception 'Import batch not found or not owned by current user'; end if;
  if v_batch.status<>'STAGED' then raise exception 'Only STAGED batches may be committed'; end if;
  if coalesce(v_batch.metadata->>'classification','UNKNOWN') not in ('PROTECTED','INTERNAL','PUBLIC') then raise exception 'Batch classification is not allowed'; end if;

  perform set_config('app.gcat_import_batch',p_batch_id::text,true);

  for v_case in
    select source_case_code,(array_agg(normalized order by source_row))[1] normalized,
      (array_agg(source_sheet order by source_row))[1] source_sheet,
      (array_agg(source_row order by source_row))[1] source_row,
      (array_agg(row_data order by source_row))[1] row_data
    from public.import_rows where batch_id=p_batch_id group by source_case_code
  loop
    v_part_id:=null;
    if nullif(v_case.normalized->>'deliveryPartNo','') is not null then
      insert into public.parts(part_number,supplier_code,supplier_name,business_entity,source_sheet,source_row,raw_source)
      values(v_case.normalized->>'deliveryPartNo',nullif(v_case.normalized->>'supplierCode',''),nullif(v_case.normalized->>'companyName',''),nullif(v_case.normalized->>'businessEntity',''),v_case.source_sheet,v_case.source_row,v_case.row_data)
      on conflict(part_number,supplier_code,business_entity) do update set supplier_name=excluded.supplier_name,source_sheet=excluded.source_sheet,source_row=excluded.source_row,raw_source=excluded.raw_source,updated_at=now()
      returning id into v_part_id;
    end if;
    insert into public.gcat_cases(source_case_code,part_id,business_entity,company_name,supplier_code,delivery_part_no,module_id,source_batch_id,source_sheet,source_row,raw_source)
    values(v_case.source_case_code,v_part_id,nullif(v_case.normalized->>'businessEntity',''),nullif(v_case.normalized->>'companyName',''),nullif(v_case.normalized->>'supplierCode',''),nullif(v_case.normalized->>'deliveryPartNo',''),nullif(v_case.normalized->>'moduleId',''),p_batch_id,v_case.source_sheet,v_case.source_row,v_case.row_data)
    on conflict(source_case_code) do update set part_id=excluded.part_id,business_entity=excluded.business_entity,company_name=excluded.company_name,supplier_code=excluded.supplier_code,delivery_part_no=excluded.delivery_part_no,module_id=excluded.module_id,source_batch_id=excluded.source_batch_id,source_sheet=excluded.source_sheet,source_row=excluded.source_row,raw_source=excluded.raw_source,updated_at=now()
    returning id into v_case_id;
    v_cases:=v_cases+1;

    for v_row in select * from public.import_rows where batch_id=p_batch_id and source_case_code=v_case.source_case_code order by source_row loop
      v_source_key:=coalesce(nullif(v_row.normalized->>'sourceRecordKey',''),v_batch.source_file_hash||':'||v_row.source_sheet||':'||v_row.source_row::text);
      insert into public.gcat_error_items(case_id,source_record_key,source_batch_id,source_sheet,source_row,error_type_label,delivery_part_no,supplier_code,cas_no,substance_name,judge_status,last_comment,raw_source,
        source_code,source_year,source_month,source_status,delivery_part_name,assigned_person,starting_date,judgement_procedure,judge,ok_comment,imds_reject_comment,km_judge,km_comment,last_change_date,source_hash)
      values(v_case_id,v_source_key,p_batch_id,v_row.source_sheet,v_row.source_row,coalesce(nullif(v_row.normalized->>'errorType',''),'(blank)'),nullif(v_row.normalized->>'deliveryPartNo',''),nullif(v_row.normalized->>'supplierCode',''),nullif(v_row.normalized->>'casNo',''),nullif(v_row.normalized->>'substanceName',''),nullif(v_row.normalized->>'judge',''),nullif(v_row.normalized->>'comment',''),v_row.row_data,
        nullif(v_row.normalized->>'sourceCode',''),nullif(v_row.normalized->>'year',''),nullif(v_row.normalized->>'month',''),nullif(v_row.normalized->>'sourceStatus',''),nullif(v_row.normalized->>'deliveryPartName',''),nullif(v_row.normalized->>'assignedPerson',''),nullif(v_row.normalized->>'startingDate','')::date,nullif(v_row.normalized->>'judgementProcedure',''),nullif(v_row.normalized->>'judge',''),nullif(v_row.normalized->>'okComment',''),nullif(v_row.normalized->>'imdsRejectComment',''),nullif(v_row.normalized->>'kmJudge',''),nullif(v_row.normalized->>'kmComment',''),nullif(v_row.normalized->>'lastChangeDate','')::timestamptz,v_batch.source_file_hash)
      on conflict(source_record_key) do update set case_id=excluded.case_id,source_batch_id=excluded.source_batch_id,source_sheet=excluded.source_sheet,source_row=excluded.source_row,error_type_label=excluded.error_type_label,delivery_part_no=excluded.delivery_part_no,supplier_code=excluded.supplier_code,cas_no=excluded.cas_no,substance_name=excluded.substance_name,judge_status=excluded.judge_status,last_comment=excluded.last_comment,raw_source=excluded.raw_source,source_code=excluded.source_code,source_year=excluded.source_year,source_month=excluded.source_month,source_status=excluded.source_status,delivery_part_name=excluded.delivery_part_name,source_last_seen_at=now(),source_hash=excluded.source_hash,
        assigned_person=coalesce(nullif(public.gcat_error_items.assigned_person,''),excluded.assigned_person),starting_date=coalesce(public.gcat_error_items.starting_date,excluded.starting_date),judgement_procedure=coalesce(nullif(public.gcat_error_items.judgement_procedure,''),excluded.judgement_procedure),judge=coalesce(public.gcat_error_items.judge,excluded.judge),ok_comment=coalesce(nullif(public.gcat_error_items.ok_comment,''),excluded.ok_comment),imds_reject_comment=coalesce(nullif(public.gcat_error_items.imds_reject_comment,''),excluded.imds_reject_comment),km_judge=coalesce(public.gcat_error_items.km_judge,excluded.km_judge),km_comment=coalesce(nullif(public.gcat_error_items.km_comment,''),excluded.km_comment),last_change_date=coalesce(public.gcat_error_items.last_change_date,excluded.last_change_date);
      v_items:=v_items+1;
    end loop;
  end loop;
  update public.import_batches set status='COMMITTED',committed_rows=v_items,committed_at=now() where id=p_batch_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'IMPORT_COMMITTED','import_batch',p_batch_id,jsonb_build_object('casesProcessed',v_cases,'itemsProcessed',v_items,'mergeKey','source code','preserveWebJudgement',true));
  return jsonb_build_object('batchId',p_batch_id,'casesProcessed',v_cases,'itemsProcessed',v_items,'status','COMMITTED');
end;
$$;

create policy "supplier_followups_read_own_portal" on public.supplier_followups for select to authenticated
using (public.has_any_role(array['supplier']::public.app_role[]) and supplier_code=(select supplier_code from public.profiles where id=auth.uid()));
