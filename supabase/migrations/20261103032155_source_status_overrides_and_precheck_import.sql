-- Preserve source judgement text while separating valid OK/NG decisions from legacy mixed labels.
-- Track website overrides per field so new daily G-CATS snapshots refresh untouched fields only.
alter table public.gcat_error_items
  add column if not exists source_judge_label text,
  add column if not exists source_km_judge_label text,
  add column if not exists assigned_person_override boolean not null default false,
  add column if not exists starting_date_override boolean not null default false,
  add column if not exists judgement_procedure_override boolean not null default false,
  add column if not exists judge_override boolean not null default false,
  add column if not exists ok_comment_override boolean not null default false,
  add column if not exists imds_reject_comment_override boolean not null default false,
  add column if not exists km_judge_override boolean not null default false,
  add column if not exists km_comment_override boolean not null default false,
  add column if not exists last_change_date_override boolean not null default false;

alter table public.supplier_prechecks
  add column if not exists extracted_fields jsonb not null default '{}'::jsonb,
  add column if not exists extraction_warnings jsonb not null default '[]'::jsonb;

create index if not exists gcat_items_source_judge_label_idx on public.gcat_error_items(source_judge_label) where source_judge_label is not null;

-- An imported historical row can legitimately contain non-standard values such as
-- "Wait", "OK/NG", "Confirm to TMA" or a spreadsheet formula error. Those stay in
-- source_judge_label/source_km_judge_label + raw_source; only exact OK/NG populate judge columns.

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
  if new.judge='OK' and (new.judge is distinct from old.judge or new.ok_comment is distinct from old.ok_comment)
     and nullif(trim(coalesce(new.ok_comment,'')),'') is null then
    raise exception 'OK requires the Record of changing to OK comment';
  end if;
  if new.judge='NG' and (new.judge is distinct from old.judge or new.imds_reject_comment is distinct from old.imds_reject_comment)
     and nullif(trim(coalesce(new.imds_reject_comment,'')),'') is null then
    raise exception 'NG requires an IMDS Reject comment';
  end if;
  return new;
end;
$$;

-- Replace the import function: use source code (not daily No.), preserve the original
-- source judgement labels, and refresh each field unless a user has overridden it.
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
  v_source_judge text;
  v_source_km_judge text;
  v_judge text;
  v_km_judge text;
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
      v_source_judge:=nullif(trim(coalesce(v_row.normalized->>'sourceJudgeLabel','')),'');
      v_source_km_judge:=nullif(trim(coalesce(v_row.normalized->>'sourceKmJudgeLabel','')),'');
      v_judge:=case when upper(coalesce(v_source_judge,'')) in ('OK','NG') then upper(v_source_judge) else null end;
      v_km_judge:=case when upper(coalesce(v_source_km_judge,'')) in ('OK','NG') then upper(v_source_km_judge) else null end;

      insert into public.gcat_error_items(case_id,source_record_key,source_batch_id,source_sheet,source_row,error_type_label,delivery_part_no,supplier_code,cas_no,substance_name,judge_status,last_comment,raw_source,
        source_code,source_year,source_month,source_status,delivery_part_name,assigned_person,starting_date,judgement_procedure,judge,ok_comment,imds_reject_comment,km_judge,km_comment,last_change_date,source_hash,source_judge_label,source_km_judge_label)
      values(v_case_id,v_source_key,p_batch_id,v_row.source_sheet,v_row.source_row,coalesce(nullif(v_row.normalized->>'errorType',''),'(blank)'),nullif(v_row.normalized->>'deliveryPartNo',''),nullif(v_row.normalized->>'supplierCode',''),nullif(v_row.normalized->>'casNo',''),nullif(v_row.normalized->>'substanceName',''),v_judge,nullif(v_row.normalized->>'comment',''),v_row.row_data,
        nullif(v_row.normalized->>'sourceCode',''),nullif(v_row.normalized->>'year',''),nullif(v_row.normalized->>'month',''),nullif(v_row.normalized->>'sourceStatus',''),nullif(v_row.normalized->>'deliveryPartName',''),nullif(v_row.normalized->>'assignedPerson',''),nullif(v_row.normalized->>'startingDate','')::date,nullif(v_row.normalized->>'judgementProcedure',''),v_judge,nullif(v_row.normalized->>'okComment',''),nullif(v_row.normalized->>'imdsRejectComment',''),v_km_judge,nullif(v_row.normalized->>'kmComment',''),nullif(v_row.normalized->>'lastChangeDate','')::timestamptz,v_batch.source_file_hash,v_source_judge,v_source_km_judge)
      on conflict(source_record_key) do update set
        case_id=excluded.case_id,source_batch_id=excluded.source_batch_id,source_sheet=excluded.source_sheet,source_row=excluded.source_row,
        error_type_label=excluded.error_type_label,delivery_part_no=excluded.delivery_part_no,supplier_code=excluded.supplier_code,
        cas_no=excluded.cas_no,substance_name=excluded.substance_name,judge_status=case when public.gcat_error_items.judge_override then public.gcat_error_items.judge else excluded.judge_status end,
        last_comment=excluded.last_comment,raw_source=excluded.raw_source,source_code=excluded.source_code,source_year=excluded.source_year,
        source_month=excluded.source_month,source_status=excluded.source_status,delivery_part_name=excluded.delivery_part_name,
        source_last_seen_at=now(),source_hash=excluded.source_hash,source_judge_label=excluded.source_judge_label,source_km_judge_label=excluded.source_km_judge_label,
        assigned_person=case when public.gcat_error_items.assigned_person_override then public.gcat_error_items.assigned_person else excluded.assigned_person end,
        starting_date=case when public.gcat_error_items.starting_date_override then public.gcat_error_items.starting_date else excluded.starting_date end,
        judgement_procedure=case when public.gcat_error_items.judgement_procedure_override then public.gcat_error_items.judgement_procedure else excluded.judgement_procedure end,
        judge=case when public.gcat_error_items.judge_override then public.gcat_error_items.judge else excluded.judge end,
        ok_comment=case when public.gcat_error_items.ok_comment_override then public.gcat_error_items.ok_comment else excluded.ok_comment end,
        imds_reject_comment=case when public.gcat_error_items.imds_reject_comment_override then public.gcat_error_items.imds_reject_comment else excluded.imds_reject_comment end,
        km_judge=case when public.gcat_error_items.km_judge_override then public.gcat_error_items.km_judge else excluded.km_judge end,
        km_comment=case when public.gcat_error_items.km_comment_override then public.gcat_error_items.km_comment else excluded.km_comment end,
        last_change_date=case when public.gcat_error_items.last_change_date_override then public.gcat_error_items.last_change_date else excluded.last_change_date end;
      v_items:=v_items+1;
    end loop;
  end loop;
  update public.import_batches set status='COMMITTED',committed_rows=v_items,committed_at=now() where id=p_batch_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),'IMPORT_COMMITTED','import_batch',p_batch_id,jsonb_build_object('casesProcessed',v_cases,'itemsProcessed',v_items,'mergeKey','source code','preserveOnlyExplicitWebsiteOverrides',true));
  return jsonb_build_object('batchId',p_batch_id,'casesProcessed',v_cases,'itemsProcessed',v_items,'status','COMMITTED');
end;
$$;
revoke all on function public.commit_import_batch(uuid) from public;
grant execute on function public.commit_import_batch(uuid) to authenticated;
