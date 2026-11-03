-- Allow reviewers to update AO–AV fields through the guarded trigger.
-- The trigger still limits KM Judge / KM Comment to reviewer/admin.
drop policy if exists "items_update_preparer_reviewer_admin" on public.gcat_error_items;
create policy "items_update_preparer_reviewer_admin" on public.gcat_error_items
for update to authenticated
using (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]))
with check (public.has_any_role(array['admin','preparer','reviewer']::public.app_role[]));

-- Atomic, same-Error-Type bulk preparation. Judge / comments / KM fields are deliberately excluded.
create or replace function public.bulk_prepare_gcat_items(p_item_ids uuid[], p_values jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role public.app_role;
  v_count integer;
  v_distinct_types integer;
  v_error_type text;
  v_row public.gcat_error_items%rowtype;
  v_after public.gcat_error_items%rowtype;
  v_changed text[] := array[]::text[];
  v_updated integer := 0;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','preparer','reviewer') then
    raise exception 'Preparer, reviewer or admin role is required';
  end if;
  if p_item_ids is null or cardinality(p_item_ids) < 2 or cardinality(p_item_ids) > 100 then
    raise exception 'Select between 2 and 100 records';
  end if;
  if jsonb_typeof(p_values) <> 'object' or p_values = '{}'::jsonb then
    raise exception 'At least one preparation field is required';
  end if;
  if (p_values - 'assigned_person' - 'starting_date' - 'judgement_procedure') <> '{}'::jsonb then
    raise exception 'Bulk preparation supports Assigned person, starting date and judgement procedure only';
  end if;
  if p_values ? 'assigned_person' and nullif(trim(coalesce(p_values->>'assigned_person','')),'') is null then
    raise exception 'Assigned person cannot be blank';
  end if;
  if p_values ? 'starting_date' and coalesce(p_values->>'starting_date','') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Starting date must use YYYY-MM-DD';
  end if;
  if p_values ? 'judgement_procedure' and nullif(trim(coalesce(p_values->>'judgement_procedure','')),'') is null then
    raise exception 'Judgement procedure cannot be blank';
  end if;
  if p_values ? 'assigned_person' then v_changed := array_append(v_changed,'assigned_person'); end if;
  if p_values ? 'starting_date' then v_changed := array_append(v_changed,'starting_date'); end if;
  if p_values ? 'judgement_procedure' then v_changed := array_append(v_changed,'judgement_procedure'); end if;

  select count(*), count(distinct error_type_label), min(error_type_label)
    into v_count, v_distinct_types, v_error_type
  from public.gcat_error_items where id = any(p_item_ids);
  if v_count <> cardinality(p_item_ids) then raise exception 'One or more selected records are not available'; end if;
  if v_distinct_types <> 1 then raise exception 'Bulk preparation requires the same exact historical Error Type label'; end if;

  perform set_config('app.gcat_bulk_preparation', 'true', true);
  for v_row in select * from public.gcat_error_items where id = any(p_item_ids) order by id for update loop
    update public.gcat_error_items set
      assigned_person = case when p_values ? 'assigned_person' then p_values->>'assigned_person' else assigned_person end,
      assigned_person_override = case when p_values ? 'assigned_person' then true else assigned_person_override end,
      starting_date = case when p_values ? 'starting_date' then (p_values->>'starting_date')::date else starting_date end,
      starting_date_override = case when p_values ? 'starting_date' then true else starting_date_override end,
      judgement_procedure = case when p_values ? 'judgement_procedure' then p_values->>'judgement_procedure' else judgement_procedure end,
      judgement_procedure_override = case when p_values ? 'judgement_procedure' then true else judgement_procedure_override end,
      last_change_date = now(),
      last_change_date_override = true
    where id = v_row.id returning * into v_after;

    insert into public.register_change_log(item_id,actor_id,changed_columns,before_values,after_values)
    values(v_row.id,auth.uid(),v_changed || array['last_change_date'],to_jsonb(v_row),to_jsonb(v_after));
    v_updated := v_updated + 1;
  end loop;

  insert into public.audit_events(actor_id,action,entity_type,metadata)
  values(auth.uid(),'JUDGEMENT_REGISTER_BULK_PREPARATION','gcat_error_items',
    jsonb_build_object('count',v_updated,'errorType',v_error_type,'changedColumns',v_changed));
  return jsonb_build_object('updated',v_updated,'errorType',v_error_type,'changedColumns',v_changed);
end;
$$;
revoke all on function public.bulk_prepare_gcat_items(uuid[],jsonb) from public;
grant execute on function public.bulk_prepare_gcat_items(uuid[],jsonb) to authenticated;

-- Harden helper/trigger function execution. RLS helper functions remain available
-- to authenticated sessions; trigger-only functions are not callable as public RPCs.
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.has_any_role(public.app_role[]) from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_any_role(public.app_role[]) to authenticated;
revoke all on function public.handle_new_user() from public, anon;
revoke all on function public.set_updated_at() from public, anon;
revoke all on function public.guard_gcat_judgement_columns() from public, anon;
revoke all on function public.guard_supplier_precheck_review() from public, anon;
